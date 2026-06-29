import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-auth'
import { tieneAccesoTotal } from '@/lib/cartera-filter'

// Helper: aplica el scope del usuario a una query de notificaciones
function aplicarScope(query: any, usuario: { id: string; rol: string; acceso_cartera: string }) {
  if (tieneAccesoTotal(usuario)) return query
  return query.or(`usuario_id.eq.${usuario.id},usuario_id.is.null`)
}

// GET — Listar notificaciones con filtros
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  const supabase = getSupabaseAdmin()
  const params = request.nextUrl.searchParams

  const leida = params.get('leida')
  const prioridad = params.get('prioridad')
  const tipo = params.get('tipo')
  // Filtros nuevos para el panel "Inbox" del navbar:
  //   tipo_in=A,B,C        → muestra solo esos tipos
  //   tipo_excluir=A,B     → excluye esos tipos
  // Se aplican TANTO al listado como al resumen, para que el badge cuente
  // exactamente lo mismo que el panel va a mostrar.
  const tipoIn = params.get('tipo_in')
  const tipoExcluir = params.get('tipo_excluir')
  const tiposIn = tipoIn ? tipoIn.split(',').map((s) => s.trim()).filter(Boolean) : null
  const tiposExcluir = tipoExcluir ? tipoExcluir.split(',').map((s) => s.trim()).filter(Boolean) : null
  const limite = parseInt(params.get('limite') ?? '50', 10)

  let query = supabase
    .from('notificaciones')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limite)

  if (leida === 'true') query = query.eq('leida', true)
  if (leida === 'false') query = query.eq('leida', false)
  if (prioridad) query = query.eq('prioridad', prioridad)
  if (tipo) query = query.eq('tipo', tipo)
  if (tiposIn && tiposIn.length > 0) query = query.in('tipo', tiposIn)
  if (tiposExcluir && tiposExcluir.length > 0) {
    for (const t of tiposExcluir) query = query.neq('tipo', t)
  }
  query = aplicarScope(query, usuario)

  const { data, error } = await query

  if (error) return NextResponse.json({ ok: false, error: 'Error al obtener los datos' }, { status: 500 })

  // Contadores de no leídas por prioridad (limitados al scope del usuario)
  // Aplica los mismos filtros tipo / tipo_in / tipo_excluir para que el badge
  // refleje EXACTAMENTE lo mismo que el panel va a mostrar.
  let contQuery = supabase
    .from('notificaciones')
    .select('prioridad')
    .eq('leida', false)
  if (tipo) contQuery = contQuery.eq('tipo', tipo)
  if (tiposIn && tiposIn.length > 0) contQuery = contQuery.in('tipo', tiposIn)
  if (tiposExcluir && tiposExcluir.length > 0) {
    for (const t of tiposExcluir) contQuery = contQuery.neq('tipo', t)
  }
  contQuery = aplicarScope(contQuery, usuario)

  const { data: contadores } = await contQuery

  const noLeidas = contadores ?? []
  const resumen = {
    total_no_leidas: noLeidas.length,
    criticas: noLeidas.filter((n: any) => n.prioridad === 'CRITICA').length,
    advertencias: noLeidas.filter((n: any) => n.prioridad === 'ADVERTENCIA').length,
    informativas: noLeidas.filter((n: any) => n.prioridad === 'INFORMATIVA').length,
  }

  return NextResponse.json({ ok: true, data, resumen })
}

// PATCH — Marcar como leída(s) (solo dentro del scope del usuario)
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  const supabase = getSupabaseAdmin()
  const body = await request.json()

  if (body.todas === true) {
    let q = supabase
      .from('notificaciones')
      .update({ leida: true, fecha_lectura: new Date().toISOString() })
      .eq('leida', false)
    q = aplicarScope(q, usuario)
    const { error } = await q

    if (error) return NextResponse.json({ ok: false, error: 'Error al actualizar los datos' }, { status: 500 })
    return NextResponse.json({ ok: true, mensaje: 'Todas marcadas como leídas' })
  }

  if (Array.isArray(body.ids) && body.ids.length > 0) {
    // Validar ownership: verificar que todas las ids pertenezcan al usuario
    if (!tieneAccesoTotal(usuario)) {
      const { data: propias } = await supabase
        .from('notificaciones')
        .select('id')
        .in('id', body.ids)
        .or(`usuario_id.eq.${usuario.id},usuario_id.is.null`)
      const idsValidos = (propias ?? []).map((n: any) => n.id)
      if (idsValidos.length !== body.ids.length) {
        return NextResponse.json({ ok: false, error: 'No tenés acceso a alguna de las notificaciones' }, { status: 403 })
      }
    }

    const { error } = await supabase
      .from('notificaciones')
      .update({ leida: true, fecha_lectura: new Date().toISOString() })
      .in('id', body.ids)

    if (error) return NextResponse.json({ ok: false, error: 'Error al actualizar los datos' }, { status: 500 })
    return NextResponse.json({ ok: true, mensaje: `${body.ids.length} notificación(es) marcada(s) como leída(s)` })
  }

  return NextResponse.json({ ok: false, error: 'Enviar { ids: [...] } o { todas: true }' }, { status: 400 })
}

// DELETE — Eliminar notificación(es) (solo dentro del scope del usuario)
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  const supabase = getSupabaseAdmin()
  const body = await request.json()

  if (body.leidas_antiguas === true) {
    const dias = body.dias ?? 30
    const fecha = new Date()
    fecha.setDate(fecha.getDate() - dias)
    const desde = fecha.toISOString()

    let q = supabase
      .from('notificaciones')
      .delete()
      .eq('leida', true)
      .lt('created_at', desde)
    q = aplicarScope(q, usuario)
    const { error } = await q

    if (error) return NextResponse.json({ ok: false, error: 'Error al eliminar los datos' }, { status: 500 })
    return NextResponse.json({ ok: true, mensaje: `Notificaciones leídas con más de ${dias} días eliminadas` })
  }

  if (Array.isArray(body.ids) && body.ids.length > 0) {
    if (!tieneAccesoTotal(usuario)) {
      const { data: propias } = await supabase
        .from('notificaciones')
        .select('id')
        .in('id', body.ids)
        .or(`usuario_id.eq.${usuario.id},usuario_id.is.null`)
      const idsValidos = (propias ?? []).map((n: any) => n.id)
      if (idsValidos.length !== body.ids.length) {
        return NextResponse.json({ ok: false, error: 'No tenés acceso a alguna de las notificaciones' }, { status: 403 })
      }
    }

    const { error } = await supabase
      .from('notificaciones')
      .delete()
      .in('id', body.ids)

    if (error) return NextResponse.json({ ok: false, error: 'Error al eliminar los datos' }, { status: 500 })
    return NextResponse.json({ ok: true, mensaje: `${body.ids.length} notificación(es) eliminada(s)` })
  }

  return NextResponse.json({ ok: false, error: 'Enviar { ids: [...] } o { leidas_antiguas: true, dias: 30 }' }, { status: 400 })
}
