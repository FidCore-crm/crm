import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('plantillas_email')
      .select('*')
      .order('created_at', { ascending: true })

    if (error) {
      return NextResponse.json({ ok: false, error: 'Error al obtener los datos' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, plantillas: data })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'Error interno del servidor' }, { status: 500 })
  }
}
