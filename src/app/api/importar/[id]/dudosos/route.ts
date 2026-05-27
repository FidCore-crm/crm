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
  const { data: imp, error } = await supabase
    .from('importaciones')
    .select('id, usuario_id')
    .eq('id', id)
    .maybeSingle()

  if (error || !imp) {
    return NextResponse.json({ ok: false, error: 'Importación no encontrada' }, { status: 404 })
  }
  const own = requireOwnership(usuario, { usuario_id: (imp as { usuario_id: string }).usuario_id })
  if (own) return own

  const url = new URL(request.url)
  const tipo_problema = url.searchParams.get('tipo_problema')
  const tipo_entidad = url.searchParams.get('tipo_entidad')
  const estado_resolucion = url.searchParams.get('estado_resolucion') || 'PENDIENTE'
  const pagina = Math.max(1, parseInt(url.searchParams.get('pagina') || '1', 10))
  const por_pagina = Math.min(200, Math.max(1, parseInt(url.searchParams.get('por_pagina') || '50', 10)))
  const desde = (pagina - 1) * por_pagina
  const hasta = desde + por_pagina - 1

  let q = supabase
    .from('importacion_registros_dudosos')
    .select('*', { count: 'exact' })
    .eq('importacion_id', id)

  if (tipo_problema) q = q.eq('tipo_problema', tipo_problema)
  if (tipo_entidad) q = q.eq('tipo_entidad', tipo_entidad)
  if (estado_resolucion) q = q.eq('estado_resolucion', estado_resolucion)

  q = q.order('numero_fila_archivo', { ascending: true }).range(desde, hasta)

  const { data: dudosos, count, error: errQ } = await q

  if (errQ) {
    return NextResponse.json({ ok: false, error: errQ.message }, { status: 500 })
  }

  // Totales por tipo_problema
  const { data: totRows } = await supabase
    .from('importacion_registros_dudosos')
    .select('tipo_problema, estado_resolucion')
    .eq('importacion_id', id)

  type TotRow = { tipo_problema: string; estado_resolucion: string }
  const totales_por_tipo: Record<string, number> = {}
  for (const r of ((totRows ?? []) as TotRow[])) {
    if (r.estado_resolucion !== 'PENDIENTE') continue
    totales_por_tipo[r.tipo_problema] = (totales_por_tipo[r.tipo_problema] ?? 0) + 1
  }

  return NextResponse.json({
    ok: true,
    dudosos: dudosos ?? [],
    total: count ?? 0,
    pagina,
    por_pagina,
    totales_por_tipo,
  })
}
