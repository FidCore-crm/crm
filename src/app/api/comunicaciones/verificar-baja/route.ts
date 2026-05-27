import { NextRequest, NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }

  const email = request.nextUrl.searchParams.get('email')
  if (!email) {
    return NextResponse.json({ ok: true, en_baja: false })
  }

  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('email_bajas')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle()

  return NextResponse.json({ ok: true, en_baja: !!data })
}
