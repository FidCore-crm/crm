import { NextResponse } from 'next/server'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: { id: string } }) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth
  const { id } = context.params

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('importaciones')
    .select(
      'id, tipo, estado_proceso, fecha_inicio, fecha_fin, archivos_metadata, estadisticas, plan_importacion, ids_creados, ids_actualizados, clientes_creados, clientes_existentes, polizas_creadas, errores, detalle_errores, total_filas, notas, deshecha, fecha_deshecha, usuario_id, created_at'
    )
    .eq('id', id)
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json(
      { ok: false, error: 'Importación no encontrada' },
      { status: 404 }
    )
  }

  const own = requireOwnership(usuario, { usuario_id: (data as { usuario_id: string }).usuario_id })
  if (own) return own

  return NextResponse.json(
    { ok: true, importacion: data },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
