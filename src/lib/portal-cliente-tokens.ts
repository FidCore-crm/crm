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
// Seguridad (migraciones 042 + 093):
//  - `token_hash` (sha256 hex) → índice rápido para validar al cliente
//    cuando entra a `/c/<token>`.
//  - `token_encrypted` (AES-256-GCM con ENCRYPTION_KEY del .env.local) →
//    permite que el PAS vea el link en la ficha sin que el token plano
//    quede expuesto en la DB. Como `.env.local` no viaja en el `.crmbak`,
//    un backup filtrado sigue siendo inútil sin la key (mismo modelo que
//    SMTP password y API key de Anthropic).
//
// Si ENCRYPTION_KEY no está configurada (instalación vieja), seguimos
// guardando solo el hash y el PAS ve el cartel "ya fue mostrado". Los
// tokens viejos generados antes de la migración 093 también muestran ese
// cartel hasta que se regeneran.
// ============================================================

import crypto from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { encrypt, decrypt, isEncryptionAvailable } from '@/lib/encryption'
import { logger } from '@/lib/errores/logger'

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

  // 2. Insertar hash + plano encriptado. El plano queda accesible solo
  // para quien tenga ENCRYPTION_KEY (server local). El email/WhatsApp se
  // sigue mandando con el token plano que devolvemos al caller.
  const token = generarTokenSeguro()
  const token_hash = hashToken(token)
  let token_encrypted: string | null = null
  if (isEncryptionAvailable()) {
    try {
      token_encrypted = encrypt(token)
    } catch (err) {
      // Si la encriptación falla, seguimos guardando el hash. El PAS
      // verá el cartel "ya fue mostrado" pero el token funciona.
      logger.warn({
        modulo: 'portal-cliente',
        mensaje: 'No se pudo encriptar token de portal — se guarda solo hash',
        contexto: { error: String(err) },
      })
    }
  }
  const { error } = await supabase.from('portal_cliente_accesos').insert({
    persona_id,
    token_hash,
    token_encrypted,
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

/**
 * Recupera el token plano de una fila de `portal_cliente_accesos`
 * desencriptando `token_encrypted`. Devuelve `null` si:
 *   - el acceso no tiene `token_encrypted` (token viejo pre-093)
 *   - la ENCRYPTION_KEY no está disponible
 *   - la desencriptación falla (key cambió desde que se generó)
 *
 * Es best-effort: nunca tira; el caller decide qué mostrar si vuelve null
 * (típicamente: cartel "ya fue mostrado, regenerá").
 */
export function recuperarTokenPlano(acceso: { token_encrypted?: string | null } | null | undefined): string | null {
  if (!acceso?.token_encrypted) return null
  if (!isEncryptionAvailable()) return null
  try {
    return decrypt(acceso.token_encrypted)
  } catch (err) {
    logger.warn({
      modulo: 'portal-cliente',
      mensaje: 'No se pudo desencriptar token de portal',
      contexto: { error: String(err) },
    })
    return null
  }
}
