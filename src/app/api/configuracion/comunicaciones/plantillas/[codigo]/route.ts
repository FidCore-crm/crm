import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api-auth'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ codigo: string }> },
) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  const { codigo } = await params
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('plantillas_email')
    .select('*')
    .eq('codigo', codigo)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ ok: false, error: 'Error al obtener los datos' }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: 'Plantilla no encontrada' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, plantilla: data })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ codigo: string }> },
) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  const { codigo } = await params
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const { data: existente } = await supabase
    .from('plantillas_email')
    .select('editable')
    .eq('codigo', codigo)
    .maybeSingle()
  if (!existente) {
    return NextResponse.json({ ok: false, error: 'Plantilla no encontrada' }, { status: 404 })
  }
  if ((existente as any).editable === false) {
    return NextResponse.json({ ok: false, error: 'Esta plantilla no es editable' }, { status: 403 })
  }

  // Solo se permiten estos campos
  const update: Record<string, any> = {}
  const camposPermitidos = ['asunto', 'saludo', 'cuerpo', 'cierre', 'activa']
  for (const c of camposPermitidos) {
    if (body[c] !== undefined) update[c] = body[c]
  }

  // Validación básica
  for (const c of ['asunto', 'saludo', 'cuerpo', 'cierre']) {
    if (update[c] !== undefined && typeof update[c] !== 'string') {
      return NextResponse.json({ ok: false, error: `${c} debe ser string` }, { status: 400 })
    }
    if (update[c] !== undefined && update[c].length > 20000) {
      return NextResponse.json({ ok: false, error: `${c} excede 20000 caracteres` }, { status: 400 })
    }
  }

  const { data, error } = await supabase
    .from('plantillas_email')
    .update(update)
    .eq('codigo', codigo)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ ok: false, error: 'Error al actualizar los datos' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, plantilla: data })
}
