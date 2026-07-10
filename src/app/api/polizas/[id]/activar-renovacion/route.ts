import { NextResponse } from 'next/server'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { activarRenovadaSiCorresponde } from '@/lib/polizas-transiciones'
import { encolarEmailAutomaticoPoliza } from '@/lib/polizas-emails'
import { encolarBienvenidaCliente } from '@/lib/personas-emails'
import { ERRORES, respuestaError, respuestaExito, manejarErrores } from '@/lib/errores'
import { requireLicenciaActiva } from '@/lib/licencia-guard'

/**
 * Activa una póliza RENOVADA latente: la pasa a VIGENTE, baja la origen a NO_VIGENTE,
 * mueve archivos y registra bitácora. Idempotente.
 *
 * Lo usa el form de renovación cuando la nueva nace VIGENTE (fecha_inicio <= hoy)
 * para no esperar al cron y no duplicar la lógica que ya vive en el helper.
 *
 * Si la activación fue efectiva (cambios > 0) y la póliza no vino de importación,
 * encola el email AUTOMATICO_RENOVACION y bienvenida-cliente. Sin esto la renovación
 * manual quedaría dependiendo del cron cada 2h, que ya no la detectaría porque el
 * estado saltó a VIGENTE dentro de la misma request.
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

  // Verificar ownership a través del asegurado de la póliza
  const { data: poliza } = await supabase
    .from('polizas')
    .select('id, asegurado_id, origen_creacion, asegurado:personas!asegurado_id (usuario_id)')
    .eq('id', id)
    .maybeSingle()

  if (!poliza) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)

  const owns = requireOwnership(usuario, {
    usuario_id: (poliza as any).asegurado?.usuario_id ?? null,
  })
  if (owns) return owns

  const resultado = await activarRenovadaSiCorresponde(supabase, id, usuario.id)

  if (resultado.cambios.length > 0 && (poliza as any).origen_creacion !== 'IMPORTACION') {
    await encolarEmailAutomaticoPoliza(supabase, id, 'AUTOMATICO_RENOVACION')
    await encolarBienvenidaCliente(supabase, (poliza as any).asegurado_id)
  }

  return respuestaExito({
    cambios: resultado.cambios,
    advertencias: resultado.errores,
  })
}, { modulo: 'polizas' })
