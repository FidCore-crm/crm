// ============================================================
// Tokens de acceso al Portal del Cliente
// ============================================================
//
// Cada persona puede tener UN solo token activo (no revocado).
// Los tokens NO expiran por tiempo: viven hasta que se los revoca
// explícitamente. Al regenerar, el anterior queda revocado y se
// crea uno nuevo.
//
// Se valida también el estado de la persona: si está BLOQUEADO /
// INACTIVO, el token no funciona aunque no esté revocado.
//
// Seguridad (migración 042): el token plano NO se guarda en DB. Solo
// se persiste sha256(token) en hex en `token_hash`. Si se filtra un
// backup `.crmbak`, los tokens activos no quedan expuestos. El token
// plano existe únicamente en el email/WhatsApp que se le mandó al
// cliente cuando se generó. Si el cliente lo pierde, hay que regenerar.
// ============================================================

import crypto from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase/server'

function generarTokenSeguro(): string {
  // UUID (36 chars) + 32 hex extra => >60 chars impredecibles
  return (
    crypto.randomUUID().replace(/-/g, '') +
    crypto.randomBytes(16).toString('hex')
  )
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export async function generarTokenAcceso(
  persona_id: string,
  usuario_id: string
): Promise<{ ok: boolean; token?: string; error?: string }> {
  const supabase = getSupabaseAdmin()

  // 1. Revocar token activo previo si existe
  await supabase
    .from('portal_cliente_accesos')
    .update({
      revocado: true,
      fecha_revocacion: new Date().toISOString(),
      motivo_revocacion: 'Reemplazado por nuevo token',
    } as any)
    .eq('persona_id', persona_id)
    .eq('revocado', false)

  // 2. Insertar el hash del token nuevo. El token plano se devuelve solo
  // al caller (para el email/WhatsApp); nunca se persiste.
  const token = generarTokenSeguro()
  const token_hash = hashToken(token)
  const { error } = await supabase.from('portal_cliente_accesos').insert({
    persona_id,
    token_hash,
    creado_por_usuario_id: usuario_id,
  } as any)

  if (error) {
    return { ok: false, error: error.message }
  }

  return { ok: true, token }
}

export async function validarTokenAcceso(
  token: string,
  ip?: string
): Promise<{ valido: boolean; persona_id?: string; motivo?: string }> {
  if (!token || typeof token !== 'string' || token.length < 20) {
    return { valido: false, motivo: 'Token mal formado' }
  }

  const supabase = getSupabaseAdmin()
  const token_hash = hashToken(token)

  const { data: acceso } = await supabase
    .from('portal_cliente_accesos')
    .select('id, persona_id, revocado, veces_accedido')
    .eq('token_hash', token_hash)
    .maybeSingle()

  if (!acceso) return { valido: false, motivo: 'Token inexistente' }
  const a = acceso as any
  if (a.revocado) return { valido: false, motivo: 'Token revocado' }

  // Validar que la persona siga existiendo, activa Y no en papelera.
  // Si está en papelera (deleted_at != null) el token seguía vigente hasta 30
  // días después del soft-delete — vulnerabilidad de portal abierto a un
  // cliente que el PAS ya borró.
  const { data: persona } = await supabase
    .from('personas')
    .select('id, estado, deleted_at')
    .eq('id', a.persona_id)
    .maybeSingle()

  if (!persona) return { valido: false, motivo: 'Cliente no encontrado' }
  if ((persona as any).deleted_at) return { valido: false, motivo: 'Cliente eliminado' }
  const estado = (persona as any).estado
  if (estado === 'BLOQUEADO' || estado === 'INACTIVO') {
    return { valido: false, motivo: 'Cliente inactivo' }
  }

  // Registrar uso (best-effort, no bloqueante)
  supabase
    .from('portal_cliente_accesos')
    .update({
      veces_accedido: (a.veces_accedido ?? 0) + 1,
      ultimo_acceso: new Date().toISOString(),
      ultimo_ip: ip ?? null,
    } as any)
    .eq('id', a.id)
    .then(() => {})

  return { valido: true, persona_id: a.persona_id }
}

export async function revocarTokenAcceso(
  token_id: string,
  usuario_id: string,
  motivo?: string
): Promise<boolean> {
  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('portal_cliente_accesos')
    .update({
      revocado: true,
      fecha_revocacion: new Date().toISOString(),
      motivo_revocacion: motivo ?? null,
    } as any)
    .eq('id', token_id)
  void usuario_id
  return !error
}

export async function regenerarTokenAcceso(
  persona_id: string,
  usuario_id: string
): Promise<{ ok: boolean; token?: string; error?: string }> {
  // generarTokenAcceso ya revoca el anterior
  return generarTokenAcceso(persona_id, usuario_id)
}

/**
 * Construye la URL pública completa del portal para un token.
 *
 * Acepta un `baseOverride` opcional para que el caller, que ya consultó
 * la URL desde DB con `obtenerUrlPortalCliente()`, evite repetir la query
 * cuando itera sobre N tokens. Si no se pasa, cae al env legacy y la
 * función queda compatible con los callers viejos.
 */
export function construirUrlPortal(token: string, baseOverride?: string | null): string {
  const base = (baseOverride ?? process.env.URL_PORTAL_CLIENTE ?? '').replace(/\/+$/, '')
  if (!base) return ''
  return `${base}/c/${token}`
}
