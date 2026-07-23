import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { tieneAccesoTotal } from '@/lib/cartera-filter'

/**
 * GET /api/comunicaciones/agrupados
 *
 * Historial GLOBAL agrupado: cada fila representa una campaña/envío masivo
 * (mailing_campanas) O un envío individual suelto (email_envios con
 * envio_agrupado_id NULL).
 *
 * Diseñado para reemplazar el listado plano de miles de rows en la pantalla
 * `/crm/comunicaciones`. Los envíos individuales (MANUAL, AUTOMATICO_*,
 * NOTIFICACION_INTERNA) se muestran como filas propias con `es_grupo=false`.
 * Las campañas se muestran con `es_grupo=true` y el cliente puede expandirlas
 * para ver los N destinatarios via el endpoint /agrupados/[id]/destinatarios.
 *
 * Query params:
 *   - tipo_grupo : 'campana' | 'individual' | 'todos' (default 'todos')
 *   - desde | hasta : filtros de fecha (ISO)
 *   - busqueda : texto libre en nombre de campaña / asunto / destinatario
 *   - page, page_size : paginación (default 25)
 *
 * Respeta filtro de cartera: usuarios PROPIA solo ven lo suyo. Las campañas
 * se filtran por `usuario_creador_id`; los envíos sueltos por persona_id.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  const sp = request.nextUrl.searchParams
  const tipoGrupo = sp.get('tipo_grupo') || 'todos'
  const desde = sp.get('desde') || undefined
  const hasta = sp.get('hasta') || undefined
  const busqueda = (sp.get('busqueda') || '').trim()
  const page = Math.max(1, parseInt(sp.get('page') || '1'))
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('page_size') || '25')))

  const supabase = getSupabaseAdmin()
  const esTotal = tieneAccesoTotal(usuario)

  // Para PROPIA: precomputamos los IDs de personas del usuario para filtrar
  // los envíos sueltos por persona_id.
  let idsPersonasPropias: string[] | null = null
  if (!esTotal) {
    const { data: pers } = await supabase
      .from('personas')
      .select('id')
      .eq('usuario_id', usuario.id)
    idsPersonasPropias = (pers ?? []).map((p: any) => p.id)
  }

  // ── 1) Campañas ──────────────────────────────────────────────
  let camps: any[] = []
  if (tipoGrupo === 'todos' || tipoGrupo === 'campana') {
    let q = supabase
      .from('mailing_campanas')
      .select(
        'id, nombre, asunto_libre, asunto_override, estado, total_destinatarios, enviados, fallidos, excluidos, fecha_inicio_ejecucion, fecha_fin_ejecucion, usuario_creador_id, created_at',
      )
    if (!esTotal) q = q.eq('usuario_creador_id', usuario.id)
    if (desde) q = q.gte('created_at', desde)
    if (hasta) q = q.lte('created_at', hasta)
    if (busqueda) {
      const safe = busqueda.replace(/[%_,()]/g, '')
      q = q.or(`nombre.ilike.%${safe}%,asunto_libre.ilike.%${safe}%,asunto_override.ilike.%${safe}%`)
    }
    q = q.order('created_at', { ascending: false }).limit(500)
    const { data } = await q
    camps = (data ?? []).map((c: any) => ({
      es_grupo: true,
      id: c.id,
      tipo: 'campana' as const,
      titulo: c.nombre,
      asunto: c.asunto_override || c.asunto_libre || c.nombre,
      estado_grupo: c.estado,
      total: c.total_destinatarios || 0,
      enviados: c.enviados || 0,
      fallidos: c.fallidos || 0,
      excluidos: c.excluidos || 0,
      fecha: c.fecha_inicio_ejecucion || c.created_at,
      fecha_fin: c.fecha_fin_ejecucion,
      usuario_creador_id: c.usuario_creador_id,
    }))
  }

  // ── 2) Envíos individuales sueltos (NO agrupados) ────────────
  let sueltos: any[] = []
  if (tipoGrupo === 'todos' || tipoGrupo === 'individual') {
    let q = supabase
      .from('email_envios')
      .select(
        'id, tipo_envio, destinatario_email, destinatario_nombre, asunto, estado, fecha_creacion, fecha_envio, cantidad_aperturas, cantidad_clicks, persona_id, poliza_id, enviado_por_usuario_id, archivado',
      )
      .is('envio_agrupado_id', null)
      // No traemos MASIVO sueltos legacy (backfill los agrupó, pero por si acaso).
      .not('tipo_envio', 'eq', 'MASIVO')

    if (!esTotal && idsPersonasPropias !== null) {
      if (idsPersonasPropias.length === 0) {
        sueltos = []
      } else {
        q = q.in('persona_id', idsPersonasPropias)
      }
    }
    if (desde) q = q.gte('fecha_creacion', desde)
    if (hasta) q = q.lte('fecha_creacion', hasta)
    if (busqueda) {
      const safe = busqueda.replace(/[%_,()]/g, '')
      q = q.or(
        `destinatario_email.ilike.%${safe}%,destinatario_nombre.ilike.%${safe}%,asunto.ilike.%${safe}%`,
      )
    }
    q = q.order('fecha_creacion', { ascending: false }).limit(500)
    const { data } = await q
    sueltos = (data ?? []).map((e: any) => ({
      es_grupo: false,
      id: e.id,
      tipo: e.tipo_envio,
      titulo: e.destinatario_nombre || e.destinatario_email,
      asunto: e.asunto,
      estado_grupo: e.estado,
      total: 1,
      enviados: e.estado === 'ENVIADO' ? 1 : 0,
      fallidos: e.estado === 'FALLIDO' ? 1 : 0,
      excluidos: e.estado?.startsWith('EXCLUIDO') ? 1 : 0,
      fecha: e.fecha_creacion,
      fecha_fin: e.fecha_envio,
      destinatario_email: e.destinatario_email,
      destinatario_nombre: e.destinatario_nombre,
      cantidad_aperturas: e.cantidad_aperturas || 0,
      cantidad_clicks: e.cantidad_clicks || 0,
      persona_id: e.persona_id,
      poliza_id: e.poliza_id,
    }))
  }

  // ── 3) Merge, orden global por fecha desc, paginación ────────
  const merged = [...camps, ...sueltos].sort((a, b) => {
    const fa = new Date(a.fecha).getTime()
    const fb = new Date(b.fecha).getTime()
    return fb - fa
  })

  const total = merged.length
  const inicio = (page - 1) * pageSize
  const filas = merged.slice(inicio, inicio + pageSize)

  return NextResponse.json({
    ok: true,
    filas,
    total,
    page,
    page_size: pageSize,
    total_paginas: Math.ceil(total / pageSize),
  })
}
