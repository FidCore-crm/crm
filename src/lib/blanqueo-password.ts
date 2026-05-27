// ============================================================================
// Lib de solicitudes de blanqueo de contraseña
//
// Centraliza la creación, habilitación, consumo y rechazo de solicitudes.
// El flujo y los estados están documentados en
// sql/migrations/045_solicitudes_blanqueo_password.sql.
// ============================================================================

import crypto from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { logger } from '@/lib/errores'

export type EstadoSolicitudBlanqueo =
  | 'PENDIENTE'
  | 'HABILITADA'
  | 'CONSUMIDA'
  | 'RECHAZADA'
  | 'EXPIRADA'

export interface SolicitudBlanqueo {
  id: string
  usuario_id: string
  estado: EstadoSolicitudBlanqueo
  token_hash: string | null
  token_expira_at: string | null
  ip_origen: string | null
  user_agent: string | null
  habilitada_por_admin_id: string | null
  fecha_habilitacion: string | null
  fecha_consumo: string | null
  fecha_rechazo: string | null
  motivo_rechazo: string | null
  created_at: string
  updated_at: string
}

// Ventana en horas durante la cual una solicitud HABILITADA es consumible.
// Después de eso pasa a EXPIRADA via cron.
export const VENTANA_CONSUMO_HORAS = 24

// Ventana de validez del token de auto-confirmación de admin.
export const VENTANA_TOKEN_ADMIN_HORAS = 24

// Genera un token plano (URL-safe) para auto-confirmación de admin.
// Devuelve { plano, hash } — el plano va al email, el hash a la DB.
export function generarTokenAdmin(): { plano: string; hash: string } {
  const plano = crypto.randomBytes(32).toString('base64url')
  const hash = crypto.createHash('sha256').update(plano).digest('hex')
  return { plano, hash }
}

export function hashearToken(plano: string): string {
  return crypto.createHash('sha256').update(plano).digest('hex')
}

/**
 * Devuelve la solicitud activa (PENDIENTE o HABILITADA) de un usuario, si existe.
 * Hay como mucho una por usuario por el unique index parcial.
 */
export async function obtenerSolicitudActiva(
  usuarioId: string,
): Promise<SolicitudBlanqueo | null> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('solicitudes_blanqueo_password')
    .select('*')
    .eq('usuario_id', usuarioId)
    .in('estado', ['PENDIENTE', 'HABILITADA'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    logger.error({
      modulo: 'blanqueo-password',
      mensaje: 'Error consultando solicitud activa',
      contexto: { usuario_id: usuarioId, error: error.message },
    })
    return null
  }
  return (data as SolicitudBlanqueo | null) ?? null
}

/**
 * Crea una solicitud nueva. Devuelve null si ya hay una activa (el caller
 * debería detectarlo antes y no llamar a esta función — pero por las dudas).
 */
export async function crearSolicitud(params: {
  usuario_id: string
  ip_origen?: string | null
  user_agent?: string | null
  // Si se pasa, la solicitud se crea ya HABILITADA con token (caso admin).
  con_token_admin?: boolean
}): Promise<{ ok: true; solicitud: SolicitudBlanqueo; token_plano?: string } | { ok: false; error: string }> {
  const supabase = getSupabaseAdmin()

  const insert: Record<string, any> = {
    usuario_id: params.usuario_id,
    estado: 'PENDIENTE',
    ip_origen: params.ip_origen ?? null,
    user_agent: params.user_agent ?? null,
  }

  let tokenPlano: string | undefined
  if (params.con_token_admin) {
    const { plano, hash } = generarTokenAdmin()
    tokenPlano = plano
    insert.token_hash = hash
    insert.token_expira_at = new Date(
      Date.now() + VENTANA_TOKEN_ADMIN_HORAS * 60 * 60 * 1000,
    ).toISOString()
  }

  const { data, error } = await supabase
    .from('solicitudes_blanqueo_password')
    .insert(insert)
    .select('*')
    .single()

  if (error) {
    // El unique index parcial puede tirar 23505 si ya hay una activa.
    return { ok: false, error: error.message }
  }
  return { ok: true, solicitud: data as SolicitudBlanqueo, token_plano: tokenPlano }
}

/**
 * Habilita una solicitud PENDIENTE. La marca como HABILITADA y registra al admin.
 * Si la solicitud no está en PENDIENTE devuelve error (estado inválido).
 */
export async function habilitarSolicitud(params: {
  solicitud_id: string
  admin_id: string
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabaseAdmin()
  const { error, count } = await supabase
    .from('solicitudes_blanqueo_password')
    .update(
      {
        estado: 'HABILITADA',
        habilitada_por_admin_id: params.admin_id,
        fecha_habilitacion: new Date().toISOString(),
      },
      { count: 'exact' },
    )
    .eq('id', params.solicitud_id)
    .eq('estado', 'PENDIENTE')

  if (error) return { ok: false, error: error.message }
  if (count === 0) return { ok: false, error: 'La solicitud no está pendiente' }
  return { ok: true }
}

/**
 * Habilita por token (caso auto-confirmación admin). Compara el hash y valida
 * que no esté expirado. Devuelve la solicitud si todo OK.
 */
export async function habilitarPorTokenAdmin(
  tokenPlano: string,
): Promise<{ ok: true; solicitud: SolicitudBlanqueo } | { ok: false; error: string }> {
  const supabase = getSupabaseAdmin()
  const tokenHash = hashearToken(tokenPlano)

  const { data: solicitud } = await supabase
    .from('solicitudes_blanqueo_password')
    .select('*')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (!solicitud) return { ok: false, error: 'Token inválido' }
  const sol = solicitud as SolicitudBlanqueo
  if (sol.estado !== 'PENDIENTE') {
    return { ok: false, error: 'La solicitud ya fue procesada' }
  }
  if (sol.token_expira_at && new Date(sol.token_expira_at) < new Date()) {
    return { ok: false, error: 'El link expiró' }
  }

  const { error } = await supabase
    .from('solicitudes_blanqueo_password')
    .update({
      estado: 'HABILITADA',
      fecha_habilitacion: new Date().toISOString(),
      // El token ya no se necesita después de la confirmación.
      token_hash: null,
      token_expira_at: null,
    })
    .eq('id', sol.id)
    .eq('estado', 'PENDIENTE')

  if (error) return { ok: false, error: error.message }
  // Re-consultar para devolver el estado fresco.
  const { data: actualizada } = await supabase
    .from('solicitudes_blanqueo_password')
    .select('*')
    .eq('id', sol.id)
    .single()
  return { ok: true, solicitud: actualizada as SolicitudBlanqueo }
}

/**
 * Marca una solicitud como CONSUMIDA. La invocamos cuando el user define la
 * nueva contraseña con éxito.
 */
export async function consumirSolicitud(
  solicitudId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabaseAdmin()
  const { error, count } = await supabase
    .from('solicitudes_blanqueo_password')
    .update(
      {
        estado: 'CONSUMIDA',
        fecha_consumo: new Date().toISOString(),
      },
      { count: 'exact' },
    )
    .eq('id', solicitudId)
    .eq('estado', 'HABILITADA')

  if (error) return { ok: false, error: error.message }
  if (count === 0) return { ok: false, error: 'La solicitud no está habilitada' }
  return { ok: true }
}

/**
 * Rechaza una solicitud PENDIENTE. Libera el login (el user puede volver a
 * usar su pass vieja).
 */
export async function rechazarSolicitud(params: {
  solicitud_id: string
  admin_id: string
  motivo?: string
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabaseAdmin()
  const { error, count } = await supabase
    .from('solicitudes_blanqueo_password')
    .update(
      {
        estado: 'RECHAZADA',
        fecha_rechazo: new Date().toISOString(),
        habilitada_por_admin_id: params.admin_id,
        motivo_rechazo: params.motivo ?? null,
      },
      { count: 'exact' },
    )
    .eq('id', params.solicitud_id)
    .eq('estado', 'PENDIENTE')

  if (error) return { ok: false, error: error.message }
  if (count === 0) return { ok: false, error: 'La solicitud no está pendiente' }
  return { ok: true }
}

/**
 * Expira solicitudes PENDIENTES viejas (más de VENTANA_TOKEN_ADMIN_HORAS de
 * antigüedad sin habilitarse) y solicitudes HABILITADAS sin consumir
 * (ventana de 24h desde habilitación).
 *
 * Pensado para llamarse desde el cron diario.
 */
export async function expirarSolicitudesViejas(): Promise<{
  pendientes_expiradas: number
  habilitadas_expiradas: number
}> {
  const supabase = getSupabaseAdmin()
  const ahora = new Date()
  const limitePendientes = new Date(
    ahora.getTime() - VENTANA_TOKEN_ADMIN_HORAS * 60 * 60 * 1000,
  ).toISOString()
  const limiteHabilitadas = new Date(
    ahora.getTime() - VENTANA_CONSUMO_HORAS * 60 * 60 * 1000,
  ).toISOString()

  const { count: c1 } = await supabase
    .from('solicitudes_blanqueo_password')
    .update(
      { estado: 'EXPIRADA' },
      { count: 'exact' },
    )
    .eq('estado', 'PENDIENTE')
    .lt('created_at', limitePendientes)

  const { count: c2 } = await supabase
    .from('solicitudes_blanqueo_password')
    .update(
      { estado: 'EXPIRADA' },
      { count: 'exact' },
    )
    .eq('estado', 'HABILITADA')
    .lt('fecha_habilitacion', limiteHabilitadas)

  return {
    pendientes_expiradas: c1 ?? 0,
    habilitadas_expiradas: c2 ?? 0,
  }
}
