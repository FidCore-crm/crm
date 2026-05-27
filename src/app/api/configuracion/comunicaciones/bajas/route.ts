import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth
  try {
    const supabase = getSupabaseAdmin()
    const pagina = parseInt(request.nextUrl.searchParams.get('pagina') || '1')
    const porPagina = 25
    const desde = (pagina - 1) * porPagina

    const { count } = await supabase
      .from('email_bajas')
      .select('*', { count: 'exact', head: true })

    const { data, error } = await supabase
      .from('email_bajas')
      .select('*')
      .order('fecha_baja', { ascending: false })
      .range(desde, desde + porPagina - 1)

    if (error) {
      return NextResponse.json({ ok: false, error: 'Error al obtener los datos' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, bajas: data, total: count || 0 })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'Error interno del servidor' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth
  try {
    const supabase = getSupabaseAdmin()
    const body = await request.json()

    if (!body.id) {
      return NextResponse.json({ ok: false, error: 'ID requerido' }, { status: 400 })
    }

    const { error } = await supabase
      .from('email_bajas')
      .delete()
      .eq('id', body.id)

    if (error) {
      return NextResponse.json({ ok: false, error: 'Error al eliminar los datos' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'Error interno del servidor' }, { status: 500 })
  }
}
