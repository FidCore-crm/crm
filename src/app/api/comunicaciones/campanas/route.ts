/**
 * GET  /api/comunicaciones/campanas — lista paginada
 * POST /api/comunicaciones/campanas — crear nueva
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  const pagina = parseInt(request.nextUrl.searchParams.get('pagina') ?? '0', 10)
  const tamanio = Math.min(100, parseInt(request.nextUrl.searchParams.get('tamanio') ?? '25', 10))
  const estado = request.nextUrl.searchParams.get('estado')

  const supabase = getSupabaseAdmin()
  let q = supabase
    .from('mailing_campanas')
    .select(`
      id, nombre, descripcion, estado, programada_para,
      audiencia_id, mailing_plantilla_id, asunto_libre, asunto_override,
      total_destinatarios, enviados, fallidos, excluidos,
      fecha_inicio_ejecucion, fecha_fin_ejecucion, ultimo_error,
      created_at, updated_at
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(pagina * tamanio, pagina * tamanio + tamanio - 1)

  if (estado) q = q.eq('estado', estado)

  const { data, count, error } = await q
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, campanas: data ?? [], total: count ?? 0, pagina, tamanio })
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 }) }

  if (!body.nombre?.trim()) {
    return NextResponse.json({ ok: false, error: 'Falta nombre' }, { status: 400 })
  }
  if (!body.audiencia_id && !(body.personas_ids?.length > 0)) {
    return NextResponse.json({ ok: false, error: 'Falta audiencia o lista de personas' }, { status: 400 })
  }
  if (!body.mailing_plantilla_id && !(body.asunto_libre && body.cuerpo_libre)) {
    return NextResponse.json({ ok: false, error: 'Falta plantilla o textos libres (asunto + cuerpo)' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // Validar que referencias existan en DB. Sin esto, una campaña puede crearse
  // con un audiencia_id o plantilla_id inventado y fallar tarde al ejecutar.
  if (body.audiencia_id) {
    const { data: aud } = await supabase
      .from('mailing_audiencias').select('id').eq('id', body.audiencia_id).maybeSingle()
    if (!aud) {
      return NextResponse.json({ ok: false, error: 'La audiencia indicada no existe' }, { status: 400 })
    }
  }
  if (body.mailing_plantilla_id) {
    const { data: pl } = await supabase
      .from('mailing_plantillas').select('id').eq('id', body.mailing_plantilla_id).maybeSingle()
    if (!pl) {
      return NextResponse.json({ ok: false, error: 'La plantilla indicada no existe' }, { status: 400 })
    }
  }
  if (Array.isArray(body.personas_ids) && body.personas_ids.length > 0) {
    // Verificación liviana: contamos cuántas existen y comparamos contra el total enviado.
    const { count: existentes } = await supabase
      .from('personas').select('id', { count: 'exact', head: true })
      .in('id', body.personas_ids)
    if ((existentes ?? 0) !== body.personas_ids.length) {
      return NextResponse.json({ ok: false, error: 'Hay personas en la lista que no existen' }, { status: 400 })
    }
  }

  // Si tiene programada_para, validar que sea futura (mínimo +1 min)
  let programada_para: string | null = null
  let estado_inicial = 'BORRADOR'
  if (body.programada_para) {
    const fecha = new Date(body.programada_para)
    if (isNaN(fecha.getTime())) {
      return NextResponse.json({ ok: false, error: 'programada_para inválida' }, { status: 400 })
    }
    if (fecha.getTime() < Date.now() + 60_000) {
      return NextResponse.json({ ok: false, error: 'La fecha programada debe ser al menos 1 minuto en el futuro' }, { status: 400 })
    }
    programada_para = fecha.toISOString()
    estado_inicial = 'PROGRAMADA'
  }

  const { data, error } = await (supabase.from('mailing_campanas') as any)
    .insert({
      nombre: body.nombre.trim(),
      descripcion: body.descripcion?.trim() || null,
      audiencia_id: body.audiencia_id ?? null,
      personas_ids: body.personas_ids ?? [],
      mailing_plantilla_id: body.mailing_plantilla_id ?? null,
      asunto_libre: body.asunto_libre ?? null,
      cuerpo_libre: body.cuerpo_libre ?? null,
      asunto_override: body.asunto_override?.trim() || null,
      programada_para,
      estado: estado_inicial,
      usuario_creador_id: auth.id,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, campana: data })
}
