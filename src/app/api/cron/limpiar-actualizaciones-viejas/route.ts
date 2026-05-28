/**
 * GET /api/cron/limpiar-actualizaciones-viejas
 *
 * Limpia actualizaciones que quedaron PROGRAMADA sin ejecutarse por más de
 * 7 días (típicamente porque el cron del host no está corriendo o el trigger
 * file se borró). Las marca como FALLIDA con un mensaje explicativo para que
 * el admin las vea en el historial.
 *
 * Corre desde scripts/startup-crons.sh (cada 4h) — la limpieza es idempotente,
 * solo afecta filas viejas que cumplan la condición.
 *
 * Protegido por CRON_SECRET.
 */

import { NextResponse } from 'next/server'
import { limpiarProgramadasViejas } from '@/lib/updater'
import { logger } from '@/lib/errores'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function validarCronSecret(request: Request): boolean {
  const auth = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (!process.env.CRON_SECRET) return false
  return auth === expected
}

export async function GET(request: Request) {
  if (!validarCronSecret(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  try {
    const limpiadas = await limpiarProgramadasViejas(7)
    if (limpiadas > 0) {
      logger.info({
        modulo: 'cron-actualizaciones',
        mensaje: `Limpiadas ${limpiadas} actualizaciones PROGRAMADA viejas`,
      })
    }
    return NextResponse.json({ ok: true, limpiadas })
  } catch (err: any) {
    logger.error({
      modulo: 'cron-actualizaciones',
      mensaje: 'Error en limpiar-actualizaciones-viejas',
      contexto: { error: String(err) },
    })
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
