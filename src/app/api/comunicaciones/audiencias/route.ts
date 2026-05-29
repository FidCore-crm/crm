/**
 * GET  /api/comunicaciones/audiencias — lista activas
 * POST /api/comunicaciones/audiencias — crear nueva
 *
 * Las audiencias son segmentos de cartera guardados reutilizables (FILTRO o MANUAL).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  const incluirInactivas = request.nextUrl.searchParams.get('incluir_inactivas') === '1'

  const supabase = getSupabaseAdmin()
  let q = supabase
    .from('mailing_audiencias')
    .select('id, nombre, descripcion, tipo, filtro_jsonb, ids_personas, ultima_cantidad, ultimo_preview_en, activa, created_at, updated_at')
    .order('updated_at', { ascending: false })

  if (!incluirInactivas) q = q.eq('activa', true)

  const { data, error } = await q
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, audiencias: data ?? [] })
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 }) }

  if (!body.nombre || typeof body.nombre !== 'string') {
    return NextResponse.json({ ok: false, error: 'Falta nombre' }, { status: 400 })
  }
  if (body.tipo !== 'FILTRO' && body.tipo !== 'MANUAL') {
    return NextResponse.json({ ok: false, error: 'Tipo debe ser FILTRO o MANUAL' }, { status: 400 })
  }
  if (body.tipo === 'FILTRO' && !body.filtro_jsonb) {
    return NextResponse.json({ ok: false, error: 'Tipo FILTRO requiere filtro_jsonb' }, { status: 400 })
  }
  if (body.tipo === 'MANUAL' && (!Array.isArray(body.ids_personas) || body.ids_personas.length === 0)) {
    return NextResponse.json({ ok: false, error: 'Tipo MANUAL requiere ids_personas no vacío' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await (supabase.from('mailing_audiencias') as any)
    .insert({
      nombre: body.nombre,
      descripcion: body.descripcion ?? null,
      tipo: body.tipo,
      filtro_jsonb: body.tipo === 'FILTRO' ? body.filtro_jsonb : null,
      ids_personas: body.tipo === 'MANUAL' ? body.ids_personas : [],
      activa: body.activa ?? true,
      usuario_creador_id: auth.id,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, audiencia: data })
}
