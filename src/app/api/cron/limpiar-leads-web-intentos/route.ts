import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { validarCronSecret } from '@/lib/cron-auth'
import { logger } from '@/lib/errores'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cron/limpiar-leads-web-intentos
 *
 * Retención automática de `leads_web_intentos` (auditoría de POSTs al
 * endpoint público `/api/publico/leads/[token]`). Cada intento — exitoso
 * o rechazado — deja un registro con IP, referer, user_agent y motivo_rechazo
 * para diagnóstico si el sitio del PAS deja de enviar leads.
 *
 * Política de retención (v1.0.170):
 *   1. Elimina intentos con `created_at > 90 días` (por edad).
 *   2. Si aún así hay > 5000 registros, borra los más viejos hasta dejar 5000.
 *
 * La rama por edad cubre uso normal; el techo de 5000 cubre casos de ataque
 * al endpoint público donde en poco tiempo llegan muchos intentos rechazados
 * (rate-limit, honeypot, dominio no autorizado).
 *
 * Reemplaza la "limpieza oportunista" que corría en cada request de
 * `registrarIntento` (`src/lib/leads-web.ts`). Esa cleanup best-effort se
 * mantiene con techo elevado (5000) como defensa en profundidad — si el
 * cron falla o tarda en correr, la oportunista igual acota el crecimiento.
 *
 * Protegido con CRON_SECRET. Se llama desde scripts/startup-crons-lentos.sh.
 */

const DIAS_RETENCION = 90
const MAX_REGISTROS = 5000

export async function GET(request: Request) {
  const authError = await validarCronSecret(request)
  if (authError) return authError

  const supabase = getSupabaseAdmin()

  const limite = new Date(
    Date.now() - DIAS_RETENCION * 24 * 60 * 60 * 1000,
  ).toISOString()

  // Paso 1: eliminación por edad.
  const { data: viejosData, error: errEdad } = await supabase
    .from('leads_web_intentos')
    .delete()
    .lt('created_at', limite)
    .select('id')

  const eliminadosPorEdad = viejosData?.length || 0

  if (errEdad) {
    logger.error({
      modulo: 'cron-leads-web-intentos',
      mensaje: 'Error al eliminar por edad',
      contexto: { error: errEdad.message, limite },
    })
    return NextResponse.json(
      { ok: false, error: errEdad.message, eliminados_por_edad: 0, eliminados_por_techo: 0 },
      { status: 500 },
    )
  }

  // Paso 2: si aún hay > MAX_REGISTROS, borrar los más viejos hasta ese techo.
  const { count } = await supabase
    .from('leads_web_intentos')
    .select('*', { count: 'exact', head: true })

  let eliminadosPorTecho = 0
  if (count && count > MAX_REGISTROS) {
    const { data: excedente } = await supabase
      .from('leads_web_intentos')
      .select('id')
      .order('created_at', { ascending: false })
      .range(MAX_REGISTROS, count - 1)

    const ids = (excedente ?? []).map((r) => (r as { id: string }).id)
    if (ids.length > 0) {
      const { error: errTecho } = await supabase
        .from('leads_web_intentos')
        .delete()
        .in('id', ids)

      if (errTecho) {
        logger.error({
          modulo: 'cron-leads-web-intentos',
          mensaje: 'Error al eliminar por techo',
          contexto: { error: errTecho.message, count, max: MAX_REGISTROS },
        })
      } else {
        eliminadosPorTecho = ids.length
      }
    }
  }

  logger.info({
    modulo: 'cron-leads-web-intentos',
    mensaje: 'Limpieza de leads_web_intentos completada',
    eliminados_por_edad: eliminadosPorEdad,
    eliminados_por_techo: eliminadosPorTecho,
    total_actual: (count ?? 0) - eliminadosPorTecho,
    retener_dias: DIAS_RETENCION,
    max_registros: MAX_REGISTROS,
  })

  return NextResponse.json({
    ok: true,
    eliminados_por_edad: eliminadosPorEdad,
    eliminados_por_techo: eliminadosPorTecho,
    total_actual: (count ?? 0) - eliminadosPorTecho,
    retener_dias: DIAS_RETENCION,
    max_registros: MAX_REGISTROS,
  })
}
