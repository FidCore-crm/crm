import { NextResponse } from 'next/server'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { activarRenovadaSiCorresponde } from '@/lib/polizas-transiciones'
import { ERRORES, respuestaError, respuestaExito, manejarErrores } from '@/lib/errores'
import { requireLicenciaActiva } from '@/lib/licencia-guard'

/**
 * Activa una póliza RENOVADA latente: la pasa a VIGENTE, baja la origen a NO_VIGENTE,
 * mueve archivos y registra bitácora. Idempotente.
 *
 * Lo usa el form de renovación cuando la nueva nace VIGENTE (fecha_inicio <= hoy)
 * para no esperar al cron y no duplicar la lógica que ya vive en el helper.
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
    .select('id, asegurado:personas!asegurado_id (usuario_id)')
    .eq('id', id)
    .maybeSingle()

  if (!poliza) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)

  const owns = requireOwnership(usuario, {
    usuario_id: (poliza as any).asegurado?.usuario_id ?? null,
  })
  if (owns) return owns

  const resultado = await activarRenovadaSiCorresponde(supabase, id, usuario.id)
  return respuestaExito({
    cambios: resultado.cambios,
    advertencias: resultado.errores,
  })
}, { modulo: 'polizas' })
