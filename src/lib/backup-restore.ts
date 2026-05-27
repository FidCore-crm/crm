/**
 * Sistema de restauración de backups .crmbak (tar.gz sin cifrar).
 *
 * Máquina de estados async fire-and-forget. El PAS dispara la restauración
 * desde el panel; `iniciarRestauracion()` crea el registro en DB y lanza
 * `ejecutarRestauracionAsync()` sin await, devolviendo el id para que el
 * frontend pueda hacer polling del estado.
 *
 * Flujo:
 *   PENDIENTE → VALIDANDO → [PRE_BACKUP] → EXTRAYENDO
 *     → [RESTAURANDO_DB] → [RESTAURANDO_STORAGE] → FINALIZANDO → COMPLETADA
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { ejecutarBackup } from '@/lib/backup-runner'
import { encolarEmailSistema } from '@/lib/comunicaciones-sender'
import { limpiarTemporalesAntiguosSinBloquear } from '@/lib/limpieza-temporales'
import { logger } from '@/lib/errores'
import type { EstadoRestauracion } from '@/types/database'

const execAsync = promisify(exec)

const PROJECT_DIR = process.cwd()
const SCRIPTS_DIR = path.join(PROJECT_DIR, 'scripts')
const BACKUP_BASE = '/var/backups/crm-seguros'
const RESTORE_TMP_BASE = '/tmp/crm-restauraciones'

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface OpcionesRestauracion {
  restaurar_db: boolean
  restaurar_storage: boolean
  crear_pre_backup: boolean
}

export interface IniciarRestauracionParams {
  fuente: 'BACKUP_EXISTENTE' | 'ARCHIVO_SUBIDO'
  backup_id?: string
  archivo_path?: string
  nombre_archivo?: string
  tamano_archivo_bytes?: number
  opciones: OpcionesRestauracion
  usuario_id: string
  ip_origen?: string
  user_agent?: string
}

export interface ValidacionArchivo {
  ok: boolean
  metadata?: any
  contenido?: Record<string, boolean>
  tamano_archivo_mb?: number
  fecha_backup?: string
  version_crm?: string
  version_schema?: string
  error?: string
}

// ---------------------------------------------------------------------------
// Helper: actualizar estado + porcentaje
// ---------------------------------------------------------------------------

const PASO_POR_ESTADO: Record<EstadoRestauracion, { paso: number; pct: number; msg: string }> = {
  PENDIENTE:          { paso: 0, pct: 0,  msg: 'En cola' },
  VALIDANDO:          { paso: 1, pct: 10, msg: 'Validando archivo' },
  PRE_BACKUP:         { paso: 2, pct: 25, msg: 'Creando backup de seguridad' },
  EXTRAYENDO:         { paso: 3, pct: 45, msg: 'Extrayendo contenido' },
  RESTAURANDO_DB:     { paso: 4, pct: 65, msg: 'Restaurando base de datos' },
  RESTAURANDO_STORAGE:{ paso: 5, pct: 85, msg: 'Restaurando storage' },
  FINALIZANDO:        { paso: 6, pct: 95, msg: 'Finalizando' },
  COMPLETADA:         { paso: 7, pct: 100, msg: 'Completada' },
  FALLIDA:            { paso: 0, pct: 0,  msg: 'Falló' },
  CANCELADA:          { paso: 0, pct: 0,  msg: 'Cancelada' },
}

async function setEstado(id: string, estado: EstadoRestauracion, extra: { log?: string; error?: string } = {}) {
  const supabase = getSupabaseAdmin()
  const info = PASO_POR_ESTADO[estado]
  const update: any = {
    estado,
    paso_actual: info.paso,
    porcentaje: info.pct,
    mensaje_progreso: info.msg,
  }
  if (estado === 'COMPLETADA' || estado === 'FALLIDA' || estado === 'CANCELADA') {
    update.fecha_fin = new Date().toISOString()
  }
  if (extra.error) update.error_mensaje = extra.error
  if (extra.log !== undefined) {
    const { data } = await supabase.from('restauraciones').select('log_completo').eq('id', id).maybeSingle()
    const existing = (data as any)?.log_completo || ''
    update.log_completo = existing + `[${new Date().toISOString()}] ${extra.log}\n`
  }
  await supabase.from('restauraciones').update(update).eq('id', id)
}

async function appendLog(id: string, mensaje: string) {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase.from('restauraciones').select('log_completo').eq('id', id).maybeSingle()
  const existing = (data as any)?.log_completo || ''
  await supabase
    .from('restauraciones')
    .update({ log_completo: existing + `[${new Date().toISOString()}] ${mensaje}\n` })
    .eq('id', id)
}

// ---------------------------------------------------------------------------
// Validación de archivo .crmbak
// ---------------------------------------------------------------------------

/**
 * Valida que un archivo .crmbak sea un tar.gz legítimo y lee su metadata.json
 * sin descomprimir todo el contenido. Usado por el endpoint /validar-archivo
 * y como primer paso de la restauración real.
 */
export async function validarArchivoCrmbak(archivo_path: string): Promise<ValidacionArchivo> {
  try {
    // Verificar que el tar.gz sea válido
    try {
      await execAsync(`tar -tzf "${archivo_path}" > /dev/null`, { maxBuffer: 10 * 1024 * 1024 })
    } catch {
      return { ok: false, error: 'Archivo inválido o corrupto (no es un tar.gz válido)' }
    }

    // Extraer solo metadata.json (pattern match por nombre)
    const workDir = path.join(RESTORE_TMP_BASE, `validar-${crypto.randomUUID()}`)
    await fs.mkdir(workDir, { recursive: true })

    try {
      // El .crmbak tiene estructura backup-<ts>/metadata.json
      await execAsync(
        `tar -xzf "${archivo_path}" -C "${workDir}" --wildcards '*/metadata.json'`,
        { maxBuffer: 10 * 1024 * 1024 },
      )

      // Buscar el metadata.json extraído
      let metadataPath: string | null = null
      const entries = await fs.readdir(workDir, { withFileTypes: true })
      for (const e of entries) {
        if (e.isDirectory()) {
          const candidate = path.join(workDir, e.name, 'metadata.json')
          try {
            await fs.access(candidate)
            metadataPath = candidate
            break
          } catch {} // Silenciado: archivo/recurso puede no existir
        }
      }
      if (!metadataPath) {
        return { ok: false, error: 'El backup no contiene metadata.json' }
      }

      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'))
      const stat = await fs.stat(archivo_path)

      return {
        ok: true,
        metadata,
        contenido: metadata.contenido || { database: true, storage: true },
        tamano_archivo_mb: Math.round((stat.size / (1024 * 1024)) * 10) / 10,
        fecha_backup: metadata.fecha,
        version_crm: metadata.version_crm,
        version_schema: String(metadata.version_schema || ''),
      }
    } finally {
      try { await fs.rm(workDir, { recursive: true, force: true }) } catch (err) {
        logger.warn({ modulo: 'backup-restore', mensaje: 'Error limpiando workDir de validación', contexto: { workDir, error: String(err) } })
      }
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Error validando archivo' }
  }
}

// ---------------------------------------------------------------------------
// Iniciar restauración
// ---------------------------------------------------------------------------

export async function iniciarRestauracion(params: IniciarRestauracionParams): Promise<{
  ok: boolean
  restauracion_id?: string
  error?: string
}> {
  // Limpieza oportunista de temporales antiguos (fire-and-forget)
  limpiarTemporalesAntiguosSinBloquear().catch((err) =>
    logger.warn({ modulo: 'backup-restore', mensaje: 'Limpieza oportunista falló', contexto: { error: String(err) } }),
  )

  const supabase = getSupabaseAdmin()

  // Rate limit: 1 restauración por hora
  const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { data: reciente } = await supabase
    .from('restauraciones')
    .select('id, estado')
    .gte('fecha_inicio', haceUnaHora)
    .in('estado', ['PENDIENTE', 'VALIDANDO', 'PRE_BACKUP', 'EXTRAYENDO', 'RESTAURANDO_DB', 'RESTAURANDO_STORAGE', 'FINALIZANDO', 'COMPLETADA'])
    .limit(1)
    .maybeSingle()
  if (reciente) {
    return { ok: false, error: 'Ya hay una restauración reciente. Esperá al menos 1 hora entre restauraciones.' }
  }

  const workDir = path.join(RESTORE_TMP_BASE, `restore-${crypto.randomUUID()}`)

  const { data: inserted, error: insErr } = await supabase
    .from('restauraciones')
    .insert({
      fuente: params.fuente,
      backup_id: params.backup_id || null,
      nombre_archivo: params.nombre_archivo || null,
      tamano_archivo_bytes: params.tamano_archivo_bytes || null,
      estado: 'PENDIENTE',
      restaura_db: params.opciones.restaurar_db,
      restaura_storage: params.opciones.restaurar_storage,
      crear_pre_backup: params.opciones.crear_pre_backup,
      work_dir: workDir,
      usuario_id: params.usuario_id,
      ip_origen: params.ip_origen || null,
      user_agent: params.user_agent || null,
    })
    .select('id')
    .single()

  if (insErr || !inserted) {
    return { ok: false, error: insErr?.message || 'Error creando registro' }
  }

  const id = (inserted as any).id

  await supabase.from('notificaciones').insert({
    tipo: 'RESTAURACION_INICIADA',
    prioridad: 'CRITICA',
    titulo: 'Restauración iniciada',
    mensaje: `Se inició una restauración de backup. No apagues el servidor hasta que termine.`,
    entidad_tipo: 'restauracion',
    entidad_id: id,
    url: `/crm/configuracion/backups/restaurar/${id}`,
    leida: false,
  })

  // Resolver nombre del iniciador para la plantilla de email
  let nombreIniciador = 'Administrador'
  try {
    const { data: u } = await supabase
      .from('usuarios_perfil')
      .select('nombre')
      .eq('id', params.usuario_id)
      .maybeSingle()
    if (u && (u as any).nombre) nombreIniciador = (u as any).nombre
  } catch (err) {
    logger.warn({ modulo: 'backup-restore', mensaje: 'No se pudo obtener nombre del iniciador de restauración', contexto: { usuario_id: params.usuario_id, error: String(err) } })
  }

  await encolarEmailSistema({
    tipo_evento: 'RESTAURACION_INICIADA',
    variables_extra: {
      fecha_inicio: new Date().toLocaleString('es-AR'),
      usuario_iniciador: nombreIniciador,
      nombre_backup: params.nombre_archivo || 'backup seleccionado',
    },
  })

  // Fire-and-forget
  ejecutarRestauracionAsync(id, params).catch((err) => {
    logger.error({ modulo: 'backup-restore', mensaje: `Restauracion ${id} error fatal`, contexto: { error: String(err) } })
  })

  return { ok: true, restauracion_id: id }
}

// ---------------------------------------------------------------------------
// Ejecución async (máquina de estados)
// ---------------------------------------------------------------------------

export async function ejecutarRestauracionAsync(
  id: string,
  params: IniciarRestauracionParams,
): Promise<void> {
  const supabase = getSupabaseAdmin()
  const workDir = path.join(RESTORE_TMP_BASE, `restore-${id}`)
  let archivoCrmbak: string | null = null

  try {
    await fs.mkdir(workDir, { recursive: true })
    await supabase.from('restauraciones').update({ work_dir: workDir }).eq('id', id)

    // =========== VALIDANDO ===========
    await setEstado(id, 'VALIDANDO', { log: 'Validando archivo .crmbak' })

    if (params.fuente === 'BACKUP_EXISTENTE') {
      if (!params.backup_id) throw new Error('backup_id requerido para fuente BACKUP_EXISTENTE')
      const { data: b } = await supabase
        .from('backups')
        .select('nombre, archivo_unico_path')
        .eq('id', params.backup_id)
        .single()
      if (!b) throw new Error('Backup no encontrado en DB')
      archivoCrmbak = (b as any).archivo_unico_path || path.join(BACKUP_BASE, `${(b as any).nombre}.crmbak`)
      try {
        await fs.access(archivoCrmbak!)
      } catch {
        throw new Error(`Archivo no encontrado en disco: ${archivoCrmbak}`)
      }
    } else {
      if (!params.archivo_path) throw new Error('archivo_path requerido para fuente ARCHIVO_SUBIDO')
      archivoCrmbak = params.archivo_path
      try {
        await fs.access(archivoCrmbak)
      } catch {
        throw new Error(`Archivo subido no encontrado: ${archivoCrmbak}`)
      }
    }

    const validacion = await validarArchivoCrmbak(archivoCrmbak!)
    if (!validacion.ok) {
      throw new Error(validacion.error || 'Validación falló')
    }
    await supabase
      .from('restauraciones')
      .update({ metadata_backup: validacion.metadata })
      .eq('id', id)
    await appendLog(id, `Metadata validada: backup del ${validacion.fecha_backup}, versión CRM ${validacion.version_crm}`)

    // =========== PRE_BACKUP (opcional) ===========
    if (params.opciones.crear_pre_backup) {
      await setEstado(id, 'PRE_BACKUP', { log: 'Creando backup de seguridad del estado actual' })
      const preResult = await ejecutarBackup({ tipo: 'PRE_RESTORE', usuario_id: params.usuario_id })
      if (!preResult.ok) {
        throw new Error(`Falló el pre-backup: ${preResult.error}`)
      }
      await supabase
        .from('restauraciones')
        .update({ pre_backup_id: preResult.backup_id })
        .eq('id', id)
      await appendLog(id, `Pre-backup creado: ${preResult.nombre}`)
    }

    // =========== EXTRAYENDO ===========
    await setEstado(id, 'EXTRAYENDO', { log: 'Extrayendo .crmbak' })
    const extractDir = path.join(workDir, 'extract')
    await fs.mkdir(extractDir, { recursive: true })
    await execAsync(`tar -xzf "${archivoCrmbak!}" -C "${extractDir}"`, { maxBuffer: 50 * 1024 * 1024 })
    await appendLog(id, 'Archivos extraídos')

    let srcDir = extractDir
    try {
      await fs.access(path.join(extractDir, 'database.sql.gz'))
    } catch {
      const entries = await fs.readdir(extractDir, { withFileTypes: true })
      for (const e of entries) {
        if (e.isDirectory()) {
          try {
            await fs.access(path.join(extractDir, e.name, 'database.sql.gz'))
            srcDir = path.join(extractDir, e.name)
            break
          } catch {} // Silenciado: archivo/recurso puede no existir
        }
      }
    }

    // =========== RESTAURANDO_DB / STORAGE ===========
    if (params.opciones.restaurar_db) {
      await setEstado(id, 'RESTAURANDO_DB', { log: 'Restaurando base de datos' })
    } else if (params.opciones.restaurar_storage) {
      await setEstado(id, 'RESTAURANDO_STORAGE', { log: 'Restaurando storage' })
    }

    if (params.opciones.restaurar_db || params.opciones.restaurar_storage) {
      const scriptPath = path.join(SCRIPTS_DIR, 'backup-restore.sh')
      const args = [
        `--work-dir=${srcDir}`,
        `--restaurar-db=${params.opciones.restaurar_db ? 1 : 0}`,
        `--restaurar-storage=${params.opciones.restaurar_storage ? 1 : 0}`,
      ]
      try {
        const { stdout, stderr } = await execAsync(`bash "${scriptPath}" ${args.join(' ')}`, {
          maxBuffer: 50 * 1024 * 1024,
          timeout: 30 * 60 * 1000,
        })
        await appendLog(id, `backup-restore.sh OK\n${stdout}\n${stderr}`)
      } catch (err: any) {
        throw new Error(`backup-restore.sh falló: ${err?.stderr || err?.message}`)
      }
    }

    if (params.opciones.restaurar_db && params.opciones.restaurar_storage) {
      await setEstado(id, 'RESTAURANDO_STORAGE', { log: 'Storage restaurado' })
    }

    // =========== FINALIZANDO ===========
    await setEstado(id, 'FINALIZANDO', { log: 'Finalizando y limpiando' })

    if (params.opciones.restaurar_db) {
      try {
        // Limpiamos las sesiones de Supabase Auth (auth.sessions + auth.refresh_tokens)
        // y también la tabla legacy public.sesiones por compat. Cualquier usuario
        // logueado tiene que volver a loguearse, lo cual es correcto post-restore.
        try { await supabase.rpc('fn_invalidar_todas_sesiones_auth') } catch {}
        try { await supabase.from('sesiones').delete().gte('created_at', '1970-01-01') } catch {}
        await appendLog(id, 'Sesiones invalidadas')
      } catch (err) {
        logger.warn({ modulo: 'backup-restore', mensaje: 'Error invalidando sesiones post-restauración', contexto: { restauracion_id: id, error: String(err) } })
      }
    }

    try {
      await fs.rm(workDir, { recursive: true, force: true })
    } catch (err) {
      logger.warn({ modulo: 'backup-restore', mensaje: 'Error limpiando workDir post-restauración', contexto: { workDir, error: String(err) } })
    }

    if (params.fuente === 'ARCHIVO_SUBIDO' && archivoCrmbak) {
      try {
        await fs.unlink(archivoCrmbak)
        const parent = path.dirname(archivoCrmbak)
        if (parent.startsWith('/tmp/')) {
          await fs.rm(parent, { recursive: true, force: true }).catch(() => {
            // Best-effort: si no se puede limpiar el directorio padre, lo hará el cron de limpieza
          })
        }
      } catch (err) {
        logger.warn({ modulo: 'backup-restore', mensaje: 'Error limpiando archivo .crmbak subido', contexto: { archivoCrmbak, error: String(err) } })
      }
    }

    // =========== COMPLETADA ===========
    const inicio = await supabase.from('restauraciones').select('fecha_inicio').eq('id', id).single()
    const duracion = inicio.data
      ? Math.round((Date.now() - new Date((inicio.data as any).fecha_inicio).getTime()) / 1000)
      : null
    await supabase
      .from('restauraciones')
      .update({ duracion_segundos: duracion })
      .eq('id', id)
    await setEstado(id, 'COMPLETADA', { log: `Restauración completada en ${duracion}s` })

    await supabase.from('notificaciones').insert({
      tipo: 'RESTAURACION_COMPLETADA',
      prioridad: 'CRITICA',
      titulo: 'Restauración completada',
      mensaje: `La restauración terminó correctamente. Todas las sesiones se cerraron y hay que volver a loguearse.`,
      entidad_tipo: 'restauracion',
      entidad_id: id,
      url: `/crm/configuracion/backups/restaurar/${id}/exito`,
      leida: false,
    })

    await encolarEmailSistema({
      tipo_evento: 'RESTAURACION_COMPLETADA',
      variables_extra: {
        fecha_fin: new Date().toLocaleString('es-AR'),
        duracion: duracion !== null ? `${duracion}s` : 'desconocida',
        nombre_backup: params.nombre_archivo || 'backup seleccionado',
      },
    })

    if (params.opciones.restaurar_db) {
      // Después de restaurar la DB hay que reiniciar el proceso de Next.js
      // porque el pool de conexiones tiene cacheada metadata que puede
      // quedar inconsistente con el schema recién restaurado.
      //
      // En Docker (RUNNING_IN_DOCKER=true): salimos con exit 0 y dependemos
      // de la policy `restart: unless-stopped` del compose para que Docker
      // levante un proceso nuevo. Es portable, no necesita socket de Docker
      // ni capabilities especiales.
      //
      // En host (legacy systemd): llamamos systemctl restart como antes.
      const enDocker = process.env.RUNNING_IN_DOCKER === 'true'
      if (enDocker) {
        logger.info({ modulo: 'backup-restore', mensaje: 'Saliendo proceso para que Docker lo reinicie tras restauración' })
        // Esperar 1s para que el response llegue al cliente antes de morir.
        setTimeout(() => process.exit(0), 1000)
      } else {
        execAsync('sudo systemctl restart crm-seguros', { timeout: 5000 }).catch((err) => {
          // Fire-and-forget intencional: si el restart falla, el PAS reinicia manualmente. No interrumpe el flujo de completado.
          logger.warn({ modulo: 'backup-restore', mensaje: 'Restart de systemd falló tras restauración', contexto: { error: String(err) } })
        })
      }
    }
  } catch (err: any) {
    const errorMsg = err?.message || 'Error desconocido'
    logger.error({ modulo: 'backup-restore', mensaje: `Restauracion ${id} FALLIDA`, contexto: { error: errorMsg } })

    // Capturar la etapa donde estaba la restauración antes de marcarla FALLIDA
    let etapaFallo: string = 'desconocida'
    try {
      const { data: prev } = await supabase
        .from('restauraciones')
        .select('estado')
        .eq('id', id)
        .maybeSingle()
      if (prev && (prev as any).estado) etapaFallo = (prev as any).estado
    } catch (err) {
      logger.warn({ modulo: 'backup-restore', mensaje: 'No se pudo obtener etapa de fallo de restauración', contexto: { restauracion_id: id, error: String(err) } })
    }

    await setEstado(id, 'FALLIDA', { error: errorMsg, log: `FALLIDA: ${errorMsg}` })

    try {
      await supabase.from('notificaciones').insert({
        tipo: 'RESTAURACION_FALLIDA',
        prioridad: 'CRITICA',
        titulo: 'Restauración fallida',
        mensaje: `La restauración falló: ${errorMsg}`,
        entidad_tipo: 'restauracion',
        entidad_id: id,
        url: `/crm/configuracion/backups/restaurar/${id}/fallida`,
        leida: false,
      })
    } catch (err) {
      logger.error({ modulo: 'backup-restore', mensaje: 'Error creando notificación de restauración fallida', contexto: { restauracion_id: id, error: String(err) } })
    }

    await encolarEmailSistema({
      tipo_evento: 'RESTAURACION_FALLIDA',
      variables_extra: {
        fecha_intento: new Date().toLocaleString('es-AR'),
        etapa_fallo: etapaFallo,
        error_mensaje: errorMsg,
      },
    })

    try {
      await fs.rm(workDir, { recursive: true, force: true })
    } catch (err) {
      logger.warn({ modulo: 'backup-restore', mensaje: 'Error limpiando workDir tras restauración fallida', contexto: { workDir, error: String(err) } })
    }
  }
}

// ---------------------------------------------------------------------------
// Cancelar restauración (solo en fases tempranas)
// ---------------------------------------------------------------------------

export async function cancelarRestauracion(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase.from('restauraciones').select('estado').eq('id', id).single()
  if (!data) return { ok: false, error: 'Restauración no encontrada' }
  const estado = (data as any).estado as EstadoRestauracion

  const fasesCancelables: EstadoRestauracion[] = ['PENDIENTE', 'VALIDANDO', 'PRE_BACKUP']
  if (!fasesCancelables.includes(estado)) {
    return {
      ok: false,
      error: `No se puede cancelar en fase ${estado}. Una vez que empezó a restaurar la DB es más seguro dejarla terminar.`,
    }
  }

  await supabase
    .from('restauraciones')
    .update({ estado: 'CANCELADA', fecha_fin: new Date().toISOString() })
    .eq('id', id)

  return { ok: true }
}
