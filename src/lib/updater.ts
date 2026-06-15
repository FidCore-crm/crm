/**
 * Sistema de actualizaciones in-app
 * ==================================
 *
 * Permite al PAS ver actualizaciones disponibles del CRM y aplicarlas
 * desde la UI (ahora o programadas).
 *
 * Arquitectura:
 *
 *   1. El CRM consulta `api.github.com/repos/<owner>/<repo>/releases/latest`
 *      para descubrir si hay versión nueva. La compara con su propia versión
 *      leída de `package.json`.
 *
 *   2. Cuando el usuario aprieta "Actualizar ahora" o "Programar", el CRM:
 *        a. Inserta una fila en `actualizaciones` con estado PROGRAMADA.
 *        b. Escribe `/app/tmp/updates/pending.json` (bind-mounted al host)
 *           con los datos del update.
 *
 *   3. Un cron del host (configurado en INSTALACION.md, corre cada minuto)
 *      revisa ese archivo. Si la fecha programada ya pasó:
 *        a. Ejecuta `scripts/aplicar-actualizacion.sh` que vive en el host.
 *        b. El script hace backup → git pull → docker build → up -d.
 *        c. Actualiza la fila en `actualizaciones` con estado COMPLETADA/FALLIDA.
 *
 *   4. El frontend hace polling de `/api/actualizaciones/estado` durante el
 *      update para mostrar progreso y resultado.
 *
 * Por qué este diseño:
 *   - El container del CRM NO puede actualizarse a sí mismo (estaría matando
 *     su propio proceso en medio del build).
 *   - El cron del host es código separado, fuera de Docker, que tiene acceso
 *     al `docker-compose.yml` y puede hacer build + up.
 *   - El archivo trigger en `tmp/updates/` desacopla totalmente: el CRM solo
 *     "deja un mensaje", el host lo procesa cuando quiere.
 */

import path from 'path'
import { promises as fs } from 'fs'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { logger } from '@/lib/errores'
import packageJson from '../../package.json'

// ─── Tipos públicos ────────────────────────────────────────────────────

export interface ReleaseGitHub {
  /** Tag completo del release, ej: `v1.2.0` */
  tag: string
  /** Versión sin el prefijo `v`, ej: `1.2.0` */
  version: string
  /** Nombre/título del release */
  nombre: string
  /** Cuerpo markdown del release (changelog) */
  changelog: string
  /** Fecha de publicación ISO */
  published_at: string
  /** URL del release en github.com */
  html_url: string
  /** true si la versión actual es anterior a esta release */
  es_mas_nueva: boolean
  /** true si es un pre-release de GitHub (solo aparece si FIDCORE_INCLUIR_PRERELEASES=true) */
  prerelease?: boolean
}

export interface ActualizacionDisponibleResult {
  version_actual: string
  hay_actualizacion: boolean
  ultimo_release?: ReleaseGitHub
  error?: string
}

// ─── Constantes ────────────────────────────────────────────────────────

/** Carpeta donde se escribe el trigger para el cron del host. Bind-mounted. */
const UPDATES_DIR = path.resolve(process.cwd(), 'tmp/updates')
const TRIGGER_FILE = path.join(UPDATES_DIR, 'pending.json')

/** Cache en memoria para no martillar la API de GitHub. TTL 1 hora. */
const TTL_RELEASE_CHECK_MS = 60 * 60 * 1000
let _cacheRelease: { data: ActualizacionDisponibleResult; expira: number } | null = null

// ─── Helpers públicos ──────────────────────────────────────────────────

/** Versión del CRM leída de package.json (inyectada en build time). */
export function obtenerVersionActual(): string {
  return packageJson.version
}

/**
 * Compara dos versiones semver (X.Y.Z). Retorna:
 *   -1 si v1 < v2,
 *    0 si v1 == v2,
 *    1 si v1 > v2.
 * Ignora sufijos pre-release (`-rc1`, `-beta`).
 */
export function compararVersiones(v1: string, v2: string): -1 | 0 | 1 {
  const clean = (s: string) => s.replace(/^v/i, '').split('-')[0]
  const a = clean(v1).split('.').map(n => parseInt(n, 10) || 0)
  const b = clean(v2).split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ai = a[i] ?? 0
    const bi = b[i] ?? 0
    if (ai < bi) return -1
    if (ai > bi) return 1
  }
  return 0
}

/**
 * Consulta GitHub API por el último release publicado y compara con la
 * versión actual del CRM. Retorna info de update disponible si existe.
 *
 * Si la API falla (rate limit, sin internet, repo no existe), retorna
 * `hay_actualizacion: false` con el error para que el frontend pueda
 * decidir si mostrarlo o no.
 */
export async function consultarUltimaActualizacion(opciones?: {
  /** Si true, ignora el cache y fuerza una consulta a GitHub */
  forzar?: boolean
}): Promise<ActualizacionDisponibleResult> {
  if (!opciones?.forzar && _cacheRelease && Date.now() < _cacheRelease.expira) {
    return _cacheRelease.data
  }

  const versionActual = obtenerVersionActual()
  const supabase = getSupabaseAdmin()

  // El repo de updates es configurable por si en el futuro hay forks.
  const { data: config } = await supabase
    .from('configuracion')
    .select('url_repo_updates')
    .limit(1)
    .maybeSingle()

  const repo = ((config as any)?.url_repo_updates) || 'Pulzar-crm/crm'

  // Feature flag (oculto, solo para dev/staging del equipo FidCore): si la env
  // var `FIDCORE_INCLUIR_PRERELEASES=true` está seteada, el server consulta
  // /releases en vez de /releases/latest y considera el primero como candidato
  // (incluso si es pre-release). Sirve para validar el flujo de updates con
  // versiones no promovidas todavía. En instalaciones de clientes la env var
  // no está y el comportamiento es el de siempre (solo Latest).
  const incluirPrereleases = process.env.FIDCORE_INCLUIR_PRERELEASES === 'true'
  const endpoint = incluirPrereleases
    ? `https://api.github.com/repos/${repo}/releases?per_page=10`
    : `https://api.github.com/repos/${repo}/releases/latest`

  try {
    const resp = await fetch(endpoint, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      // GitHub responde rápido; 5s es generoso pero evita colgar el endpoint
      signal: AbortSignal.timeout(5000),
    })

    if (resp.status === 404) {
      // No hay releases publicados todavía. Es válido.
      const data: ActualizacionDisponibleResult = {
        version_actual: versionActual,
        hay_actualizacion: false,
      }
      _cacheRelease = { data, expira: Date.now() + TTL_RELEASE_CHECK_MS }
      return data
    }

    if (resp.status === 403) {
      // Rate limit (GitHub permite 60 req/h sin auth).
      const data: ActualizacionDisponibleResult = {
        version_actual: versionActual,
        hay_actualizacion: false,
        error: 'GitHub rate limit alcanzado. Reintentar en 1 hora.',
      }
      // No cacheamos errores de rate limit por mucho tiempo
      _cacheRelease = { data, expira: Date.now() + 60_000 }
      return data
    }

    if (!resp.ok) {
      const data: ActualizacionDisponibleResult = {
        version_actual: versionActual,
        hay_actualizacion: false,
        error: `GitHub respondió HTTP ${resp.status}`,
      }
      _cacheRelease = { data, expira: Date.now() + 60_000 }
      return data
    }

    type ReleaseJson = {
      tag_name: string
      name: string | null
      body: string | null
      published_at: string
      html_url: string
      draft: boolean
      prerelease: boolean
    }

    // En modo "incluir pre-releases", recibimos un array y tomamos el primer
    // release no-draft que sea más nuevo que la versión actual. La API devuelve
    // los releases ordenados por created_at DESC, así que el primero es el más
    // reciente. Considerando que el equipo dev publica primero como pre-release
    // y después promueve a Latest, queremos detectar tanto la pre-release nueva
    // como un Latest nuevo.
    let releaseSeleccionado: ReleaseJson | null = null
    if (incluirPrereleases) {
      const arr = await resp.json() as ReleaseJson[]
      // Saltear drafts (los publicados con prerelease=true sí los consideramos)
      const candidato = arr.find(r => !r.draft)
      if (candidato) releaseSeleccionado = candidato
    } else {
      releaseSeleccionado = await resp.json() as ReleaseJson
      // /releases/latest YA excluye drafts y pre-releases por la API,
      // pero defensivamente chequeamos por si GitHub cambia el comportamiento.
      if (releaseSeleccionado.draft || releaseSeleccionado.prerelease) {
        releaseSeleccionado = null
      }
    }

    if (!releaseSeleccionado) {
      const data: ActualizacionDisponibleResult = {
        version_actual: versionActual,
        hay_actualizacion: false,
      }
      _cacheRelease = { data, expira: Date.now() + TTL_RELEASE_CHECK_MS }
      return data
    }

    const json = releaseSeleccionado

    const release: ReleaseGitHub = {
      tag: json.tag_name,
      version: json.tag_name.replace(/^v/i, ''),
      nombre: json.name ?? json.tag_name,
      changelog: json.body ?? '',
      published_at: json.published_at,
      html_url: json.html_url,
      es_mas_nueva: compararVersiones(versionActual, json.tag_name) < 0,
      prerelease: json.prerelease,
    }

    const data: ActualizacionDisponibleResult = {
      version_actual: versionActual,
      hay_actualizacion: release.es_mas_nueva,
      ultimo_release: release,
    }

    _cacheRelease = { data, expira: Date.now() + TTL_RELEASE_CHECK_MS }
    return data
  } catch (err: any) {
    logger.warn({
      modulo: 'updater',
      mensaje: 'Falló consulta de releases a GitHub',
      contexto: { repo, error: String(err) },
    })
    return {
      version_actual: versionActual,
      hay_actualizacion: false,
      error: 'No se pudo consultar GitHub. Verificá la conexión a internet.',
    }
  }
}

/** Invalida el cache para forzar próxima consulta a GitHub. */
export function invalidarCacheRelease(): void {
  _cacheRelease = null
}

// ─── Programación de actualizaciones ───────────────────────────────────

export interface ProgramarUpdateInput {
  /** Versión a aplicar (tag sin prefijo, ej: `1.2.0`) */
  version_nueva: string
  /** Changelog del release */
  changelog: string
  /**
   * NULL = "actualizar ahora" (próximo tick del cron host, en segundos)
   * Date = fecha/hora específica en el futuro
   */
  programada_para: Date | null
  /** Usuario admin que disparó la acción */
  usuario_id: string | null
}

export interface ActualizacionRow {
  id: string
  version_anterior: string
  version_nueva: string
  changelog: string | null
  estado: 'PROGRAMADA' | 'EJECUTANDO' | 'COMPLETADA' | 'FALLIDA' | 'CANCELADA'
  programada_para: string | null
  fecha_solicitud: string
  fecha_inicio_ejecucion: string | null
  fecha_fin_ejecucion: string | null
  backup_id: string | null
  error_mensaje: string | null
  log_completo: string | null
  solicitada_por_usuario_id: string | null
  cancelada_por_usuario_id: string | null
  created_at: string
  updated_at: string
}

/**
 * Programa una actualización: inserta fila en DB + escribe trigger en disco.
 *
 * Falla con error legible si:
 *   - Ya hay una actualización en estado PROGRAMADA o EJECUTANDO (constraint UNIQUE).
 *   - No se puede escribir el archivo trigger (problema de permisos del bind mount).
 */
export async function programarActualizacion(
  input: ProgramarUpdateInput,
): Promise<{ ok: true; actualizacion: ActualizacionRow } | { ok: false; error: string }> {
  const supabase = getSupabaseAdmin()
  const versionActual = obtenerVersionActual()

  // Chequeo previo amigable: ¿ya hay una activa? Mejor mensaje que un error
  // de constraint crudo.
  const { data: existente } = await supabase
    .from('actualizaciones')
    .select('id, estado, programada_para')
    .in('estado', ['PROGRAMADA', 'EJECUTANDO'])
    .limit(1)
    .maybeSingle()

  if (existente) {
    const e: any = existente
    if (e.estado === 'EJECUTANDO') {
      return { ok: false, error: 'Ya hay una actualización en curso. Esperá a que termine.' }
    }
    return {
      ok: false,
      error: 'Ya hay una actualización programada. Cancelala antes de programar otra.',
    }
  }

  // Insertar la fila
  const { data: insertada, error: errInsert } = await (supabase
    .from('actualizaciones') as any)
    .insert({
      version_anterior: versionActual,
      version_nueva: input.version_nueva,
      changelog: input.changelog,
      estado: 'PROGRAMADA',
      programada_para: input.programada_para?.toISOString() ?? null,
      solicitada_por_usuario_id: input.usuario_id,
    })
    .select('*')
    .single()

  if (errInsert || !insertada) {
    logger.error({
      modulo: 'updater',
      mensaje: 'Error insertando actualización',
      contexto: { error: errInsert?.message },
    })
    return { ok: false, error: 'No se pudo registrar la actualización en DB.' }
  }

  // Escribir trigger file que el cron del host leerá
  try {
    await fs.mkdir(UPDATES_DIR, { recursive: true })
    const triggerData = {
      actualizacion_id: (insertada as any).id,
      version_anterior: versionActual,
      version_nueva: input.version_nueva,
      programada_para: input.programada_para?.toISOString() ?? null,
      solicitada_en: new Date().toISOString(),
    }
    await fs.writeFile(TRIGGER_FILE, JSON.stringify(triggerData, null, 2), 'utf-8')
  } catch (err) {
    // Rollback: si no podemos escribir el archivo, marcamos la actualización
    // como cancelada para que el listado no quede inconsistente.
    await (supabase.from('actualizaciones') as any)
      .update({
        estado: 'CANCELADA',
        error_mensaje: 'No se pudo escribir el archivo trigger en tmp/updates/',
      })
      .eq('id', (insertada as any).id)

    logger.error({
      modulo: 'updater',
      mensaje: 'Error escribiendo trigger file',
      contexto: { error: String(err) },
    })
    return {
      ok: false,
      error: 'No se pudo crear el archivo de disparo. Verificá permisos de tmp/updates/.',
    }
  }

  return { ok: true, actualizacion: insertada as ActualizacionRow }
}

/**
 * Cancela una actualización en estado PROGRAMADA.
 *
 * Estrategia:
 *   - Si está PROGRAMADA: UPDATE atómico → CANCELADA + limpiar archivos trigger/progress.
 *   - Si está EJECUTANDO: NO se puede cancelar limpio (script ya corre). Devolvemos
 *     mensaje claro. El admin puede usar forzar-cierre desde el modal si está stuck.
 *
 * El UPDATE usa WHERE estado='PROGRAMADA' para evitar race condition: si entre
 * el SELECT y el UPDATE la fila pasó a EJECUTANDO, el UPDATE no afecta filas y
 * detectamos que ya empezó.
 */
export async function cancelarActualizacion(
  id: string,
  usuario_id: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = getSupabaseAdmin()

  // UPDATE atómico: solo cancela si SIGUE en PROGRAMADA.
  // Si entre lectura previa y este UPDATE la fila pasó a EJECUTANDO,
  // affectedRows = 0 → no se pudo cancelar.
  const { data: actualizadas, error } = await (supabase
    .from('actualizaciones') as any)
    .update({
      estado: 'CANCELADA',
      cancelada_por_usuario_id: usuario_id,
      fecha_fin_ejecucion: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('estado', 'PROGRAMADA')
    .select('id')

  if (error) {
    return { ok: false, error: 'No se pudo cancelar la actualización.' }
  }

  if (!actualizadas || actualizadas.length === 0) {
    // No se pudo cancelar — averiguar por qué para dar mensaje claro
    const { data: act } = await supabase
      .from('actualizaciones')
      .select('id, estado')
      .eq('id', id)
      .maybeSingle()

    if (!act) return { ok: false, error: 'Actualización no encontrada.' }
    const estado = (act as any).estado
    if (estado === 'EJECUTANDO') {
      return {
        ok: false,
        error:
          'La actualización ya está en curso y no se puede cancelar. ' +
          'Esperá a que termine, o si quedó stuck usá "Marcar como fallida" desde el detalle.',
      }
    }
    return { ok: false, error: `No se puede cancelar una actualización en estado ${estado}.` }
  }

  // Limpiar archivos trigger + progress + lock (best-effort, no falla si no existen)
  for (const f of ['pending.json', 'progress.json', '.in-progress']) {
    try {
      await fs.unlink(path.join(UPDATES_DIR, f))
    } catch {
      // No existe → OK
    }
  }

  return { ok: true }
}

/**
 * Limpia actualizaciones que quedaron PROGRAMADA hace mucho tiempo y nunca
 * se procesaron (típicamente porque el cron del host no está instalado o
 * el trigger file se borró).
 *
 * Las marca como FALLIDA con mensaje explicativo para que el admin lo vea
 * en el historial y pueda actuar.
 */
export async function limpiarProgramadasViejas(diasMax = 7): Promise<number> {
  const supabase = getSupabaseAdmin()
  const limite = new Date(Date.now() - diasMax * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await (supabase.from('actualizaciones') as any)
    .update({
      estado: 'FALLIDA',
      fecha_fin_ejecucion: new Date().toISOString(),
      error_mensaje:
        `Actualización quedó PROGRAMADA más de ${diasMax} días sin ejecutarse. ` +
        'Posibles causas: cron del host no instalado, o trigger file borrado. ' +
        'Verificar que /usr/local/bin/fidcore-actualizacion-trigger.sh esté en el crontab.',
    })
    .eq('estado', 'PROGRAMADA')
    .lt('fecha_solicitud', limite)
    .select('id')

  if (error) {
    logger.warn({
      modulo: 'updater',
      mensaje: 'Error limpiando programadas viejas',
      contexto: { error: error.message },
    })
    return 0
  }
  return data?.length ?? 0
}

/** Retorna la actualización activa (PROGRAMADA o EJECUTANDO) si hay. */
export async function obtenerActualizacionActiva(): Promise<ActualizacionRow | null> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('actualizaciones')
    .select('*')
    .in('estado', ['PROGRAMADA', 'EJECUTANDO'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as ActualizacionRow) ?? null
}

/**
 * Retorna la última actualización COMPLETADA con éxito (para mostrar al PAS
 * "qué cambios trajo la versión que estás corriendo").
 */
export async function obtenerUltimaCompletada(): Promise<ActualizacionRow | null> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('actualizaciones')
    .select('*')
    .eq('estado', 'COMPLETADA')
    .order('fecha_fin_ejecucion', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as ActualizacionRow) ?? null
}

/**
 * Lee el archivo progress.json escrito por aplicar-actualizacion.sh.
 * Devuelve null si no existe o está malformado. El frontend lo usa para
 * mostrar el stepper con el paso REAL en vez de estimaciones por tiempo.
 */
export interface ProgressInfo {
  actualizacion_id: string
  paso: string           // BACKUP | FETCH | BUILD | MIGRATIONS | RESTART | HEALTHCHECK | DONE | FAILED | ROLLBACK | INICIANDO
  porcentaje: number     // 0-100
  mensaje: string
  actualizado_en: string
}

export async function leerProgreso(): Promise<ProgressInfo | null> {
  const file = path.join(UPDATES_DIR, 'progress.json')
  try {
    const raw = await fs.readFile(file, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed.paso || typeof parsed.porcentaje !== 'number') return null
    return parsed as ProgressInfo
  } catch {
    return null
  }
}
