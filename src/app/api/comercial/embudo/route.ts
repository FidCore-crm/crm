import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-auth'
import { aplicarFiltroCartera, obtenerIdsPapelera, excluirPersonasEnPapelera } from '@/lib/cartera-filter'

// GET /api/comercial/embudo
// Query params:
//   desde (ISO date, opcional)
//   hasta (ISO date, opcional)
//   vendedor_id (uuid, opcional) — solo respetado si el usuario tiene acceso total
//   origen (string, opcional) — filtra por fuente en leads/oportunidades
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  const supabase = getSupabaseAdmin()
  const params = request.nextUrl.searchParams

  // ── Período ─────────────────────────────────────────────
  const hastaParam = params.get('hasta')
  const desdeParam = params.get('desde')
  const hasta = hastaParam ? new Date(hastaParam) : new Date()
  const desde = desdeParam
    ? new Date(desdeParam)
    : (() => { const d = new Date(hasta); d.setDate(d.getDate() - 90); return d })()

  const desdeISO = desde.toISOString()
  const hastaISO = hasta.toISOString()

  const vendedorId = params.get('vendedor_id')
  const origen = params.get('origen')

  // Helper para aplicar filtro de cartera con override de vendedor para usuarios con acceso total
  const scope = <T,>(q: T): T => {
    if (vendedorId && (usuario.rol === 'ADMIN' || usuario.acceso_cartera === 'TOTAL')) {
      // @ts-ignore
      return q.eq('usuario_id', vendedorId)
    }
    return aplicarFiltroCartera(q, usuario)
  }

  try {
    // Cargamos una sola vez los IDs de personas en papelera para excluir
    // oportunidades / cotizaciones cuyos clientes ya no deberían contar
    // en los KPIs del embudo (durante los 30 días que dura la papelera).
    const papeleraIds = await obtenerIdsPapelera(supabase)
    const sinPapelera = <T,>(q: T): T => excluirPersonasEnPapelera(q, papeleraIds, 'persona_id')

    // ── Leads en el período ─────────────────────────────────
    // Los leads NO tienen persona_id directo — el filtro de papelera no
    // aplica acá (un lead puede haber sido convertido y la persona
    // mandada a papelera, pero el lead histórico sigue siendo válido).
    let qLeadsNuevos = supabase
      .from('leads')
      .select('id, estado, fuente, created_at', { count: 'exact' })
      .gte('created_at', desdeISO)
      .lte('created_at', hastaISO)
    if (origen) qLeadsNuevos = qLeadsNuevos.eq('fuente', origen)
    qLeadsNuevos = scope(qLeadsNuevos)
    const { data: leadsData, count: leadsCount } = await qLeadsNuevos

    const totalLeads = leadsCount ?? 0
    const leadsContactadosCount = (leadsData ?? []).filter((l: any) =>
      ['CONTACTADO', 'CONVERTIDO', 'DESCARTADO'].includes(l.estado)
    ).length

    // ── Oportunidades creadas en el período ─────────────────
    let qOps = supabase
      .from('oportunidades')
      .select('id, estado, fuente, monto_estimado, motivo_perdida, persona_id, created_at, updated_at')
      .gte('created_at', desdeISO)
      .lte('created_at', hastaISO)
    if (origen) qOps = qOps.eq('fuente', origen)
    qOps = sinPapelera(scope(qOps))
    const { data: opsData } = await qOps
    const ops = (opsData ?? []) as any[]

    const opsCount = ops.length
    const opsActivas = ops.filter(o => !['GANADA', 'PERDIDA'].includes(o.estado))
    const sumaMontoOpsActivas = opsActivas.reduce(
      (acc, o) => acc + (Number(o.monto_estimado) || 0), 0
    )
    const opsPerdidas = ops.filter(o => o.estado === 'PERDIDA')
    const opsCerradas = ops.filter(o => ['GANADA', 'PERDIDA'].includes(o.estado))

    // ── Cotizaciones enviadas en el período ─────────────────
    let qCotEnviadas = supabase
      .from('cotizaciones')
      .select('id, estado, fecha_envio, fecha_cierre, motivo_perdida, lead_id, oportunidad_id, created_at')
      .not('fecha_envio', 'is', null)
      .gte('fecha_envio', desdeISO)
      .lte('fecha_envio', hastaISO)
    qCotEnviadas = sinPapelera(scope(qCotEnviadas))
    const { data: cotEnvData } = await qCotEnviadas
    const cotEnviadas = (cotEnvData ?? []) as any[]

    // ── Cotizaciones ganadas en el período ──────────────────
    let qGanadas = supabase
      .from('cotizaciones')
      .select('id, estado, fecha_cierre, fecha_envio, lead_id, oportunidad_id, created_at')
      .eq('estado', 'GANADA')
      .not('fecha_cierre', 'is', null)
      .gte('fecha_cierre', desdeISO)
      .lte('fecha_cierre', hastaISO)
    qGanadas = sinPapelera(scope(qGanadas))
    const { data: ganadasData } = await qGanadas
    const ganadas = (ganadasData ?? []) as any[]

    // ── Cotizaciones perdidas en el período (para razones) ──
    let qPerdidas = supabase
      .from('cotizaciones')
      .select('id, estado, fecha_cierre, motivo_perdida')
      .eq('estado', 'PERDIDA')
      .not('fecha_cierre', 'is', null)
      .gte('fecha_cierre', desdeISO)
      .lte('fecha_cierre', hastaISO)
    qPerdidas = sinPapelera(scope(qPerdidas))
    const { data: perdidasData } = await qPerdidas
    const cotPerdidas = (perdidasData ?? []) as any[]

    // ── Valor de ganadas: buscar el precio de la compañía seleccionada ──
    let sumaGanadas = 0
    let valorPromedioGanada = 0
    if (ganadas.length > 0) {
      const ids = ganadas.map(g => g.id)
      const { data: precios } = await supabase
        .from('cotizacion_companias')
        .select('cotizacion_id, precio, seleccionada')
        .in('cotizacion_id', ids)
        .eq('seleccionada', true)
      sumaGanadas = (precios ?? []).reduce(
        (acc: number, p: any) => acc + (Number(p.precio) || 0), 0
      )
      const conPrecio = (precios ?? []).length
      valorPromedioGanada = conPrecio > 0 ? sumaGanadas / conPrecio : 0
    }

    // ── Ciclo promedio: días entre creación del lead/oportunidad y fecha_cierre de la ganada ──
    let cicloPromedioDias = 0
    if (ganadas.length > 0) {
      const leadIds = ganadas.map(g => g.lead_id).filter(Boolean)
      const opIds = ganadas.map(g => g.oportunidad_id).filter(Boolean)

      const leadMap: Record<string, string> = {}
      const opMap: Record<string, string> = {}

      if (leadIds.length > 0) {
        const { data: lds } = await supabase
          .from('leads')
          .select('id, created_at')
          .in('id', leadIds)
        for (const l of (lds ?? []) as any[]) leadMap[l.id] = l.created_at
      }
      if (opIds.length > 0) {
        const { data: ops2 } = await supabase
          .from('oportunidades')
          .select('id, created_at')
          .in('id', opIds)
        for (const o of (ops2 ?? []) as any[]) opMap[o.id] = o.created_at
      }

      const dias: number[] = []
      for (const g of ganadas) {
        const inicio = g.lead_id ? leadMap[g.lead_id] : g.oportunidad_id ? opMap[g.oportunidad_id] : g.created_at
        if (!inicio || !g.fecha_cierre) continue
        const d = (new Date(g.fecha_cierre).getTime() - new Date(inicio).getTime()) / 86400000
        if (d >= 0 && Number.isFinite(d)) dias.push(d)
      }
      cicloPromedioDias = dias.length > 0
        ? Math.round(dias.reduce((a, b) => a + b, 0) / dias.length)
        : 0
    }

    // ── Tasas de conversión ─────────────────────────────────
    const pct = (num: number, den: number) =>
      den > 0 ? Math.round((num / den) * 1000) / 10 : 0

    const tasas = {
      leads_to_contactados: pct(leadsContactadosCount, totalLeads),
      contactados_to_ops: pct(opsCount, leadsContactadosCount),
      ops_to_cotiz: pct(cotEnviadas.length, opsCount),
      cotiz_to_ganadas: pct(ganadas.length, cotEnviadas.length),
      global: pct(ganadas.length, totalLeads),
    }

    // ── Tasa de pérdida por etapa ───────────────────────────
    const totalCotCerradas = ganadas.length + cotPerdidas.length
    const tasaPerdidaPorEtapa = {
      ops: pct(opsPerdidas.length, opsCerradas.length),
      cotizaciones: pct(cotPerdidas.length, totalCotCerradas),
    }

    // ── Razones de pérdida top 5 ────────────────────────────
    const razones: Record<string, number> = {}
    for (const o of opsPerdidas) {
      const r = (o.motivo_perdida || 'Sin motivo').trim() || 'Sin motivo'
      razones[r] = (razones[r] ?? 0) + 1
    }
    for (const c of cotPerdidas) {
      const r = (c.motivo_perdida || 'Sin motivo').trim() || 'Sin motivo'
      razones[r] = (razones[r] ?? 0) + 1
    }
    const razones_perdida_top5 = Object.entries(razones)
      .map(([razon, cantidad]) => ({ razon, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 5)

    return NextResponse.json({
      ok: true,
      periodo: { desde: desdeISO, hasta: hastaISO },
      etapas: [
        { nombre: 'Leads nuevos', cantidad: totalLeads, valor: null },
        { nombre: 'Leads contactados', cantidad: leadsContactadosCount, valor: null },
        { nombre: 'Oportunidades', cantidad: opsCount, valor: sumaMontoOpsActivas },
        { nombre: 'Cotizaciones enviadas', cantidad: cotEnviadas.length, valor: null },
        { nombre: 'Ganadas', cantidad: ganadas.length, valor: sumaGanadas },
      ],
      tasas,
      metricas: {
        ciclo_promedio_dias: cicloPromedioDias,
        valor_promedio_ganada: valorPromedioGanada,
        tasa_perdida_por_etapa: tasaPerdidaPorEtapa,
      },
      razones_perdida_top5,
    })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Error al calcular el embudo' },
      { status: 500 }
    )
  }
}
