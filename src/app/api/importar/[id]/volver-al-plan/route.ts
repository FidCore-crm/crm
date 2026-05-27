import { NextResponse } from 'next/server'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { logger } from '@/lib/errores/logger'
import { checkLicenciaActiva } from '@/lib/licencia-guard'

export const dynamic = 'force-dynamic'

/**
 * Vuelve la importación al estado ANALIZADO, reseteando los lotes procesados
 * y los dudosos. Permite al PAS ajustar el mapeo del plan y re-procesar.
 * Solo válido cuando el estado es REVISANDO o ANALIZADO (nunca IMPORTANDO/COMPLETADA).
 */
export async function POST(request: Request, context: { params: { id: string } }) {
  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth
  const { id } = context.params

  const supabase = getSupabaseAdmin()
  const { data: imp, error } = await supabase
    .from('importaciones')
    .select('id, usuario_id, estado_proceso')
    .eq('id', id)
    .maybeSingle()

  if (error || !imp) {
    return NextResponse.json({ ok: false, error: 'Importación no encontrada' }, { status: 404 })
  }
  type ImpRow = { usuario_id: string; estado_proceso: string }
  const impRow = imp as ImpRow
  const own = requireOwnership(usuario, { usuario_id: impRow.usuario_id })
  if (own) return own

  const permitidos = ['REVISANDO', 'ANALIZADO']
  if (!permitidos.includes(impRow.estado_proceso)) {
    return NextResponse.json(
      {
        ok: false,
        error: `Solo se puede volver al plan desde los estados ${permitidos.join(', ')}. Estado actual: ${impRow.estado_proceso}`,
      },
      { status: 400 }
    )
  }

  try {
    // 1. Cancelar jobs pendientes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('importacion_jobs') as any)
      .update({ estado: 'CANCELADO' })
      .eq('importacion_id', id)
      .in('estado', ['PENDIENTE', 'REINTENTANDO'])

    // 2. Resetear lotes a PENDIENTE (limpiando datos procesados)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('importacion_lotes') as any)
      .update({
        estado: 'PENDIENTE',
        registros_procesados: 0,
        registros_listos: 0,
        registros_dudosos: 0,
        registros_procesados_data: null,
        fecha_inicio: null,
        fecha_fin: null,
      })
      .eq('importacion_id', id)

    // 3. Borrar dudosos existentes
    await supabase.from('importacion_registros_dudosos').delete().eq('importacion_id', id)

    // 4. Volver la importación a ANALIZADO
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: errUpd } = await (supabase.from('importaciones') as any)
      .update({ estado_proceso: 'ANALIZADO' })
      .eq('id', id)

    if (errUpd) {
      throw new Error(errUpd.message)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = (err as { message?: string })?.message || String(err)
    logger.error({
      modulo: 'importar',
      mensaje: 'Error en volver-al-plan',
      contexto: { importacion_id: id, error: msg },
    })
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
