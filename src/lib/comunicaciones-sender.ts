/**
 * Sistema unificado de envío de comunicaciones por email.
 *
 * Modelo de encolado:
 *  - `encolarEmail()` crea un registro en `email_envios` con estado ENCOLADO.
 *    Valida acepta_marketing, email_bajas y anti-spam antes de encolar.
 *  - `procesarEmailEncolado()` toma un envío ENCOLADO, lo renderiza (leyendo
 *    la plantilla de DB), adjunta documentos si aplica, llama a nodemailer, y
 *    actualiza el estado final. Usado por el cron `enviar-emails-encolados`.
 *  - `enviarComunicacion()` (API legacy) = encolar + procesar inmediatamente.
 *    Usado por el envío manual desde las fichas, que espera respuesta sincrónica.
 */

import { randomUUID } from 'crypto'
import { promises as fsp } from 'fs'
import path from 'path'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { enviarEmail } from '@/lib/email-sender'
import { renderizarPlantilla, escapeHtml } from '@/lib/email-templates/renderizador'
import { logger } from '@/lib/errores/logger'
import { clasificarError, calcularProximoIntento, MAX_INTENTOS } from '@/lib/email-error-classifier'
import {
  obtenerVariablesPersona,
  obtenerVariablesPoliza,
  obtenerVariablesOrganizacion,
} from '@/lib/email-variables'
import { obtenerUrlsPublicas } from '@/lib/urls-publicas'
import type {
  ConfiguracionComunicaciones,
  TipoEnvioEmail,
  EstadoEnvioEmail,
  PrioridadEmailEnvio,
} from '@/types/database'

const PROJECT_DIR = process.cwd()
const STORAGE_BASE = path.join(PROJECT_DIR, 'storage')

function getBaseUrl(override?: string | null): string {
  return override || process.env.URL_CRM_PUBLICA || 'http://localhost:3000'
}

// Decide qué URL base usar en el HTML del email según el destinatario.
//   - Si el email va al PAS / un usuario admin (AUTH_*, SISTEMA_*,
//     NOTIFICACION_INTERNA), usamos `url_crm` — esos emails contienen links a
//     pantallas del CRM admin (aceptar invitación, reset password, etc.) y
//     deben apuntar al dominio donde el admin loguea.
//   - Si el email va al asegurado (AUTOMATICO_*, MANUAL, MASIVO), usamos
//     `url_portal_cliente` — el asegurado NO debe ver el dominio del CRM admin
//     en links del footer, tracking pixel ni logo del email. Fallback a
//     `url_crm` si el portal aún no está configurado.
function elegirBaseUrlSegunTipo(
  tipo: TipoEnvioEmail,
  urls: { crm: string | null; portal_cliente: string | null },
): string {
  const esEmailAdmin =
    tipo.startsWith('AUTH_') ||
    tipo.startsWith('SISTEMA_') ||
    tipo === 'NOTIFICACION_INTERNA'
  if (esEmailAdmin) {
    return getBaseUrl(urls.crm)
  }
  return getBaseUrl(urls.portal_cliente ?? urls.crm)
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface EncolarParams {
  plantilla_codigo: string
  destinatario: { email: string; nombre?: string; persona_id?: string }
  poliza_id?: string
  tipo_envio: TipoEnvioEmail
  enviado_por_usuario_id?: string
  /** Variables extra que el caller quiere inyectar (ej: titulo, cuerpo_mensaje para plantillas GENERAL) */
  variables_extra?: Record<string, string>
  /** Para envío diferido — default NOW() */
  enviar_despues_de?: Date
  /** Para envíos automáticos, aplicar verificación de anti-spam */
  anti_spam?: boolean
  /**
   * Adjuntos explícitos pasados por el caller (ej: envío manual desde ficha).
   * Si se pasan, procesarEmailEncolado los usa tal cual y no va a buscar
   * documentación de la póliza automáticamente.
   */
  archivos_adjuntos?: Array<{ filename: string; path: string; size?: number }>
  /**
   * Prioridad en la cola. 'ALTA' se procesa antes que 'NORMAL'. Default 'NORMAL'.
   * Los emails de sistema críticos (backup fallido, restauración fallida) usan ALTA.
   */
  prioridad?: PrioridadEmailEnvio
  /**
   * Si true, saltea el chequeo de email_bajas y de `acepta_marketing`.
   * Uso exclusivo para notificaciones de sistema al admin: son transaccionales
   * y el admin no puede desuscribirse de ellas.
   */
  bypass_email_bajas?: boolean
}

export interface EncolarResult {
  ok: boolean
  envio_id?: string
  estado?: EstadoEnvioEmail
  error?: string
}

// ---------------------------------------------------------------------------
// Anti-spam
// ---------------------------------------------------------------------------

/**
 * Devuelve true si ya existe un envío del mismo `tipo_envio` para la misma
 * póliza en estados no finales (ENCOLADO/ENVIANDO/ENVIADO). Usado antes de
 * encolar emails automáticos para evitar duplicados.
 *
 * Nota: los emails FALLIDOS sí permiten reintento desde la UI, así que no se
 * cuentan como "ya enviado".
 */
export async function yaSeEnvioEmailAutomatico(
  poliza_id: string,
  tipo_envio: TipoEnvioEmail,
): Promise<boolean> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('email_envios')
    .select('id')
    .eq('poliza_id', poliza_id)
    .eq('tipo_envio', tipo_envio)
    .in('estado', ['ENCOLADO', 'ENVIANDO', 'ENVIADO'])
    .limit(1)
  return !!(data && data.length > 0)
}

// ---------------------------------------------------------------------------
// Helper: adjuntos de póliza
// ---------------------------------------------------------------------------

export interface AdjuntosPolizaResult {
  adjuntos: Array<{ filename: string; path: string; size: number }>
  excluidos: Array<{ filename: string; size: number }>
  excedio_limite: boolean
  url_portal?: string
}

/**
 * Lista los archivos en `storage/polizas/{numero}/documentacion/` y devuelve
 * los que caben en `max_mb`. Los más recientes tienen prioridad (sort desc
 * por fecha de creación). Si excede el límite, devuelve `url_portal` del
 * asegurado (si tiene token activo) para que el email pueda enlazarlo.
 */
export async function obtenerAdjuntosPoliza(
  poliza_id: string,
  max_mb: number = 20,
): Promise<AdjuntosPolizaResult> {
  const supabase = getSupabaseAdmin()
  const maxBytes = max_mb * 1024 * 1024

  const { data: poliza } = await supabase
    .from('polizas')
    .select('numero_poliza, asegurado_id')
    .eq('id', poliza_id)
    .maybeSingle()

  if (!poliza) {
    return { adjuntos: [], excluidos: [], excedio_limite: false }
  }

  const numero = (poliza as any).numero_poliza as string
  const docDir = path.join(STORAGE_BASE, 'polizas', numero, 'documentacion')

  let files: string[] = []
  try {
    files = await fsp.readdir(docDir)
  } catch {
    return { adjuntos: [], excluidos: [], excedio_limite: false }
  }

  // Leer stats en paralelo + filtrar directorios / symlinks raros
  const conStats: Array<{ filename: string; path: string; size: number; mtime: number }> = []
  for (const f of files) {
    try {
      const full = path.join(docDir, f)
      const stat = await fsp.stat(full)
      if (stat.isFile()) {
        conStats.push({ filename: f, path: full, size: stat.size, mtime: stat.mtimeMs })
      }
    } catch (err) {
      logger.warn({ modulo: 'comunicaciones', mensaje: 'Error obteniendo stat de adjunto de póliza', contexto: { archivo: f, error: String(err) } })
    }
  }

  // Prioridad: más recientes primero
  conStats.sort((a, b) => b.mtime - a.mtime)

  const adjuntos: AdjuntosPolizaResult['adjuntos'] = []
  const excluidos: AdjuntosPolizaResult['excluidos'] = []
  let tamanoAcumulado = 0

  for (const f of conStats) {
    if (tamanoAcumulado + f.size <= maxBytes) {
      adjuntos.push({ filename: f.filename, path: f.path, size: f.size })
      tamanoAcumulado += f.size
    } else {
      excluidos.push({ filename: f.filename, size: f.size })
    }
  }

  // Si hubo excluidos, NO generamos url del portal aquí: post-migración 042
  // los tokens viven hasheados, no podemos recuperar el link plano de un
  // acceso ya creado. El email simplemente no va a incluir el link al portal;
  // el cliente puede volver a su email original con el link, o pedirle uno
  // nuevo a su productor.
  const url_portal: string | undefined = undefined

  return {
    adjuntos,
    excluidos,
    excedio_limite: excluidos.length > 0,
    url_portal,
  }
}

/**
 * Bloque HTML para el email de bienvenida/renovación que invita al asegurado
 * a usar el Portal del Asegurado e instalarlo en su celular como app.
 *
 * Solo se incluye si:
 *  - El sistema del Portal está activo en configuración
 *  - La persona asegurada tiene un token activo
 *
 * Si no se cumple, devuelve cadena vacía (caller la concatena sin pensarlo).
 */
export async function obtenerBloquePortalAsegurado(
  poliza_id: string,
  colorMarca?: string,
): Promise<string> {
  const supabase = getSupabaseAdmin()
  try {
    const { data: cfgPortal } = await supabase
      .from('configuracion_portal_cliente')
      .select('activo')
      .limit(1)
      .maybeSingle()
    if (!(cfgPortal as any)?.activo) return ''

    const { data: poliza } = await supabase
      .from('polizas')
      .select('asegurado_id')
      .eq('id', poliza_id)
      .maybeSingle()
    const asegurado_id = (poliza as any)?.asegurado_id
    if (!asegurado_id) return ''

    // Post-migración 042: el token vive hasheado en DB. No podemos recuperar
    // el link plano. Si la persona tiene acceso activo, mostramos el bloque
    // SIN URL plana — apenas un mensaje genérico invitando a usar el portal.
    // El cliente debería tener su link original guardado o se lo pide al PAS.
    const { data: acceso } = await supabase
      .from('portal_cliente_accesos')
      .select('id')
      .eq('persona_id', asegurado_id)
      .eq('revocado', false)
      .maybeSingle()
    if (!acceso) return ''

    const urls = await obtenerUrlsPublicas()
    const portalBase = urls.portal_cliente || getBaseUrl(urls.crm)
    // Sin token, mandamos a la pantalla home del portal: el cliente debe
    // hacer click en el link de su email original (el que llegó al habilitarse
    // el acceso). Si lo perdió, debe pedirle al PAS uno nuevo.
    const urlPortal = portalBase

    const acento = colorMarca && /^#[0-9a-fA-F]{6}$/.test(colorMarca) ? colorMarca : '#0A1628'

    return `
      <div style="margin-top:8px;border:1px solid #dbeafe;background:#eff6ff;border-radius:10px;padding:18px 20px;">
        <p style="margin:0;font-size:11px;color:#1e40af;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Portal del Asegurado</p>
        <h3 style="margin:6px 0 8px;font-size:18px;color:#1e3a8a;">Tenés tu información a un toque</h3>
        <p style="margin:0;font-size:14px;color:#334155;line-height:1.55;">
          Desde tu Portal del Asegurado podés:
        </p>
        <ul style="margin:8px 0 12px;padding-left:20px;font-size:13px;color:#334155;line-height:1.7;">
          <li>Ver tus pólizas y descargar la documentación</li>
          <li>Hacer una denuncia de siniestro</li>
          <li>Seguir el estado de tus siniestros y leer las novedades del trámite</li>
          <li>Consultar los teléfonos de asistencia 24hs</li>
        </ul>
        <p style="margin:0 0 14px;font-size:13px;color:#334155;line-height:1.55;">
          <strong>Instalalo en tu celular como app</strong> para tenerlo siempre a mano:
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px;font-size:12px;color:#475569;line-height:1.5;">
          <tr>
            <td style="padding:0 12px 6px 0;font-weight:600;color:#1e3a8a;white-space:nowrap;">Android</td>
            <td style="padding:0 0 6px;">Abrí el link, tocá el menú del navegador y elegí <em>Instalar app</em> o <em>Agregar a pantalla de inicio</em>.</td>
          </tr>
          <tr>
            <td style="padding:0 12px 0 0;font-weight:600;color:#1e3a8a;white-space:nowrap;">iPhone</td>
            <td style="padding:0;">En Safari tocá el botón <em>Compartir</em> y elegí <em>Agregar a pantalla de inicio</em>.</td>
          </tr>
        </table>
        <p style="margin:0;text-align:center;">
          <a href="${escapeHtml(urlPortal)}" style="display:inline-block;background:${escapeHtml(acento)};color:#ffffff;font-weight:600;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:14px;">
            Abrir mi Portal del Asegurado
          </a>
        </p>
      </div>
    `.trim()
  } catch (err) {
    logger.warn({ modulo: 'comunicaciones', mensaje: 'Error generando bloque del portal en email', contexto: { poliza_id, error: String(err) } })
    return ''
  }
}

// ---------------------------------------------------------------------------
// Encolar
// ---------------------------------------------------------------------------

/**
 * Crea un registro en email_envios con estado ENCOLADO (o estados de exclusión
 * si corresponde). No envía nada — solo persiste la intención. El cron
 * `enviar-emails-encolados` los procesa después.
 *
 * Valida:
 *  - sistema de comunicaciones activo
 *  - email no está en email_bajas
 *  - persona.acepta_marketing !== false
 *  - anti-spam si `anti_spam=true` + poliza_id
 */
export async function encolarEmail(params: EncolarParams): Promise<EncolarResult> {
  const supabase = getSupabaseAdmin()
  const token = randomUUID()
  const prioridad: PrioridadEmailEnvio = params.prioridad || 'NORMAL'
  const bypass = params.bypass_email_bajas === true

  try {
    const { data: config } = await supabase
      .from('configuracion_comunicaciones')
      .select('*')
      .limit(1)
      .maybeSingle()

    const configuracion = config as unknown as ConfiguracionComunicaciones | null
    if (!configuracion?.activo) {
      return { ok: false, error: 'El sistema de comunicaciones no está activo' }
    }

    // Anti-spam para automáticos
    if (params.anti_spam && params.poliza_id) {
      const yaExiste = await yaSeEnvioEmailAutomatico(params.poliza_id, params.tipo_envio)
      if (yaExiste) {
        return { ok: false, error: 'Ya existe un email del mismo tipo para esta póliza' }
      }
    }

    // Bajas — los emails de sistema al admin bypassan este check
    if (!bypass) {
      const { data: baja, error: errorBaja } = await supabase
        .from('email_bajas')
        .select('id')
        .eq('email', params.destinatario.email.toLowerCase())
        .maybeSingle()

      // FAIL CLOSED: si la query a email_bajas falla, NO enviamos. Es mucho
      // peor mandarle un email a alguien que se dio de baja explícitamente
      // que no enviarle a alguien que sí podría recibir. El caller verá ok:false
      // y puede reintentar manualmente después.
      if (errorBaja) {
        logger.error({
          codigo: 'ERR_DB_001',
          modulo: 'comunicaciones',
          mensaje: 'No se pudo verificar email_bajas — abortando envío por seguridad',
          contexto: {
            destinatario: params.destinatario.email,
            tipo_envio: params.tipo_envio,
            error: errorBaja.message,
          },
        })
        return {
          ok: false,
          error: 'No se pudo verificar la lista de bajas. Envío abortado por seguridad.',
        }
      }

      if (baja) {
        const { data: excluido } = await supabase
          .from('email_envios')
          .insert({
            token_tracking: token,
            plantilla_codigo: params.plantilla_codigo,
            destinatario_email: params.destinatario.email,
            destinatario_nombre: params.destinatario.nombre || null,
            persona_id: params.destinatario.persona_id || null,
            poliza_id: params.poliza_id || null,
            asunto: '',
            tipo_envio: params.tipo_envio,
            prioridad,
            estado: 'EXCLUIDO_BAJA',
            enviado_por_usuario_id: params.enviado_por_usuario_id || null,
          })
          .select('id')
          .single()

        return {
          ok: false,
          envio_id: (excluido as any)?.id,
          estado: 'EXCLUIDO_BAJA',
          error: 'El destinatario se dio de baja de las comunicaciones',
        }
      }
    }

    // Marketing opt-out — también se bypassa para emails de sistema
    if (!bypass && params.destinatario.persona_id) {
      const { data: persona } = await supabase
        .from('personas')
        .select('acepta_marketing')
        .eq('id', params.destinatario.persona_id)
        .maybeSingle()

      if (persona && (persona as any).acepta_marketing === false) {
        const { data: excluido } = await supabase
          .from('email_envios')
          .insert({
            token_tracking: token,
            plantilla_codigo: params.plantilla_codigo,
            destinatario_email: params.destinatario.email,
            destinatario_nombre: params.destinatario.nombre || null,
            persona_id: params.destinatario.persona_id,
            poliza_id: params.poliza_id || null,
            asunto: '',
            tipo_envio: params.tipo_envio,
            prioridad,
            estado: 'EXCLUIDO_NO_MARKETING',
            enviado_por_usuario_id: params.enviado_por_usuario_id || null,
          })
          .select('id')
          .single()

        return {
          ok: false,
          envio_id: (excluido as any)?.id,
          estado: 'EXCLUIDO_NO_MARKETING',
          error: 'La persona no acepta comunicaciones de marketing',
        }
      }
    }

    // Variables iniciales (guardadas para el cron — se refrescan al procesar)
    const variables_extra = params.variables_extra || {}

    // Encolar
    const { data: envio, error } = await supabase
      .from('email_envios')
      .insert({
        token_tracking: token,
        plantilla_codigo: params.plantilla_codigo,
        destinatario_email: params.destinatario.email,
        destinatario_nombre: params.destinatario.nombre || null,
        persona_id: params.destinatario.persona_id || null,
        poliza_id: params.poliza_id || null,
        asunto: '',
        tipo_envio: params.tipo_envio,
        prioridad,
        estado: 'ENCOLADO',
        enviar_despues_de: (params.enviar_despues_de || new Date()).toISOString(),
        variables_usadas: variables_extra,
        archivos_adjuntos: params.archivos_adjuntos || null,
        enviado_por_usuario_id: params.enviado_por_usuario_id || null,
      })
      .select('id')
      .single()

    if (error || !envio) {
      return { ok: false, error: error?.message || 'No se pudo encolar el email' }
    }

    return { ok: true, envio_id: (envio as any).id, estado: 'ENCOLADO' }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Error inesperado encolando email' }
  }
}

// ---------------------------------------------------------------------------
// Procesar un envío ENCOLADO
// ---------------------------------------------------------------------------

/**
 * Carga un envío ENCOLADO, lo renderiza, adjunta documentos si aplica, y llama
 * a nodemailer. Actualiza el estado final. Devuelve ok=true solo si el email
 * salió realmente.
 */
export async function procesarEmailEncolado(envio_id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabaseAdmin()
  const urlsPublicas = await obtenerUrlsPublicas()

  // Marcar ENVIANDO atómicamente. Aceptamos también FALLIDO (reintento de
  // backoff): el cron solo nos llama cuando proximo_intento_en <= NOW().
  const { data: envio } = await supabase
    .from('email_envios')
    .update({ estado: 'ENVIANDO' })
    .eq('id', envio_id)
    .in('estado', ['ENCOLADO', 'FALLIDO'])
    .select('*')
    .single()

  if (!envio) {
    return { ok: false, error: 'Envío no está en estado procesable (ENCOLADO/FALLIDO)' }
  }

  const e = envio as any
  const token = e.token_tracking as string
  // baseUrl depende del destinatario: admin → url_crm, asegurado → url_portal.
  // Así los emails al asegurado nunca exponen el dominio del CRM admin.
  const baseUrl = elegirBaseUrlSegunTipo(e.tipo_envio as TipoEnvioEmail, urlsPublicas)

  try {
    // Resolver variables frescas
    const [variablesPersona, variablesPoliza, variablesOrganizacion] = await Promise.all([
      e.persona_id ? obtenerVariablesPersona(e.persona_id) : Promise.resolve({ nombre: e.destinatario_nombre || '' }),
      e.poliza_id ? obtenerVariablesPoliza(e.poliza_id) : Promise.resolve({}),
      obtenerVariablesOrganizacion(),
    ])

    const variables: Record<string, string> = {
      ...variablesOrganizacion,
      ...variablesPoliza,
      ...variablesPersona,
      ...(e.variables_usadas as Record<string, string> | null ?? {}),
    }

    // Leer config para adjuntos
    const { data: config } = await supabase
      .from('configuracion_comunicaciones')
      .select('max_adjuntos_mb, adjuntar_docs_renovacion')
      .limit(1)
      .maybeSingle()
    const maxMb = (config as any)?.max_adjuntos_mb ?? 20

    // Adjuntos:
    //  1. Si el record ya tiene archivos_adjuntos explícitos (envío manual
    //     con adjuntos propios del usuario) → usarlos tal cual
    //  2. Si no, y es un flujo automático con póliza → obtener docs de la póliza
    let adjuntos: Array<{ filename: string; path: string; size?: number }> = []
    let bloqueExtraHtml: string | undefined
    const tipo: TipoEnvioEmail = e.tipo_envio
    const adjuntosExplicitos = Array.isArray(e.archivos_adjuntos) ? e.archivos_adjuntos : null
    const llevaAdjuntosAutomaticos =
      !adjuntosExplicitos &&
      e.poliza_id &&
      (tipo === 'AUTOMATICO_BIENVENIDA' ||
        (tipo === 'AUTOMATICO_RENOVACION' && (config as any)?.adjuntar_docs_renovacion !== false))

    if (adjuntosExplicitos) {
      adjuntos = adjuntosExplicitos
    } else if (llevaAdjuntosAutomaticos) {
      const info = await obtenerAdjuntosPoliza(e.poliza_id, maxMb)
      adjuntos = info.adjuntos
      if (info.excedio_limite) {
        const listaExcluidosHtml = info.excluidos
          .map((x) => `<li style="margin:2px 0;">${escapeHtml(x.filename)}</li>`)
          .join('')
        const linkHtml = info.url_portal
          ? `<p style="margin:8px 0 0;">Podés descargarlos desde tu Portal del Asegurado:</p>
             <p style="margin:8px 0 0;"><a href="${escapeHtml(info.url_portal)}" style="color:#0052CC;font-weight:bold;">Abrir mi Portal del Asegurado</a></p>`
          : `<p style="margin:8px 0 0;">Contactanos si necesitás recibirlos por otro medio.</p>`
        bloqueExtraHtml = `
          <div style="border-top:1px solid #e2e8f0;padding-top:16px;">
            <p style="margin:0;font-size:14px;color:#64748b;"><strong>Algunos archivos no entraron en este email por superar el tamaño máximo:</strong></p>
            <ul style="margin:8px 0 0;padding-left:20px;font-size:13px;color:#64748b;">${listaExcluidosHtml}</ul>
            ${linkHtml}
          </div>
        `
      }
    }

    // Bloque del Portal del Asegurado en bienvenida y renovación.
    // Se anexa después del bloque de adjuntos excluidos (si lo hubo).
    if (e.poliza_id && (tipo === 'AUTOMATICO_BIENVENIDA' || tipo === 'AUTOMATICO_RENOVACION')) {
      const portalHtml = await obtenerBloquePortalAsegurado(
        e.poliza_id,
        variables.organizacion_color_marca || undefined,
      )
      if (portalHtml) {
        bloqueExtraHtml = (bloqueExtraHtml ? bloqueExtraHtml + '\n' : '') + portalHtml
      }
    }

    // Organización
    const organizacion = {
      nombre: variables.organizacion_nombre || 'Productor de Seguros',
      telefono: variables.organizacion_telefono,
      email: variables.organizacion_email,
      logo_url: variables.organizacion_logo ? `${baseUrl}/api/storage/${variables.organizacion_logo}` : undefined,
      color_marca: variables.organizacion_color_marca || undefined,
      email_header_estilo: (variables.organizacion_email_header_estilo as 'banda' | 'compacto' | 'lateral' | undefined) || undefined,
      email_header_subtitulo: variables.organizacion_email_header_subtitulo || undefined,
    }

    // URLs de tracking
    const unsubscribe_url = `${baseUrl}/api/comunicaciones/unsubscribe/${token}`
    const tracking_pixel_url = `${baseUrl}/api/track/open/${token}`

    // Renderizar plantilla
    const { asunto, cuerpo_html } = await renderizarPlantilla(
      e.plantilla_codigo,
      variables,
      organizacion,
      {
        unsubscribe_url,
        tracking_pixel_url,
        bloque_extra_html: bloqueExtraHtml,
      },
    )

    // Reemplazar links por tracking
    const cuerpo_con_tracking = cuerpo_html.replace(/href="(https?:\/\/[^"]+)"/g, (match, url) => {
      if (url.includes('/api/comunicaciones/unsubscribe/') || url.includes('/api/track/')) return match
      return `href="${baseUrl}/api/track/click/${token}?url=${encodeURIComponent(url)}"`
    })

    // Guardar snapshot del contenido renderizado
    const adjuntos_info = adjuntos.map((a) => ({
      filename: a.filename,
      path: a.path,
      size: a.size ?? 0,
    }))

    await supabase
      .from('email_envios')
      .update({
        asunto,
        cuerpo_html: cuerpo_con_tracking,
        variables_usadas: variables,
        archivos_adjuntos: adjuntos_info,
      })
      .eq('id', envio_id)

    // Enviar
    const resultado = await enviarEmail({
      to: e.destinatario_email,
      subject: asunto,
      html: cuerpo_con_tracking,
      attachments: adjuntos.map((a) => ({ filename: a.filename, path: a.path })),
    })

    if (resultado.ok) {
      await supabase
        .from('email_envios')
        .update({
          estado: 'ENVIADO',
          fecha_envio: new Date().toISOString(),
          intentos: (e.intentos || 0) + 1,
          proximo_intento_en: null,
          error_tipo: null,
        })
        .eq('id', envio_id)
      return { ok: true }
    } else {
      await marcarFalladoConBackoff(envio_id, e.intentos || 0, resultado.error || 'Error desconocido')
      return { ok: false, error: resultado.error }
    }
  } catch (err: any) {
    const msg = err?.message || 'Error inesperado al procesar envío'
    await marcarFalladoConBackoff(envio_id, e.intentos || 0, msg)
    return { ok: false, error: msg }
  }
}

/**
 * Marca un envío como FALLIDO clasificando el error y decidiendo si se
 * reintenta más tarde (TRANSITORIO con backoff) o si queda como definitivo
 * (PERMANENTE, o TRANSITORIO que ya agotó sus 4 intentos).
 */
async function marcarFalladoConBackoff(
  envio_id: string,
  intentosPrevios: number,
  mensajeError: string,
): Promise<void> {
  const supabase = getSupabaseAdmin()
  const intentos = intentosPrevios + 1
  const tipo = clasificarError(mensajeError)
  // Solo intentamos de nuevo si el error es transitorio Y no superamos el máximo.
  const proximoIntento = tipo === 'TRANSITORIO' && intentos < MAX_INTENTOS
    ? calcularProximoIntento(intentos - 1)
    : null

  await supabase
    .from('email_envios')
    .update({
      estado: 'FALLIDO',
      error_mensaje: mensajeError,
      error_tipo: tipo,
      intentos,
      proximo_intento_en: proximoIntento ? proximoIntento.toISOString() : null,
    })
    .eq('id', envio_id)

  logger.warn({
    modulo: 'comunicaciones',
    mensaje: 'Email FALLIDO',
    contexto: {
      envio_id,
      intentos,
      tipo,
      reintentara_en: proximoIntento?.toISOString() ?? 'no_reintenta',
      error: mensajeError.slice(0, 200),
    },
  })
}

// ---------------------------------------------------------------------------
// API legacy: enviar síncrono (encolar + procesar inmediatamente)
// ---------------------------------------------------------------------------

/**
 * Mantiene la API vieja para envíos manuales desde las fichas: encola el email
 * y lo procesa inmediatamente. Adapta los parámetros del formato viejo
 * (`campos_editables`) al nuevo sistema vía `variables_extra`.
 */
export async function enviarComunicacion(params: {
  plantilla_codigo: string
  destinatario: { email: string; nombre?: string; persona_id?: string }
  poliza_id?: string
  campos_editables?: { titulo?: string; cuerpo?: string; cta_texto?: string; cta_url?: string }
  archivos_adjuntos?: Array<{ filename: string; path: string }>
  tipo_envio: TipoEnvioEmail
  enviado_por_usuario_id?: string
  variables_extra?: Record<string, string>
}): Promise<{ ok: boolean; envio_id?: string; error?: string }> {
  // Las plantillas generales usan `titulo` y `cuerpo_mensaje` como variables.
  // Si el caller pasó campos_editables legacy, los mapeo.
  const variables_extra: Record<string, string> = {
    ...(params.variables_extra || {}),
    ...(params.campos_editables?.titulo ? { titulo: params.campos_editables.titulo } : {}),
    ...(params.campos_editables?.cuerpo ? { cuerpo_mensaje: params.campos_editables.cuerpo } : {}),
  }

  const encoladoResult = await encolarEmail({
    plantilla_codigo: params.plantilla_codigo,
    destinatario: params.destinatario,
    poliza_id: params.poliza_id,
    tipo_envio: params.tipo_envio,
    enviado_por_usuario_id: params.enviado_por_usuario_id,
    variables_extra,
    archivos_adjuntos: params.archivos_adjuntos,
    anti_spam: false, // los envíos manuales no aplican anti-spam
  })

  if (!encoladoResult.ok || !encoladoResult.envio_id) {
    return { ok: false, envio_id: encoladoResult.envio_id, error: encoladoResult.error }
  }

  // Si fue excluido (baja / no marketing), no procesar
  if (encoladoResult.estado && encoladoResult.estado !== 'ENCOLADO') {
    return { ok: false, envio_id: encoladoResult.envio_id, error: encoladoResult.error }
  }

  // Procesar inmediatamente (los adjuntos ya quedaron en el row)
  const procesadoResult = await procesarEmailEncolado(encoladoResult.envio_id)

  return {
    ok: procesadoResult.ok,
    envio_id: encoladoResult.envio_id,
    error: procesadoResult.error,
  }
}

// ---------------------------------------------------------------------------
// Emails de sistema (notificaciones al admin)
// ---------------------------------------------------------------------------

/**
 * Eventos de sistema que generan una notificación por email al admin.
 *
 * IMPORTANTE — Anti-bucle infinito:
 * Si `encolarEmailSistema` se llama desde el cron de envío al detectar un
 * fallo, NO se debe encolar una notificación de sistema por un email que es a
 * su vez de sistema (`tipo_envio.startsWith('SISTEMA_')`). El cron filtra
 * antes de llamar a esta función; si agregás otro caller, respetá la regla.
 */
export type TipoEventoSistema =
  | 'BACKUP_COMPLETADO'
  | 'BACKUP_FALLIDO'
  | 'BACKUP_SYNC_FALLIDO'
  | 'RESTAURACION_INICIADA'
  | 'RESTAURACION_COMPLETADA'
  | 'RESTAURACION_FALLIDA'
  | 'PDF_PROCESADO'
  | 'PDF_FALLIDO'
  | 'EMAIL_AUTOMATICO_FALLIDO'
  | 'ERROR_CRITICO'
  | 'SUGERENCIA_CORRECCION_PORTAL'
  | 'SOLICITUD_BLANQUEO_PASSWORD'
  | 'LICENCIA_POR_VENCER'
  | 'LICENCIA_EN_GRACIA'
  | 'LICENCIA_BLOQUEADA'
  | 'ROLLBACK_UPDATE'

interface MapeoEventoSistema {
  plantilla_codigo: string
  tipo_envio: TipoEnvioEmail
  prioridad: PrioridadEmailEnvio
  es_critico: boolean
  es_informativo: boolean
  /**
   * Columna en `configuracion_comunicaciones` que controla este evento.
   * Solo se usa para eventos informativos. Si está vacío, el evento siempre
   * se envía (transaccional/crítico).
   */
  campo_toggle?: string
}

/**
 * Mapea cada evento de sistema a su plantilla, tipo_envio, prioridad y
 * categoría (crítico vs informativo).
 *
 * - Críticos (ALTA): backup fallido, sync fallido, restauración fallida.
 *   Siempre notifican.
 * - Informativos (NORMAL): el resto. Solo notifican si el admin activó el
 *   toggle individual correspondiente en `configuracion_comunicaciones`.
 */
function mapearTipoEvento(tipo: TipoEventoSistema): MapeoEventoSistema {
  const mapa: Record<TipoEventoSistema, MapeoEventoSistema> = {
    BACKUP_COMPLETADO: {
      plantilla_codigo: 'sistema_backup_completado',
      tipo_envio: 'SISTEMA_BACKUP_COMPLETADO',
      prioridad: 'NORMAL',
      es_critico: false,
      es_informativo: true,
      campo_toggle: 'notificar_admin_backup_completado',
    },
    BACKUP_FALLIDO: {
      plantilla_codigo: 'sistema_backup_fallido',
      tipo_envio: 'SISTEMA_BACKUP_FALLIDO',
      prioridad: 'ALTA',
      es_critico: true,
      es_informativo: false,
    },
    BACKUP_SYNC_FALLIDO: {
      plantilla_codigo: 'sistema_backup_sync_fallido',
      tipo_envio: 'SISTEMA_BACKUP_SYNC_FALLIDO',
      prioridad: 'ALTA',
      es_critico: true,
      es_informativo: false,
    },
    RESTAURACION_INICIADA: {
      plantilla_codigo: 'sistema_restauracion_iniciada',
      tipo_envio: 'SISTEMA_RESTAURACION_INICIADA',
      prioridad: 'NORMAL',
      es_critico: false,
      es_informativo: true,
      campo_toggle: 'notificar_admin_restauracion_iniciada',
    },
    RESTAURACION_COMPLETADA: {
      plantilla_codigo: 'sistema_restauracion_completada',
      tipo_envio: 'SISTEMA_RESTAURACION_COMPLETADA',
      prioridad: 'NORMAL',
      es_critico: false,
      es_informativo: true,
      campo_toggle: 'notificar_admin_restauracion_completada',
    },
    RESTAURACION_FALLIDA: {
      plantilla_codigo: 'sistema_restauracion_fallida',
      tipo_envio: 'SISTEMA_RESTAURACION_FALLIDA',
      prioridad: 'ALTA',
      es_critico: true,
      es_informativo: false,
    },
    PDF_PROCESADO: {
      plantilla_codigo: 'sistema_pdf_procesado',
      tipo_envio: 'SISTEMA_PDF_PROCESADO',
      prioridad: 'NORMAL',
      es_critico: false,
      es_informativo: true,
      campo_toggle: 'notificar_admin_pdf_procesado',
    },
    PDF_FALLIDO: {
      plantilla_codigo: 'sistema_pdf_fallido',
      tipo_envio: 'SISTEMA_PDF_FALLIDO',
      prioridad: 'NORMAL',
      es_critico: false,
      es_informativo: true,
      campo_toggle: 'notificar_admin_pdf_fallido',
    },
    EMAIL_AUTOMATICO_FALLIDO: {
      plantilla_codigo: 'sistema_email_automatico_fallido',
      tipo_envio: 'SISTEMA_EMAIL_AUTOMATICO_FALLIDO',
      prioridad: 'NORMAL',
      es_critico: false,
      es_informativo: true,
      campo_toggle: 'notificar_admin_email_automatico_fallido',
    },
    ERROR_CRITICO: {
      plantilla_codigo: 'sistema_error_critico',
      tipo_envio: 'SISTEMA_ERROR_CRITICO',
      prioridad: 'ALTA',
      es_critico: true,
      es_informativo: false,
    },
    SUGERENCIA_CORRECCION_PORTAL: {
      plantilla_codigo: 'sistema_sugerencia_correccion_portal',
      tipo_envio: 'SISTEMA_SUGERENCIA_CORRECCION_PORTAL',
      prioridad: 'NORMAL',
      es_critico: false,
      // Es transaccional desde el cliente: siempre se envía, no depende del toggle.
      es_informativo: false,
    },
    SOLICITUD_BLANQUEO_PASSWORD: {
      plantilla_codigo: 'sistema_solicitud_blanqueo_password',
      tipo_envio: 'SISTEMA_SOLICITUD_BLANQUEO_PASSWORD',
      prioridad: 'ALTA',
      // Es crítico: necesita la atención del admin para que el user pueda
      // recuperar su acceso. Siempre se envía, no depende del toggle de
      // informativos.
      es_critico: true,
      es_informativo: false,
    },
    LICENCIA_POR_VENCER: {
      plantilla_codigo: 'sistema_licencia_por_vencer',
      tipo_envio: 'SISTEMA_LICENCIA_POR_VENCER',
      prioridad: 'ALTA',
      es_critico: true,
      es_informativo: false,
    },
    LICENCIA_EN_GRACIA: {
      plantilla_codigo: 'sistema_licencia_en_gracia',
      tipo_envio: 'SISTEMA_LICENCIA_EN_GRACIA',
      prioridad: 'ALTA',
      es_critico: true,
      es_informativo: false,
    },
    LICENCIA_BLOQUEADA: {
      plantilla_codigo: 'sistema_licencia_bloqueada',
      tipo_envio: 'SISTEMA_LICENCIA_BLOQUEADA',
      prioridad: 'ALTA',
      es_critico: true,
      es_informativo: false,
    },
    ROLLBACK_UPDATE: {
      plantilla_codigo: 'sistema_rollback_update',
      tipo_envio: 'SISTEMA_ROLLBACK_UPDATE',
      prioridad: 'ALTA',
      // Crítico: el admin necesita saber que un update falló y el sistema
      // volvió a la versión anterior, incluso si volvió de forma exitosa.
      es_critico: true,
      es_informativo: false,
    },
  }
  return mapa[tipo]
}

/**
 * Devuelve los admins activos (rol=ADMIN, activo=true) con email válido.
 * Usado como destinatarios de las notificaciones de sistema.
 *
 * Exportado para que otros helpers (ej: `fidcore-emails`) puedan resolver
 * destinatarios admin sin duplicar la query.
 */
export async function obtenerAdminsActivos(): Promise<Array<{ id: string; email: string; nombre: string }>> {
  const supabase = getSupabaseAdmin()
  // 1) Listar IDs y nombres desde usuarios_perfil
  const { data } = await supabase
    .from('usuarios_perfil')
    .select('id, nombre')
    .eq('rol', 'ADMIN')
    .eq('activo', true)

  const admins = (data as Array<{ id: string; nombre: string | null }> | null) ?? []
  if (admins.length === 0) return []

  // 2) Resolver emails desde auth.users via admin.listUsers (paginado)
  const emailsPorId = new Map<string, string>()
  let pageActual = 1
  while (true) {
    const { data: pagina } = await supabase.auth.admin.listUsers({ page: pageActual, perPage: 200 })
    const users = pagina?.users ?? []
    for (const u of users) {
      if (u.email) emailsPorId.set(u.id, u.email)
    }
    if (users.length < 200) break
    pageActual++
    if (pageActual > 50) break
  }

  return admins
    .map((a) => ({ id: a.id, email: emailsPorId.get(a.id) ?? '', nombre: a.nombre || 'Administrador' }))
    .filter((a) => !!a.email)
}

export interface EncolarEmailSistemaParams {
  tipo_evento: TipoEventoSistema
  variables_extra: Record<string, string>
  /** Diferir el envío (opcional). Default: ahora. */
  enviar_despues_de?: Date
}

export interface EncolarEmailSistemaResult {
  ok: boolean
  envios_creados: number
  mensaje?: string
  error?: string
}

/**
 * Encola notificaciones de sistema al admin. Resuelve automáticamente la
 * plantilla, la prioridad y los destinatarios (todos los admins activos).
 *
 * - Eventos CRÍTICOS (ALTA): siempre se envían.
 * - Eventos INFORMATIVOS (NORMAL): solo si
 *   `configuracion_comunicaciones.notificar_admin_eventos_informativos=true`.
 *
 * No consulta `email_bajas` ni `acepta_marketing` (bypass completo): los
 * admins son destinatarios transaccionales, no pueden desuscribirse.
 *
 * Nunca tira: cualquier error se loggea y se devuelve `ok:false`, para que
 * los callers (backup, restore, agente PDF) nunca rompan su flujo principal
 * por un problema de notificación.
 */
export async function encolarEmailSistema(
  params: EncolarEmailSistemaParams,
): Promise<EncolarEmailSistemaResult> {
  try {
    const config = mapearTipoEvento(params.tipo_evento)
    if (!config) {
      return { ok: false, envios_creados: 0, error: `Tipo de evento desconocido: ${params.tipo_evento}` }
    }

    const supabase = getSupabaseAdmin()

    // Gate de eventos informativos: consulta el toggle individual de ese evento.
    // Si no hay `campo_toggle` definido, se asume transaccional y siempre se envía.
    if (config.es_informativo && config.campo_toggle) {
      const { data: conf } = await supabase
        .from('configuracion_comunicaciones')
        .select(config.campo_toggle)
        .limit(1)
        .maybeSingle()
      const activado = (conf as any)?.[config.campo_toggle] === true
      if (!activado) {
        return {
          ok: true,
          envios_creados: 0,
          mensaje: `Evento ${params.tipo_evento} desactivado por toggle individual`,
        }
      }
    }

    const admins = await obtenerAdminsActivos()
    if (admins.length === 0) {
      return { ok: true, envios_creados: 0, mensaje: 'No hay admins activos con email' }
    }

    let creados = 0
    for (const admin of admins) {
      const res = await encolarEmail({
        plantilla_codigo: config.plantilla_codigo,
        destinatario: { email: admin.email, nombre: admin.nombre },
        tipo_envio: config.tipo_envio,
        prioridad: config.prioridad,
        variables_extra: {
          ...params.variables_extra,
          nombre_admin: admin.nombre,
        },
        enviar_despues_de: params.enviar_despues_de,
        anti_spam: false,
        bypass_email_bajas: true,
      })
      if (res.ok) creados++
      else logger.warn({ modulo: 'comunicaciones', mensaje: `No se pudo encolar email a ${admin.email}`, contexto: { error: res.error } })
    }

    return { ok: creados > 0, envios_creados: creados }
  } catch (err: any) {
    logger.error({ modulo: 'comunicaciones', mensaje: 'encolarEmailSistema error inesperado', contexto: { error: err?.message || String(err) } })
    return { ok: false, envios_creados: 0, error: err?.message || 'Error inesperado' }
  }
}
