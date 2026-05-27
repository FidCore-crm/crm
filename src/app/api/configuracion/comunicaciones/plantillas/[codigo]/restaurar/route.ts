import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api-auth'

/**
 * POST — Restaura una plantilla a sus valores default (seed del sistema).
 * Usa los campos `*_default` que guardó la migración 013.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ codigo: string }> },
) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  const { codigo } = await params
  const supabase = getSupabaseAdmin()

  const { data: plantilla } = await supabase
    .from('plantillas_email')
    .select('asunto_default, saludo_default, cuerpo_default, cierre_default')
    .eq('codigo', codigo)
    .maybeSingle()

  if (!plantilla) {
    return NextResponse.json({ ok: false, error: 'Plantilla no encontrada' }, { status: 404 })
  }

  const p = plantilla as any
  if (!p.asunto_default && !p.saludo_default && !p.cuerpo_default && !p.cierre_default) {
    return NextResponse.json({ ok: false, error: 'Esta plantilla no tiene valores por defecto' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('plantillas_email')
    .update({
      asunto: p.asunto_default,
      saludo: p.saludo_default,
      cuerpo: p.cuerpo_default,
      cierre: p.cierre_default,
    })
    .eq('codigo', codigo)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ ok: false, error: 'Error al actualizar los datos' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, plantilla: data })
}
