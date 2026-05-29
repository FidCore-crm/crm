/**
 * GET    /api/comunicaciones/campanas/[id] — detalle
 * PATCH  /api/comunicaciones/campanas/[id] — editar (solo BORRADOR/PROGRAMADA)
 * DELETE /api/comunicaciones/campanas/[id] — eliminar (solo BORRADOR/CANCELADA)
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
    .from('mailing_campanas').select('*').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ ok: false, error: 'No encontrada' }, { status: 404 })
  return NextResponse.json({ ok: true, campana: data })
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  if (!UUID_REGEX.test(id)) return NextResponse.json({ ok: false, error: 'ID inválido' }, { status: 400 })

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 }) }

  const supabase = getSupabaseAdmin()
  // Solo se puede editar BORRADOR o PROGRAMADA
  const { data: act } = await supabase
    .from('mailing_campanas').select('estado').eq('id', id).maybeSingle()
  if (!act) return NextResponse.json({ ok: false, error: 'No encontrada' }, { status: 404 })
  const estado = (act as any).estado
  if (estado !== 'BORRADOR' && estado !== 'PROGRAMADA') {
    return NextResponse.json({ ok: false, error: `No se puede editar una campaña en estado ${estado}` }, { status: 400 })
  }

  // Whitelist de campos editables
  const update: Record<string, any> = {}
  for (const k of [
    'nombre', 'descripcion',
    'audiencia_id', 'personas_ids',
    'mailing_plantilla_id', 'asunto_libre', 'cuerpo_libre', 'asunto_override',
    'programada_para',
  ]) {
    if (k in body) update[k] = body[k]
  }

  // Si cambia programada_para validar fecha futura
  if ('programada_para' in update) {
    if (update.programada_para) {
      const fecha = new Date(update.programada_para)
      if (isNaN(fecha.getTime())) {
        return NextResponse.json({ ok: false, error: 'programada_para inválida' }, { status: 400 })
      }
      if (fecha.getTime() < Date.now() + 60_000) {
        return NextResponse.json({ ok: false, error: 'La fecha debe ser al menos 1 minuto en el futuro' }, { status: 400 })
      }
      update.programada_para = fecha.toISOString()
      update.estado = 'PROGRAMADA'
    } else {
      // Quitar schedule → vuelve a borrador
      update.programada_para = null
      update.estado = 'BORRADOR'
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, error: 'Sin cambios' }, { status: 400 })
  }

  const { data, error } = await (supabase.from('mailing_campanas') as any)
    .update(update).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, campana: data })
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  if (!UUID_REGEX.test(id)) return NextResponse.json({ ok: false, error: 'ID inválido' }, { status: 400 })

  const supabase = getSupabaseAdmin()
  const { data: act } = await supabase
    .from('mailing_campanas').select('estado').eq('id', id).maybeSingle()
  if (!act) return NextResponse.json({ ok: false, error: 'No encontrada' }, { status: 404 })
  const estado = (act as any).estado
  if (estado === 'EJECUTANDO') {
    return NextResponse.json({ ok: false, error: 'No se puede eliminar una campaña en ejecución. Pausala primero.' }, { status: 400 })
  }
  if (estado === 'COMPLETADA') {
    return NextResponse.json({ ok: false, error: 'No se pueden eliminar campañas completadas (queda el historial de envíos asociado)' }, { status: 400 })
  }

  const { error } = await (supabase.from('mailing_campanas') as any).delete().eq('id', id)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
