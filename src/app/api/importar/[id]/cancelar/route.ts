import { NextResponse } from 'next/server'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: { id: string } }) {
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

  const estado = impRow.estado_proceso
  if (estado === 'COMPLETADA' || estado === 'CANCELADA') {
    return NextResponse.json(
      { ok: false, error: `No se puede cancelar una importación en estado ${estado}` },
      { status: 400 }
    )
  }
  // Durante IMPORTACION_FINAL (estado IMPORTANDO) el handler async corre en
  // background y no se puede interrumpir limpiamente. Si marcáramos el job
  // CANCELADO, el handler seguiría haciendo INSERTs y dejaría datos parciales
  // con la importación marcada como cancelada — peor que no permitir cancelar.
  // El PAS tiene "Deshacer" en el historial (24h) para revertir.
  if (estado === 'IMPORTANDO') {
    return NextResponse.json(
      {
        ok: false,
        error:
          'La importación ya está creando registros y no se puede cancelar a mitad. ' +
          'Esperá a que termine y usá "Deshacer" en el historial (disponible 24h).',
      },
      { status: 400 }
    )
  }

  // Cancelar jobs pendientes/ejecutando
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('importacion_jobs') as any)
    .update({ estado: 'CANCELADO' })
    .eq('importacion_id', id)
    .in('estado', ['PENDIENTE', 'EJECUTANDO'])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('importaciones') as any)
    .update({ estado_proceso: 'CANCELADA', fecha_fin: new Date().toISOString() })
    .eq('id', id)

  return NextResponse.json({ ok: true })
}
