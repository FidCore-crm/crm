import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  const url = new URL(request.url)
  const pagina = Math.max(1, parseInt(url.searchParams.get('pagina') || '1', 10))
  const porPagina = Math.min(50, Math.max(1, parseInt(url.searchParams.get('por_pagina') || '25', 10)))
  const estado = url.searchParams.get('estado')
  const tipo = url.searchParams.get('tipo')

  const supabase = getSupabaseAdmin()
  let query = supabase
    .from('pdf_procesamientos')
    .select(
      'id, tipo_operacion, estado, nombre_archivo, tamano_archivo, tokens_usados, costo_estimado, error_mensaje, poliza_origen_id, poliza_creada_id, endoso_creado_id, usuario_id, created_at',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })

  if (estado) query = query.eq('estado', estado)
  if (tipo) query = query.eq('tipo_operacion', tipo)

  // Filtro de cartera: usuarios PROPIA solo ven los suyos
  if (usuario.rol !== 'ADMIN' && usuario.acceso_cartera !== 'TOTAL') {
    query = query.eq('usuario_id', usuario.id)
  }

  const desde = (pagina - 1) * porPagina
  const hasta = desde + porPagina - 1
  const { data, error, count } = await query.range(desde, hasta)

  if (error) {
    return NextResponse.json({ ok: false, error: 'Error al obtener los datos' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    data: data || [],
    total: count || 0,
    pagina,
    por_pagina: porPagina,
  })
}
