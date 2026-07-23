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
  // El estado IMPORTANDO se usa en DOS etapas distintas del flujo:
  //   1) Procesamiento de lotes (jobs PROCESAMIENTO_LOTE) — analiza con IA y
  //      valida datos, PERO no inserta nada en la DB de negocio. Cancelable
  //      sin dejar datos parciales.
  //   2) Importación final (job IMPORTACION_FINAL) — hace los INSERTs
  //      efectivos en la DB. NO cancelable a mitad, dejaría datos parciales.
  //
  // Distinguimos por el tipo de job activo. Si hay un IMPORTACION_FINAL en
  // ejecución o pendiente, rechazamos. Sino permitimos cancelar los lotes.
  if (estado === 'IMPORTANDO') {
    const { data: jobFinal } = await supabase
      .from('importacion_jobs')
      .select('id')
      .eq('importacion_id', id)
      .eq('tipo', 'IMPORTACION_FINAL')
      .in('estado', ['PENDIENTE', 'EJECUTANDO', 'REINTENTANDO'])
      .limit(1)
      .maybeSingle()

    if (jobFinal) {
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
    // Si no hay IMPORTACION_FINAL activo, es procesamiento de lotes: cancelable.
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
