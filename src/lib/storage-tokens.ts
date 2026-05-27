// ============================================================
// Tokens firmados para acceso a archivos en /api/storage/[...path]
// ============================================================
//
// Formato del token: <random_hex>.<hmac_hex>
//   - random_hex: 32 bytes aleatorios (64 chars hex) — entropía
//   - hmac_hex:   HMAC-SHA256(STORAGE_SIGNING_KEY, ruta_archivo + '|' + random_hex)
//
// La firma depende de la ruta solicitada, así que un token emitido para
// `polizas/ABC/inspeccion/foto.jpg` no puede usarse para pedir otro archivo.
//
// Además de la firma, existe un registro en `storage_tokens` que permite
// revocar, rastrear usos y expirar. La validación exige AMBAS cosas.
// ============================================================

import { logger } from '@/lib/errores'

import crypto from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase/server'

const ALGO = 'sha256'

function getKey(): string {
  const key = process.env.STORAGE_SIGNING_KEY
  if (!key) {
    throw new Error('STORAGE_SIGNING_KEY no está configurada en el entorno')
  }
  return key
}

function firmar(rutaArchivo: string, randomHex: string): string {
  const hmac = crypto.createHmac(ALGO, getKey())
  hmac.update(`${rutaArchivo}|${randomHex}`)
  return hmac.digest('hex')
}

function parsearToken(token: string): { randomHex: string; firma: string } | null {
  if (!token || typeof token !== 'string') return null
  const partes = token.split('.')
  if (partes.length !== 2) return null
  const [randomHex, firma] = partes
  if (!randomHex || !firma) return null
  return { randomHex, firma }
}

/**
 * Valida un token contra una ruta de archivo específica.
 * Hace verificación de firma (timing-safe) + lookup en DB.
 */
export async function validarTokenArchivo(
  token: string,
  rutaArchivo: string
): Promise<{ valido: boolean; motivo?: string }> {
  if (!process.env.STORAGE_SIGNING_KEY) {
    return { valido: false, motivo: 'Sistema no configurado' }
  }

  const parsed = parsearToken(token)
  if (!parsed) return { valido: false, motivo: 'Token mal formado' }

  // 1. Verificación HMAC offline (no consulta DB, previene ataques por fuerza bruta)
  let firmaEsperada: string
  try {
    firmaEsperada = firmar(rutaArchivo, parsed.randomHex)
  } catch {
    return { valido: false, motivo: 'Sistema no configurado' }
  }
  const a = Buffer.from(parsed.firma, 'hex')
  const b = Buffer.from(firmaEsperada, 'hex')
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valido: false, motivo: 'Firma inválida' }
  }

  // 2. Lookup en DB
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('storage_tokens')
    .select('id, ruta_archivo, fecha_expiracion, veces_usado, max_usos')
    .eq('token', token)
    .maybeSingle()

  if (error || !data) return { valido: false, motivo: 'Token no registrado' }
  const row = data as any

  if (row.ruta_archivo !== rutaArchivo) {
    return { valido: false, motivo: 'Token no corresponde a esta ruta' }
  }
  if (new Date(row.fecha_expiracion).getTime() < Date.now()) {
    return { valido: false, motivo: 'Token expirado' }
  }
  if (typeof row.max_usos === 'number' && row.veces_usado >= row.max_usos) {
    return { valido: false, motivo: 'Token agotado' }
  }

  // 3. Incrementar uso (best-effort, no bloqueante)
  await supabase
    .from('storage_tokens')
    .update({ veces_usado: (row.veces_usado ?? 0) + 1 })
    .eq('id', row.id)

  return { valido: true }
}

/**
 * Borra todos los tokens expirados. Retorna la cantidad eliminada.
 */
export async function limpiarTokensExpirados(): Promise<number> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('storage_tokens')
    .delete()
    .lt('fecha_expiracion', new Date().toISOString())
    .select('id')
  if (error) {
    logger.error({ modulo: 'storage-tokens', mensaje: 'Error en limpieza', contexto: { error: error.message } })
    return 0
  }
  return data?.length ?? 0
}
