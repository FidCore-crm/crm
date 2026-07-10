import { NextResponse } from 'next/server'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { encolarEmailAutomaticoPoliza } from '@/lib/polizas-emails'
import { encolarBienvenidaCliente } from '@/lib/personas-emails'
import { ERRORES, respuestaError, respuestaExito, manejarErrores } from '@/lib/errores'
import { requireLicenciaActiva } from '@/lib/licencia-guard'

/**
 * Encola `AUTOMATICO_BIENVENIDA` + `AUTOMATICO_BIENVENIDA_CLIENTE` para una póliza
 * que se acaba de crear desde el form manual (`/crm/polizas/nueva`).
 *
 * El form hace INSERT directo desde el browser (Supabase RLS). Sin este endpoint,
 * la única forma que la bienvenida se disparara era esperar al cron cada 2h, que
 * detecta pólizas VIGENTES nacidas hace <7 días. Con este endpoint el email queda
 * encolado en el acto — mismo patrón que agente PDF o edición con cambio de fechas.
 *
 * Reglas:
 *  - Solo dispara si la póliza es VIGENTE (PROGRAMADA esperará al cron cuando
 *    llegue su fecha de inicio, no queremos encolar antes de tiempo).
 *  - No dispara si la póliza es RENOVADA (esa vía va por `/activar-renovacion`).
 *  - No dispara si `origen_creacion === 'IMPORTACION'` (regla general del sistema).
 *  - Los helpers `encolarEmailAutomaticoPoliza` y `encolarBienvenidaCliente`
 *    tienen anti-spam propio, así que llamar dos veces es no-op idempotente.
 */
export const POST = manejarErrores(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth
  await requireLicenciaActiva()

  const { id } = await params
  const supabase = getSupabaseAdmin()

  const { data: poliza } = await supabase
    .from('polizas')
    .select('id, estado, asegurado_id, origen_creacion, asegurado:personas!asegurado_id (usuario_id)')
    .eq('id', id)
    .maybeSingle()

  if (!poliza) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)

  const owns = requireOwnership(usuario, {
    usuario_id: (poliza as any).asegurado?.usuario_id ?? null,
  })
  if (owns) return owns

  const p = poliza as any

  if (p.estado !== 'VIGENTE') {
    return respuestaExito({ encolado: false, motivo: `estado ${p.estado} no dispara bienvenida` })
  }

  if (p.origen_creacion === 'IMPORTACION') {
    return respuestaExito({ encolado: false, motivo: 'origen IMPORTACION' })
  }

  await encolarEmailAutomaticoPoliza(supabase, id, 'AUTOMATICO_BIENVENIDA')
  await encolarBienvenidaCliente(supabase, p.asegurado_id)

  return respuestaExito({ encolado: true })
}, { modulo: 'polizas' })
