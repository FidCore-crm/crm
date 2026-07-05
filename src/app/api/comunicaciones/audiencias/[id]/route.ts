/**
 * GET    /api/comunicaciones/audiencias/[id]
 * PATCH  /api/comunicaciones/audiencias/[id]
 * DELETE /api/comunicaciones/audiencias/[id]  (soft, desactivar)
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  if (!UUID_REGEX.test(id)) return NextResponse.json({ ok: false, error: 'ID inválido' }, { status: 400 })

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('mailing_audiencias').select('*').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ ok: false, error: 'No encontrada' }, { status: 404 })
  return NextResponse.json({ ok: true, audiencia: data })
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  if (!UUID_REGEX.test(id)) return NextResponse.json({ ok: false, error: 'ID inválido' }, { status: 400 })

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 }) }

  const update: Record<string, any> = {}
  for (const k of ['nombre','descripcion','tipo','filtro_jsonb','ids_personas','ids_leads','activa']) {
    if (k in body) update[k] = body[k]
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, error: 'Sin campos a actualizar' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await (supabase.from('mailing_audiencias') as any)
    .update(update).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, audiencia: data })
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  if (!UUID_REGEX.test(id)) return NextResponse.json({ ok: false, error: 'ID inválido' }, { status: 400 })

  const supabase = getSupabaseAdmin()
  const { error } = await (supabase.from('mailing_audiencias') as any)
    .update({ activa: false }).eq('id', id)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
