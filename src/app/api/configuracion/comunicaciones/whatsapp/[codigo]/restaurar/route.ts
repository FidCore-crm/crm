import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api-auth'

/** POST — Restaurar la plantilla al texto del seed (mensaje = mensaje_default). */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ codigo: string }> },
) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  const { codigo } = await ctx.params
  const supabase = getSupabaseAdmin()

  const { data: actual, error: errSel } = await supabase
    .from('plantillas_whatsapp')
    .select('mensaje_default')
    .eq('codigo', codigo)
    .maybeSingle()
  if (errSel || !actual) {
    return NextResponse.json({ ok: false, error: 'Plantilla no encontrada' }, { status: 404 })
  }

  const { data, error } = await supabase
    .from('plantillas_whatsapp')
    .update({ mensaje: actual.mensaje_default })
    .eq('codigo', codigo)
    .select('*')
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json({ ok: false, error: 'No se pudo restaurar' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, plantilla: data })
}
