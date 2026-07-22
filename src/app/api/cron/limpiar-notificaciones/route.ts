import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { validarCronSecret } from '@/lib/cron-auth'
import { limpiarTokensExpirados } from '@/lib/storage-tokens'
import { logger } from '@/lib/errores'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cron/limpiar-notificaciones
 *
 * Endpoint dedicado a la limpieza de 3 tablas de mantenimiento (v1.0.170):
 *   - `notificaciones` — elimina leídas > 30 días.
 *   - `storage_tokens` — elimina tokens expirados.
 *   - `rate_limit_buckets` — elimina buckets con reset_at > 1h vencidos.
 *
 * Contexto: estas 3 limpiezas históricamente vivían al final del cron
 * `/api/cron/notificaciones` (que primero genera 9 tipos de alertas y
 * después limpia). Cada bloque de limpieza tenía su propio try/catch, por
 * lo que la ejecución NO se cortaba si fallaba una alerta previa — pero
 * si el handler tiraba antes del bloque 1 (raro pero posible: fallo de
 * conexión al inicio, error en helper importado, etc.) las limpiezas NO
 * corrían nunca.
 *
 * Ahora hay DOS crons corriendo las mismas limpiezas:
 *   1. Este endpoint dedicado (garantía de ejecución aunque el generador
 *      de alertas explote).
 *   2. El bloque final de `/api/cron/notificaciones` (defensa en profundidad).
 *
 * Ambos son idempotentes — los registros ya eliminados no vuelven a matchear,
 * así que correr ambos es seguro. La corrida doble se aprovecha para tener
 * cobertura garantizada sin diseño frágil.
 *
 * Protegido con CRON_SECRET.
 */

function restarDiasISO(dias: number): string {
  const ahora = new Date()
  ahora.setDate(ahora.getDate() - dias)
  return ahora.toISOString()
}

export async function GET(request: Request) {
  const authError = await validarCronSecret(request)
  if (authError) return authError

  const supabase = getSupabaseAdmin()

  let notificaciones_eliminadas = 0
  let tokens_expirados = 0
  let rate_limit_buckets_eliminados = 0
  const errores: string[] = []

  // 1. Notificaciones leídas > 30 días
  try {
    const hace30 = restarDiasISO(30)
    const { data, error } = await supabase
      .from('notificaciones')
      .delete()
      .eq('leida', true)
      .lt('created_at', hace30)
      .select('id')
    if (error) throw error
    notificaciones_eliminadas = data?.length ?? 0
  } catch (e: any) {
    errores.push(`notificaciones: ${e?.message ?? String(e)}`)
    logger.warn({
      modulo: 'cron-limpiar-notificaciones',
      mensaje: 'Error limpiando notificaciones leídas',
      contexto: { error: String(e?.message ?? e) },
    })
  }

  // 2. Storage tokens expirados
  try {
    tokens_expirados = await limpiarTokensExpirados()
  } catch (e: any) {
    errores.push(`storage_tokens: ${e?.message ?? String(e)}`)
    logger.warn({
      modulo: 'cron-limpiar-notificaciones',
      mensaje: 'Error limpiando storage_tokens',
      contexto: { error: String(e?.message ?? e) },
    })
  }

  // 3. Rate limit buckets con reset_at > 1h vencidos
  try {
    const corte = new Date(Date.now() - 3600_000).toISOString()
    const { data, error } = await supabase
      .from('rate_limit_buckets')
      .delete()
      .lt('reset_at', corte)
      .select('id')
    if (error) throw error
    rate_limit_buckets_eliminados = data?.length ?? 0
  } catch (e: any) {
    errores.push(`rate_limit_buckets: ${e?.message ?? String(e)}`)
    logger.warn({
      modulo: 'cron-limpiar-notificaciones',
      mensaje: 'Error limpiando rate_limit_buckets',
      contexto: { error: String(e?.message ?? e) },
    })
  }

  logger.info({
    modulo: 'cron-limpiar-notificaciones',
    mensaje: 'Limpieza completada',
    notificaciones_eliminadas,
    tokens_expirados,
    rate_limit_buckets_eliminados,
    errores: errores.length,
  })

  return NextResponse.json({
    ok: errores.length === 0,
    notificaciones_eliminadas,
    tokens_expirados,
    rate_limit_buckets_eliminados,
    errores,
  })
}
