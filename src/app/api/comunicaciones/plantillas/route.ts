import { NextRequest, NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }

  const supabase = getSupabaseAdmin()
  const contexto = request.nextUrl.searchParams.get('contexto')

  let query = supabase
    .from('plantillas_email')
    .select('codigo, nombre, descripcion, asunto_default, contexto, variables_disponibles')
    .eq('activa', true)
    .order('created_at', { ascending: true })

  if (contexto) {
    query = query.or(`contexto.eq.${contexto},contexto.eq.GENERAL`)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ ok: false, error: 'Error al obtener los datos' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, plantillas: data })
}
