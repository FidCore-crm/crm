import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { tieneAccesoTotal } from '@/lib/cartera-filter'

/**
 * GET /api/comunicaciones/agrupados/[id]/destinatarios
 *
 * Lista los N destinatarios de una campaña (mailing_campanas.id).
 *
 * Query params:
 *   - estado : filtro opcional (ENVIADO / FALLIDO / EXCLUIDO_*)
 *   - busqueda : ILIKE sobre email/nombre
 *   - page, page_size : paginación (default 25)
 */
export async function GET(request: NextRequest, context: { params: { id: string } }) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth
  const { id } = context.params

  const sp = request.nextUrl.searchParams
  const estado = sp.get('estado') || undefined
  const busqueda = (sp.get('busqueda') || '').trim()
  const page = Math.max(1, parseInt(sp.get('page') || '1'))
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('page_size') || '25')))

  const supabase = getSupabaseAdmin()

  // Verificar acceso: si no es TOTAL, tiene que ser el creador de la campaña.
  if (!tieneAccesoTotal(usuario)) {
    const { data: camp } = await supabase
      .from('mailing_campanas')
      .select('usuario_creador_id')
      .eq('id', id)
      .maybeSingle()
    const owner = (camp as any)?.usuario_creador_id ?? null
    if (owner !== null && owner !== usuario.id) {
      return NextResponse.json({ ok: false, error: 'Sin acceso' }, { status: 403 })
    }
  }

  // Traer la info de la campaña para el header del panel.
  const { data: campana } = await supabase
    .from('mailing_campanas')
    .select(
      'id, nombre, asunto_libre, asunto_override, estado, total_destinatarios, enviados, fallidos, excluidos, fecha_inicio_ejecucion, fecha_fin_ejecucion, created_at, cuerpo_libre',
    )
    .eq('id', id)
    .maybeSingle()

  if (!campana) {
    return NextResponse.json({ ok: false, error: 'Campaña no encontrada' }, { status: 404 })
  }

  // Query de los envíos individuales linkeados.
  let q = supabase
    .from('email_envios')
    .select(
      'id, destinatario_email, destinatario_nombre, asunto, estado, error_mensaje, fecha_creacion, fecha_envio, cantidad_aperturas, cantidad_clicks, fecha_apertura, fecha_primer_click, persona_id, poliza_id',
      { count: 'exact' },
    )
    .eq('envio_agrupado_id', id)

  if (estado) q = q.eq('estado', estado)
  if (busqueda) {
    const safe = busqueda.replace(/[%_,()]/g, '')
    q = q.or(`destinatario_email.ilike.%${safe}%,destinatario_nombre.ilike.%${safe}%`)
  }

  q = q.order('fecha_creacion', { ascending: false })
  q = q.range((page - 1) * pageSize, page * pageSize - 1)

  const { data, count, error } = await q
  if (error) {
    return NextResponse.json({ ok: false, error: 'Error al obtener destinatarios' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    campana,
    destinatarios: data ?? [],
    total: count ?? 0,
    page,
    page_size: pageSize,
    total_paginas: Math.ceil((count ?? 0) / pageSize),
  })
}
