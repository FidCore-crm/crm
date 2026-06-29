/**
 * Helpers para el sistema de recepción de leads desde formularios web
 * externos (migración 103).
 *
 * Public API:
 *   - obtenerConfiguracion()
 *   - regenerarToken()
 *   - resolverUsuarioAsignado(modo, dominio?)
 *   - dominioPermitido(origen, dominiosPermitidos)
 *   - normalizarDominio(input)
 *   - generarHtmlFormEjemplo(urlPublica, redirectTo?)
 *   - registrarIntento(params) — fire-and-forget
 *   - incrementarContadores()
 *
 * Importante:
 *   - El token vive en la URL pública del endpoint, no en headers, así el
 *     PAS puede testear con un POST simple desde su navegador o curl.
 *   - El round-robin se hace via cursor `ultimo_usuario_asignado_id` en la
 *     misma fila singleton, así sobrevive a reinicios.
 */

import crypto from 'crypto'
import { getSupabaseAdmin } from './supabase/server'
// Import directo al logger en vez del barrel `./errores` para evitar arrastrar
// la cadena de `persistencia.ts → comunicaciones-sender → email-sender (nodemailer)`,
// que rompe el bundling de páginas client que importan helpers de este archivo.
import { logger } from './errores/logger'

// Re-export para preservar la API pública existente (callers viejos siguen
// importando estos tipos desde '@/lib/leads-web').
export type { ModoAsignacionLeadsWeb, MotivoRechazoLeadsWeb } from './leads-web-shared'
export {
  normalizarDominio,
  dominioPermitido,
  corsHeadersParaOrigen,
  generarHtmlFormEjemplo,
} from './leads-web-shared'

import type {
  ModoAsignacionLeadsWeb,
  MotivoRechazoLeadsWeb,
} from './leads-web-shared'

export interface ConfiguracionLeadsWeb {
  id: string
  activo: boolean
  token: string
  dominios_permitidos: string[]
  modo_asignacion: ModoAsignacionLeadsWeb
  ultimo_usuario_asignado_id: string | null
  notificar_email_admin: boolean
  notificar_inapp: boolean
  recibidos_mes_actual: number
  recibidos_historico: number
  reset_contador_mes: string
  ultimo_lead_recibido_en: string | null
}

// ----------------------------------------------------------------------------
// Configuración singleton
// ----------------------------------------------------------------------------

export async function obtenerConfiguracion(): Promise<ConfiguracionLeadsWeb | null> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('configuracion_leads_web')
    .select('*')
    .limit(1)
    .maybeSingle()
  if (error) {
    logger.warn({ modulo: 'leads-web', mensaje: 'Error leyendo configuracion_leads_web', contexto: { error: error.message } })
    return null
  }
  return data as ConfiguracionLeadsWeb | null
}

export async function regenerarToken(): Promise<string> {
  const nuevoToken = crypto.randomBytes(32).toString('hex')
  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('configuracion_leads_web')
    .update({ token: nuevoToken })
    .neq('id', '00000000-0000-0000-0000-000000000000')
  if (error) {
    logger.error({ modulo: 'leads-web', mensaje: 'No se pudo regenerar el token', contexto: { error: error.message } })
    throw new Error('No se pudo regenerar el token: ' + error.message)
  }
  return nuevoToken
}

// ----------------------------------------------------------------------------
// Asignación de usuario
// ----------------------------------------------------------------------------

interface UsuarioActivo {
  id: string
  rol: string | null
  acceso_cartera: string | null
}

/**
 * Decide a qué usuario asignar un lead entrante según el modo configurado.
 * Devuelve `null` si el modo es SIN_ASIGNAR o si no hay usuarios disponibles.
 *
 * - ROTATIVO: round-robin entre usuarios activos (cualquier rol).
 *   Cursor en `configuracion_leads_web.ultimo_usuario_asignado_id`.
 * - ADMIN: devuelve el primer admin activo (ordenado por created_at).
 * - SIN_ASIGNAR: devuelve null.
 */
export async function resolverUsuarioAsignado(
  cfg: ConfiguracionLeadsWeb,
): Promise<string | null> {
  if (cfg.modo_asignacion === 'SIN_ASIGNAR') return null

  const supabase = getSupabaseAdmin()
  const { data: usuariosData } = await supabase
    .from('usuarios_perfil')
    .select('id, rol, acceso_cartera')
    .eq('activo', true)
    .order('created_at', { ascending: true })

  const usuarios = (usuariosData ?? []) as UsuarioActivo[]
  if (usuarios.length === 0) return null

  if (cfg.modo_asignacion === 'ADMIN') {
    const admin = usuarios.find((u) => u.rol === 'ADMIN')
    return admin?.id ?? usuarios[0]?.id ?? null
  }

  // ROTATIVO — entre todos los activos, usando cursor
  if (usuarios.length === 1) {
    const unicoId = usuarios[0].id
    await actualizarCursor(unicoId)
    return unicoId
  }

  const cursor = cfg.ultimo_usuario_asignado_id
  let siguienteIdx = 0
  if (cursor) {
    const idxActual = usuarios.findIndex((u) => u.id === cursor)
    if (idxActual >= 0) {
      siguienteIdx = (idxActual + 1) % usuarios.length
    }
  }
  const siguienteId = usuarios[siguienteIdx]?.id ?? null
  if (siguienteId) await actualizarCursor(siguienteId)
  return siguienteId
}

async function actualizarCursor(usuarioId: string) {
  const supabase = getSupabaseAdmin()
  await supabase
    .from('configuracion_leads_web')
    .update({ ultimo_usuario_asignado_id: usuarioId })
    .neq('id', '00000000-0000-0000-0000-000000000000')
}

// ----------------------------------------------------------------------------
// Diagnóstico / Auditoría
// ----------------------------------------------------------------------------

export interface RegistroIntentoParams {
  exito: boolean
  ip: string | null
  referer: string | null
  user_agent: string | null
  motivo_rechazo?: MotivoRechazoLeadsWeb | null
  lead_id?: string | null
  payload_resumen?: Record<string, unknown> | null
}

/**
 * Registra un intento de POST al endpoint público.
 * Fire-and-forget: cualquier error se loguea y se ignora (no debe romper
 * la respuesta principal al cliente).
 */
export async function registrarIntento(params: RegistroIntentoParams): Promise<void> {
  try {
    const supabase = getSupabaseAdmin()
    await supabase.from('leads_web_intentos').insert({
      exito: params.exito,
      ip: params.ip,
      referer: params.referer,
      user_agent: params.user_agent ? params.user_agent.slice(0, 500) : null,
      motivo_rechazo: params.motivo_rechazo ?? null,
      lead_id: params.lead_id ?? null,
      payload_resumen: params.payload_resumen ?? null,
    })

    // Limpieza oportunista: si la tabla tiene > 500 rows, borra los más viejos.
    // No bloquea la respuesta principal.
    await limpiarIntentosAntiguos().catch((e) => {
      logger.warn({ modulo: 'leads-web', mensaje: 'Cleanup de intentos falló', contexto: { error: String(e) } })
    })
  } catch (e) {
    logger.warn({ modulo: 'leads-web', mensaje: 'No se pudo registrar el intento', contexto: { error: String(e) } })
  }
}

async function limpiarIntentosAntiguos(): Promise<void> {
  const supabase = getSupabaseAdmin()
  const { count } = await supabase
    .from('leads_web_intentos')
    .select('*', { count: 'exact', head: true })
  if (!count || count <= 500) return

  // Mantiene los últimos 500 — borra el resto.
  const { data: viejos } = await supabase
    .from('leads_web_intentos')
    .select('id')
    .order('created_at', { ascending: false })
    .range(500, count - 1)
  const ids = (viejos ?? []).map((r) => (r as { id: string }).id)
  if (ids.length === 0) return
  await supabase.from('leads_web_intentos').delete().in('id', ids)
}

/**
 * Incrementa los contadores acumulados de la configuración. Si cambió el mes
 * actual, resetea recibidos_mes_actual a 1 y actualiza reset_contador_mes.
 */
export async function incrementarContadores(): Promise<void> {
  try {
    const supabase = getSupabaseAdmin()
    const cfg = await obtenerConfiguracion()
    if (!cfg) return

    const hoy = new Date()
    const primerDiaMesActual = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
      .toISOString()
      .slice(0, 10)

    const resetEnMesViejo =
      !cfg.reset_contador_mes || cfg.reset_contador_mes < primerDiaMesActual

    const update: Record<string, unknown> = {
      recibidos_historico: cfg.recibidos_historico + 1,
      ultimo_lead_recibido_en: new Date().toISOString(),
    }
    if (resetEnMesViejo) {
      update.recibidos_mes_actual = 1
      update.reset_contador_mes = primerDiaMesActual
    } else {
      update.recibidos_mes_actual = cfg.recibidos_mes_actual + 1
    }

    await supabase
      .from('configuracion_leads_web')
      .update(update)
      .eq('id', cfg.id)
  } catch (e) {
    logger.warn({ modulo: 'leads-web', mensaje: 'No se pudo incrementar contadores', contexto: { error: String(e) } })
  }
}
