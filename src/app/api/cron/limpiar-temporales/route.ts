import { NextResponse } from 'next/server'
import { validarCronSecret } from '@/lib/cron-auth'
import { limpiarTemporales } from '@/lib/limpieza-temporales'
import { logger } from '@/lib/errores'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cron/limpiar-temporales
 *
 * Cron unificado de limpieza de temporales del sistema. Hoy cubre:
 *  - PDFs del agente IA en <project>/tmp/pdf-procesamientos/
 *  - Workdirs de restauraciones en /tmp/crm-restauraciones/
 *
 * Todo lo mayor a 24h se borra. Correr diariamente desde startup-crons.sh.
 */
export async function GET(request: Request) {
  const authError = await validarCronSecret(request)
  if (authError) return authError

  try {
    const resultado = await limpiarTemporales()
    return NextResponse.json({ ok: true, ...resultado })
  } catch (err: any) {
    logger.error({ modulo: 'cron', mensaje: 'Error en cron limpiar-temporales', contexto: { error: String(err) } })
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error desconocido' },
      { status: 500 },
    )
  }
}
