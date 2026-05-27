import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api-auth'

/** GET — Detalle de una plantilla por código. */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ codigo: string }> },
) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  const { codigo } = await ctx.params
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('plantillas_whatsapp')
    .select('*')
    .eq('codigo', codigo)
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json({ ok: false, error: 'Plantilla no encontrada' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, plantilla: data })
}

/** PATCH — Actualizar mensaje de una plantilla. */
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ codigo: string }> },
) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  const { codigo } = await ctx.params
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 })
  }

  const mensaje: string | undefined = body.mensaje
  if (typeof mensaje !== 'string' || !mensaje.trim()) {
    return NextResponse.json({ ok: false, error: 'El mensaje no puede estar vacío' }, { status: 400 })
  }
  if (mensaje.length > 3000) {
    return NextResponse.json({ ok: false, error: 'El mensaje no puede superar 3000 caracteres (límite de WhatsApp)' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('plantillas_whatsapp')
    .update({ mensaje: mensaje.trim() })
    .eq('codigo', codigo)
    .select('*')
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json({ ok: false, error: 'No se pudo guardar la plantilla' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, plantilla: data })
}
