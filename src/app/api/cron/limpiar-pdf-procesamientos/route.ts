import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { validarCronSecret } from '@/lib/cron-auth'
import { logger } from '@/lib/errores'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cron/limpiar-pdf-procesamientos
 *
 * Elimina registros históricos de `pdf_procesamientos` que ya cerraron su
 * ciclo de vida y no aportan valor operativo. Criterio (v1.0.169):
 *
 *   - Estado terminal: APROBADO / CANCELADO / FALLIDO.
 *   - Actualizado hace más de 30 días (basado en `updated_at`, no `created_at`
 *     — así si un registro FALLIDO se retomó y aprobó, la cuenta arranca desde
 *     la última acción).
 *
 * NO se tocan registros en estado activo (PENDIENTE / PROCESANDO / EXTRAIDO):
 * si algo lleva meses en esos estados es porque hay un bug o un flujo abortado
 * mal, y borrarlo silenciosamente ocultaría el problema.
 *
 * Filosofía: la trazabilidad legal del contrato la da el PDF físico que quedó
 * guardado en `storage/polizas/{numero}/documentacion/` cuando se aprobó la
 * póliza. El JSON crudo de `datos_extraidos` solo sirve durante el ciclo del
 * wizard de revisión (subir → extraer → revisar → aprobar) y para debugging
 * inmediato. Después de 30 días no aporta.
 *
 * Protegido con CRON_SECRET. Se llama desde scripts/startup-crons.sh.
 */

const DIAS_RETENCION_TERMINAL = 30
const ESTADOS_TERMINALES = ['APROBADO', 'CANCELADO', 'FALLIDO']

export async function GET(request: Request) {
  const authError = await validarCronSecret(request)
  if (authError) return authError

  const supabase = getSupabaseAdmin()

  const limite = new Date(
    Date.now() - DIAS_RETENCION_TERMINAL * 24 * 60 * 60 * 1000,
  ).toISOString()

  const { data, error } = await supabase
    .from('pdf_procesamientos')
    .delete()
    .in('estado', ESTADOS_TERMINALES)
    .lt('updated_at', limite)
    .select('id')

  const eliminados = data?.length || 0

  if (error) {
    logger.error({
      modulo: 'cron-pdf-procesamientos',
      mensaje: 'Error al limpiar pdf_procesamientos',
      contexto: { error: error.message, limite },
    })
    return NextResponse.json(
      { ok: false, error: error.message, eliminados: 0 },
      { status: 500 },
    )
  }

  logger.info({
    modulo: 'cron-pdf-procesamientos',
    mensaje: 'Limpieza de pdf_procesamientos completada',
    eliminados,
    retener_dias: DIAS_RETENCION_TERMINAL,
    estados_afectados: ESTADOS_TERMINALES,
  })

  return NextResponse.json({
    ok: true,
    eliminados,
    retener_dias: DIAS_RETENCION_TERMINAL,
    estados_afectados: ESTADOS_TERMINALES,
  })
}
