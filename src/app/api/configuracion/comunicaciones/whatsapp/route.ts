import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api-auth'

/** GET — Listado de plantillas WhatsApp para admin. */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('plantillas_whatsapp')
    .select('*')
    .order('contexto')
    .order('codigo')

  if (error) {
    return NextResponse.json({ ok: false, error: 'No se pudieron cargar las plantillas' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, plantillas: data ?? [] })
}
