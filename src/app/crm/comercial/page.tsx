'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  UserPlus, PhoneCall, UserCheck, Target, FileText, TrendingUp,
  Search, X, ChevronRight, LayoutGrid,
  Briefcase, BarChart3
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { aplicarFiltroCartera } from '@/lib/cartera-filter'
import { sanitizarBusquedaNormalizada } from '@/lib/utils'
import { EstadoCarga } from '@/components/EstadoCarga'
import EmbudoTab from './_embudo'
import { useRealtimeRefresh } from '@/lib/hooks/useRealtimeRefresh'

// ── Tipos ──────────────────────────────────────────────
interface ItemComercial {
  id: string
  nombre: string
  apellido: string
  estado: string
  fuente: string
  tipo: string
  created_at: string
  origen_tipo: 'lead' | 'oportunidad'
  persona_id?: string
  tiene_cotizacion: boolean
  ultima_cot_estado?: string
}

// ── Badges ─────────────────────────────────────────────
const ESTADO_LEAD_BADGE: Record<string, { label: string; color: string }> = {
  NUEVO:      { label: 'Nuevo',      color: 'bg-blue-50 text-blue-700 border-blue-200' },
  CONTACTADO: { label: 'Contactado', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  DESCARTADO: { label: 'Descartado', color: 'bg-red-50 text-red-700 border-red-200' },
}

const ESTADO_OP_BADGE: Record<string, { label: string; color: string }> = {
  DETECTADA:   { label: 'Detectada',   color: 'bg-slate-100 text-slate-600 border-slate-200' },
  CONTACTADO:  { label: 'Contactado',  color: 'bg-amber-50 text-amber-700 border-amber-200' },
  NEGOCIACION: { label: 'Negociación', color: 'bg-blue-50 text-blue-700 border-blue-200' },
}

const TIPO_OP_BADGE: Record<string, { label: string; color: string }> = {
  CROSS_SELL:   { label: 'Cross-sell',    color: 'bg-violet-50 text-violet-700 border-violet-200' },
  RECUPERACION: { label: 'Recuperación',  color: 'bg-orange-50 text-orange-700 border-orange-200' },
  NUEVA_VENTA:  { label: 'Nueva venta',   color: 'bg-blue-50 text-blue-700 border-blue-200' },
}

const FUENTE_BADGE: Record<string, string> = {
  REFERIDO: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  WEB: 'bg-blue-50 text-blue-700 border-blue-200',
  REDES_SOCIALES: 'bg-violet-50 text-violet-700 border-violet-200',
  LLAMADA_ENTRANTE: 'bg-orange-50 text-orange-700 border-orange-200',
  EVENTO: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  OTRO: 'bg-slate-100 text-slate-600 border-slate-200',
  AUTOMATICA: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  MANUAL: 'bg-slate-100 text-slate-600 border-slate-200',
}

const FUENTE_LABEL: Record<string, string> = {
  REFERIDO: 'Referido', WEB: 'Web', REDES_SOCIALES: 'Redes', LLAMADA_ENTRANTE: 'Llamada',
  EVENTO: 'Evento', OTRO: 'Otro', AUTOMATICA: 'Auto', MANUAL: 'Manual',
}

const COT_BADGE: Record<string, { label: string; color: string }> = {
  BORRADOR: { label: 'Borrador', color: 'bg-slate-100 text-slate-600 border-slate-200' },
  ENVIADA: { label: 'Enviada', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  EN_PROCESO: { label: 'En proceso', color: 'bg-amber-50 text-amber-700 border-amber-200' },
}

function diasDesde(fecha: string): number {
  return Math.floor((Date.now() - new Date(fecha).getTime()) / 86400000)
}

function diasDesdeLabel(fecha: string): string {
  const d = diasDesde(fecha)
  if (d === 0) return 'hoy'
  if (d === 1) return 'hace 1 día'
  return `hace ${d} días`
}

export default function ComercialPage() {
  const router    = useRouter()
  const supabase  = getSupabaseClient()
  const searchRef = useRef<NodeJS.Timeout>()
  const { usuario } = useAuth()

  const [items,    setItems]    = useState<ItemComercial[]>([])
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<{ codigo?: string; mensaje: string } | null>(null)
  const [total,    setTotal]    = useState(0)
  const [pagina,   setPagina]   = useState(0)
  const POR_PAGINA = 25

  const [busqueda,         setBusqueda]         = useState('')
  const [busquedaDebounce, setBusquedaDebounce] = useState('')
  const [filtroTipo,       setFiltroTipo]       = useState('')
  const [filtroEstado,     setFiltroEstado]     = useState('')
  const [filtroFuente,     setFiltroFuente]     = useState('')

  const [tabActiva, setTabActiva] = useState<'gestion' | 'embudo'>('gestion')

  const [kpis, setKpis] = useState({
    leadsNuevosMes: 0, leadsContactados: 0, conversionesMes: 0,
    opsAbiertas: 0, cotsEnProceso: 0, tasaConversion: -1,
  })

  // Contadores para accesos rápidos
  const [contadores, setContadores] = useState({ leads: 0, ops: 0, cots: 0, pipeline: 0 })

  // Tick que Realtime incrementa para forzar refetch de KPIs.
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => { setBusquedaDebounce(busqueda); setPagina(0) }, 350)
  }, [busqueda])

  // KPIs + contadores
  useEffect(() => {
    async function cargar() {
      const primerDiaMes = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`
      const hace90d = new Date(); hace90d.setDate(hace90d.getDate() - 90)

      const [ln, lc, conv, oa, cp, cg90, cp90, cLeads, cOps, cCots, cPipe] = await Promise.all([
        aplicarFiltroCartera(supabase.from('leads').select('id', { count: 'exact', head: true }).eq('estado', 'NUEVO').gte('created_at', primerDiaMes), usuario),
        aplicarFiltroCartera(supabase.from('leads').select('id', { count: 'exact', head: true }).eq('estado', 'CONTACTADO'), usuario),
        aplicarFiltroCartera(supabase.from('personas').select('id', { count: 'exact', head: true }).eq('origen', 'LEAD').gte('fecha_alta', primerDiaMes).is('deleted_at', null), usuario),
        aplicarFiltroCartera(supabase.from('oportunidades').select('id', { count: 'exact', head: true }).not('estado', 'in', '("GANADA","PERDIDA")'), usuario),
        aplicarFiltroCartera(supabase.from('cotizaciones').select('id', { count: 'exact', head: true }).in('estado', ['ENVIADA', 'EN_PROCESO']), usuario),
        aplicarFiltroCartera(supabase.from('cotizaciones').select('id', { count: 'exact', head: true }).eq('estado', 'GANADA').gte('fecha_cierre', hace90d.toISOString()), usuario),
        aplicarFiltroCartera(supabase.from('cotizaciones').select('id', { count: 'exact', head: true }).eq('estado', 'PERDIDA').gte('fecha_cierre', hace90d.toISOString()), usuario),
        aplicarFiltroCartera(supabase.from('leads').select('id', { count: 'exact', head: true }).in('estado', ['NUEVO', 'CONTACTADO']), usuario),
        aplicarFiltroCartera(supabase.from('oportunidades').select('id', { count: 'exact', head: true }).not('estado', 'in', '("GANADA","PERDIDA")'), usuario),
        aplicarFiltroCartera(supabase.from('cotizaciones').select('id', { count: 'exact', head: true }).not('estado', 'in', '("GANADA","PERDIDA")'), usuario),
        aplicarFiltroCartera(supabase.from('cotizaciones').select('id', { count: 'exact', head: true }).in('estado', ['ENVIADA', 'EN_PROCESO']), usuario),
      ])

      const ganadas90 = cg90.count ?? 0
      const perdidas90 = cp90.count ?? 0
      const totalCerradas = ganadas90 + perdidas90
      const tasa = totalCerradas > 0 ? Math.round((ganadas90 / totalCerradas) * 100) : -1

      setKpis({
        leadsNuevosMes: ln.count ?? 0,
        leadsContactados: lc.count ?? 0,
        conversionesMes: conv.count ?? 0,
        opsAbiertas: oa.count ?? 0,
        cotsEnProceso: cp.count ?? 0,
        tasaConversion: tasa,
      })
      setContadores({
        leads: cLeads.count ?? 0,
        ops: cOps.count ?? 0,
        cots: cCots.count ?? 0,
        pipeline: cPipe.count ?? 0,
      })
    }
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, usuario, refreshTick])

  // Lista combinada
  const cargarItems = useCallback(async (silencioso: boolean = false) => {
    if (!silencioso) setCargando(true)
    setErrorCarga(null)

    // Query leads (excluir CONVERTIDO)
    let qLeads = aplicarFiltroCartera(supabase
      .from('leads')
      .select('id, nombre, apellido, estado, fuente, nivel_interes, created_at')
      .not('estado', 'eq', 'CONVERTIDO'), usuario)

    // Query oportunidades (excluir GANADA/PERDIDA)
    let qOps = aplicarFiltroCartera(supabase
      .from('oportunidades')
      .select('id, persona_id, tipo, fuente, estado, created_at, persona:personas!persona_id(nombre, apellido)')
      .not('estado', 'in', '("GANADA","PERDIDA")'), usuario)

    if (filtroTipo === 'leads') qOps = qOps.eq('id', '00000000-0000-0000-0000-000000000000') // hack: forzar vacío
    if (filtroTipo === 'oportunidades') qLeads = qLeads.eq('id', '00000000-0000-0000-0000-000000000000')

    if (filtroEstado) {
      qLeads = qLeads.eq('estado', filtroEstado)
      qOps = qOps.eq('estado', filtroEstado)
    }

    if (filtroFuente) {
      qLeads = qLeads.eq('fuente', filtroFuente)
      qOps = qOps.eq('fuente', filtroFuente)
    }

    if (busquedaDebounce) {
      const termino = sanitizarBusquedaNormalizada(busquedaDebounce)
      qLeads = qLeads.or(`nombre_norm.ilike.%${termino}%,apellido_norm.ilike.%${termino}%`)
      // For oportunidades we need to filter by persona, but can't do subquery easily. Load all and filter client-side.
    }

    const [resLeads, resOps] = await Promise.all([qLeads, qOps])
    if (resLeads.error || resOps.error) {
      setErrorCarga({ mensaje: (resLeads.error ?? resOps.error)?.message ?? 'No se pudieron cargar las gestiones.' })
      setCargando(false)
      return
    }
    const leadsData = resLeads.data
    const opsData = resOps.data

    // Build items
    let combined: ItemComercial[] = []

    for (const l of (leadsData ?? []) as any[]) {
      combined.push({
        id: l.id, nombre: l.nombre, apellido: l.apellido,
        estado: l.estado, fuente: l.fuente, tipo: l.nivel_interes ?? '',
        created_at: l.created_at, origen_tipo: 'lead',
        tiene_cotizacion: false,
      })
    }

    for (const o of (opsData ?? []) as any[]) {
      const p = o.persona
      if (busquedaDebounce && p) {
        const search = busquedaDebounce.toLowerCase()
        if (!p.nombre?.toLowerCase().includes(search) && !p.apellido?.toLowerCase().includes(search)) continue
      }
      combined.push({
        id: o.id, nombre: p?.nombre ?? '', apellido: p?.apellido ?? '',
        estado: o.estado, fuente: o.fuente, tipo: o.tipo,
        created_at: o.created_at, origen_tipo: 'oportunidad',
        persona_id: o.persona_id,
        tiene_cotizacion: false,
      })
    }

    // Sort by created_at DESC
    combined.sort((a, b) => b.created_at.localeCompare(a.created_at))

    // Check cotizaciones for all items in one batch
    const leadIds = combined.filter(i => i.origen_tipo === 'lead').map(i => i.id)
    const opIds = combined.filter(i => i.origen_tipo === 'oportunidad').map(i => i.id)

    const [{ data: cotLeads }, { data: cotOps }] = await Promise.all([
      leadIds.length > 0
        ? supabase.from('cotizaciones').select('lead_id, estado').in('lead_id', leadIds).in('estado', ['BORRADOR', 'ENVIADA', 'EN_PROCESO'])
        : Promise.resolve({ data: [] }),
      opIds.length > 0
        ? supabase.from('cotizaciones').select('oportunidad_id, estado').in('oportunidad_id', opIds).in('estado', ['BORRADOR', 'ENVIADA', 'EN_PROCESO'])
        : Promise.resolve({ data: [] }),
    ])

    const cotLeadMap: Record<string, string> = {}
    for (const c of (cotLeads ?? []) as any[]) { if (c.lead_id) cotLeadMap[c.lead_id] = c.estado }
    const cotOpMap: Record<string, string> = {}
    for (const c of (cotOps ?? []) as any[]) { if (c.oportunidad_id) cotOpMap[c.oportunidad_id] = c.estado }

    for (const item of combined) {
      if (item.origen_tipo === 'lead' && cotLeadMap[item.id]) {
        item.tiene_cotizacion = true
        item.ultima_cot_estado = cotLeadMap[item.id]
      }
      if (item.origen_tipo === 'oportunidad' && cotOpMap[item.id]) {
        item.tiene_cotizacion = true
        item.ultima_cot_estado = cotOpMap[item.id]
      }
    }

    setTotal(combined.length)
    setItems(combined.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA))
    setCargando(false)
  }, [supabase, filtroTipo, filtroEstado, filtroFuente, busquedaDebounce, pagina, usuario])

  useEffect(() => { cargarItems() }, [cargarItems])

  // Realtime: cualquier cambio en las 3 tablas comerciales refresca dashboard
  // (KPIs vía tick + lista combinada).
  useRealtimeRefresh({
    tablas: ['leads', 'oportunidades', 'cotizaciones'],
    onCambio: () => { cargarItems(true); setRefreshTick(t => t + 1) },
  })

  const limpiarFiltros = () => { setBusqueda(''); setFiltroTipo(''); setFiltroEstado(''); setFiltroFuente(''); setPagina(0) }
  const hayFiltros = busqueda || filtroTipo || filtroEstado || filtroFuente

  const tasaColor = kpis.tasaConversion >= 50 ? 'text-emerald-700' : kpis.tasaConversion >= 30 ? 'text-amber-700' : 'text-red-700'
  const tasaBg = kpis.tasaConversion >= 50 ? 'bg-emerald-50 border-emerald-200' : kpis.tasaConversion >= 30 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Gestión comercial</h1>
          <p className="text-xs text-slate-600">Centro de comando del área de ventas</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        <button
          onClick={() => setTabActiva('gestion')}
          className={`flex items-center gap-1 px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
            tabActiva === 'gestion'
              ? 'border-slate-800 text-slate-800'
              : 'border-transparent text-slate-600 hover:text-slate-700'
          }`}
        >
          <Briefcase className="h-3 w-3" /> Gestión
        </button>
        <button
          onClick={() => setTabActiva('embudo')}
          className={`flex items-center gap-1 px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
            tabActiva === 'embudo'
              ? 'border-slate-800 text-slate-800'
              : 'border-transparent text-slate-600 hover:text-slate-700'
          }`}
        >
          <BarChart3 className="h-3 w-3" /> Embudo
        </button>
      </div>

      {tabActiva === 'embudo' ? <EmbudoTab /> : (
      <>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2">
        <div className="kpi-card bg-blue-50 border border-blue-200">
          <span className="kpi-label flex items-center gap-1"><UserPlus className="h-3 w-3 text-blue-600"/> Leads nuevos este mes</span>
          <span className="kpi-value text-blue-700">{kpis.leadsNuevosMes}</span>
          <span className="kpi-sub">ingresaron este mes</span>
        </div>
        <div className="kpi-card bg-amber-50 border border-amber-200">
          <span className="kpi-label flex items-center gap-1"><PhoneCall className="h-3 w-3 text-amber-600"/> Leads contactados</span>
          <span className="kpi-value text-amber-700">{kpis.leadsContactados}</span>
          <span className="kpi-sub">en seguimiento</span>
        </div>
        <div className="kpi-card bg-emerald-50 border border-emerald-200">
          <span className="kpi-label flex items-center gap-1"><UserCheck className="h-3 w-3 text-emerald-600"/> Conversiones este mes</span>
          <span className="kpi-value text-emerald-700">{kpis.conversionesMes}</span>
          <span className="kpi-sub">leads → clientes</span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="kpi-card bg-violet-50 border border-violet-200">
          <span className="kpi-label flex items-center gap-1"><Target className="h-3 w-3 text-violet-600"/> Oportunidades abiertas</span>
          <span className="kpi-value text-violet-700">{kpis.opsAbiertas}</span>
          <span className="kpi-sub">en seguimiento</span>
        </div>
        <div className="kpi-card bg-orange-50 border border-orange-200">
          <span className="kpi-label flex items-center gap-1"><FileText className="h-3 w-3 text-orange-600"/> Cotizaciones en proceso</span>
          <span className="kpi-value text-orange-700">{kpis.cotsEnProceso}</span>
          <span className="kpi-sub">enviadas + en negociación</span>
        </div>
        <div className={`kpi-card border ${kpis.tasaConversion >= 0 ? tasaBg : 'bg-slate-50 border-slate-200'}`}>
          <span className="kpi-label flex items-center gap-1"><TrendingUp className={`h-3 w-3 ${kpis.tasaConversion >= 50 ? 'text-emerald-600' : kpis.tasaConversion >= 30 ? 'text-amber-600' : 'text-red-600'}`}/> Tasa de conversión (90d)</span>
          <span className={`kpi-value ${kpis.tasaConversion >= 0 ? tasaColor : 'text-slate-700'}`}>
            {kpis.tasaConversion >= 0 ? `${kpis.tasaConversion}%` : '—'}
          </span>
          <span className="kpi-sub">cotizaciones ganadas vs cerradas</span>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-slate-200 rounded p-2 flex items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-500"/>
          <input className="search-input w-full pl-6" placeholder="Buscar por nombre..."
            value={busqueda} onChange={e => setBusqueda(e.target.value)}/>
        </div>
        <select className="form-input" value={filtroTipo} onChange={e => { setFiltroTipo(e.target.value); setFiltroEstado(''); setPagina(0) }}>
          <option value="">Todos</option>
          <option value="leads">Solo leads</option>
          <option value="oportunidades">Solo oportunidades</option>
        </select>
        <select className="form-input" value={filtroEstado} onChange={e => { setFiltroEstado(e.target.value); setPagina(0) }}>
          <option value="">Todos los estados</option>
          {filtroTipo === 'leads' ? (
            <>
              <option value="NUEVO">Nuevo</option>
              <option value="CONTACTADO">Contactado</option>
              <option value="DESCARTADO">Descartado</option>
            </>
          ) : filtroTipo === 'oportunidades' ? (
            <>
              <option value="DETECTADA">Detectada</option>
              <option value="CONTACTADO">Contactado</option>
              <option value="NEGOCIACION">Negociación</option>
            </>
          ) : (
            <>
              <option value="NUEVO">Nuevo</option>
              <option value="CONTACTADO">Contactado</option>
              <option value="DETECTADA">Detectada</option>
              <option value="NEGOCIACION">Negociación</option>
              <option value="DESCARTADO">Descartado</option>
            </>
          )}
        </select>
        <select className="form-input" value={filtroFuente} onChange={e => { setFiltroFuente(e.target.value); setPagina(0) }}>
          <option value="">Todas las fuentes</option>
          <option value="REFERIDO">Referido</option>
          <option value="WEB">Web</option>
          <option value="REDES_SOCIALES">Redes sociales</option>
          <option value="LLAMADA_ENTRANTE">Llamada entrante</option>
          <option value="MANUAL">Manual</option>
          <option value="AUTOMATICA">Automática</option>
        </select>
        {hayFiltros && (
          <button onClick={limpiarFiltros} className="btn-secondary flex items-center gap-1">
            <X className="h-3 w-3"/> Limpiar
          </button>
        )}
      </div>

      {/* Tabla combinada */}
      <EstadoCarga
        loading={cargando}
        error={errorCarga}
        empty={!cargando && !errorCarga && items.length === 0}
        emptyMensaje={hayFiltros ? 'No hay resultados con esos filtros.' : 'No hay gestiones comerciales activas.'}
        onReintentar={cargarItems}
      >
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Nombre</th>
              <th>Estado</th>
              <th>Fuente</th>
              <th>Cotización</th>
              <th>Antigüedad</th>
              <th style={{ width: 90 }}>Acción</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              const d = diasDesde(item.created_at)
              const sinContactar = item.origen_tipo === 'lead' && item.estado === 'NUEVO' && d > 7
              const estancada = item.origen_tipo === 'oportunidad' && d > 15

              const estadoBadge = item.origen_tipo === 'lead'
                ? (ESTADO_LEAD_BADGE[item.estado] ?? { label: item.estado, color: 'bg-slate-100 text-slate-600 border-slate-200' })
                : (ESTADO_OP_BADGE[item.estado] ?? { label: item.estado, color: 'bg-slate-100 text-slate-600 border-slate-200' })

              const tipoBadge = item.origen_tipo === 'oportunidad'
                ? (TIPO_OP_BADGE[item.tipo] ?? { label: item.tipo, color: 'bg-slate-100 text-slate-600 border-slate-200' })
                : null

              const href = item.origen_tipo === 'lead'
                ? `/crm/comercial/leads/${item.id}`
                : `/crm/comercial/oportunidades/${item.id}`

              const cotizarHref = item.origen_tipo === 'lead'
                ? `/crm/comercial/cotizaciones/nueva?lead_id=${item.id}`
                : `/crm/comercial/cotizaciones/nueva?oportunidad_id=${item.id}&persona_id=${item.persona_id}`

              return (
                <tr key={`${item.origen_tipo}-${item.id}`} className="cursor-pointer hover:bg-slate-50"
                  onClick={() => router.push(href)}>
                  <td>
                    {item.origen_tipo === 'lead' ? (
                      <span className="text-2xs font-semibold px-1.5 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-200 flex items-center gap-1 w-fit">
                        <UserPlus className="h-3 w-3"/> Lead
                      </span>
                    ) : (
                      <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border flex items-center gap-1 w-fit ${tipoBadge?.color ?? ''}`}>
                        <Target className="h-3 w-3"/> {tipoBadge?.label ?? 'Op.'}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="text-xs font-medium text-slate-700">
                      {item.apellido}, {item.nombre}
                    </span>
                  </td>
                  <td>
                    <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${estadoBadge.color}`}>
                      {estadoBadge.label}
                    </span>
                  </td>
                  <td>
                    <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${FUENTE_BADGE[item.fuente] ?? FUENTE_BADGE.OTRO}`}>
                      {FUENTE_LABEL[item.fuente] ?? item.fuente}
                    </span>
                  </td>
                  <td>
                    {item.tiene_cotizacion ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-emerald-600 text-xs">✓</span>
                        {item.ultima_cot_estado && (
                          <span className={`text-2xs font-semibold px-1 py-0.5 rounded border ${COT_BADGE[item.ultima_cot_estado]?.color ?? ''}`}>
                            {COT_BADGE[item.ultima_cot_estado]?.label ?? ''}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-300 text-xs">—</span>
                    )}
                  </td>
                  <td>
                    <span className="text-xs text-slate-600">{diasDesdeLabel(item.created_at)}</span>
                    {sinContactar && (
                      <span className="block text-2xs font-semibold px-1.5 py-0.5 rounded border bg-red-50 text-red-700 border-red-200 w-fit mt-0.5">Sin contactar</span>
                    )}
                    {estancada && (
                      <span className="block text-2xs font-semibold px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200 w-fit mt-0.5">Estancada</span>
                    )}
                  </td>
                  <td>
                    {!item.tiene_cotizacion && (
                      <button onClick={(e) => { e.stopPropagation(); router.push(cotizarHref) }}
                        className="btn-primary text-2xs py-1 px-2">
                        Cotizar
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      </EstadoCarga>

      {/* Paginación */}
      {Math.ceil(total / POR_PAGINA) > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-600 pb-2">
          <span>Mostrando {pagina * POR_PAGINA + 1}–{Math.min((pagina + 1) * POR_PAGINA, total)} de {total}</span>
          <div className="flex gap-1">
            <button onClick={() => setPagina(p => Math.max(0, p - 1))} disabled={pagina === 0} className="btn-secondary px-3">← Anterior</button>
            <button onClick={() => setPagina(p => Math.min(Math.ceil(total / POR_PAGINA) - 1, p + 1))} disabled={pagina >= Math.ceil(total / POR_PAGINA) - 1} className="btn-secondary px-3">Siguiente →</button>
          </div>
        </div>
      )}

      {/* Accesos rápidos */}
      <div className="grid grid-cols-4 gap-2 pb-2">
        {[
          { href: '/crm/comercial/leads', icon: UserPlus, label: 'Leads', sub: 'Gestionar contactos potenciales', count: contadores.leads, color: 'text-blue-600', bg: 'hover:bg-blue-50' },
          { href: '/crm/comercial/oportunidades', icon: Target, label: 'Oportunidades', sub: 'Ver oportunidades de venta', count: contadores.ops, color: 'text-violet-600', bg: 'hover:bg-violet-50' },
          { href: '/crm/comercial/cotizaciones', icon: FileText, label: 'Cotizaciones', sub: 'Ver todas las cotizaciones', count: contadores.cots, color: 'text-orange-600', bg: 'hover:bg-orange-50' },
          { href: '/crm/comercial/pipeline', icon: LayoutGrid, label: 'Pipeline', sub: 'Ver tablero de ventas', count: contadores.pipeline, color: 'text-emerald-600', bg: 'hover:bg-emerald-50' },
        ].map(card => (
          <button key={card.href} onClick={() => router.push(card.href)}
            className={`bg-white border border-slate-200 rounded p-3 text-left ${card.bg} transition-colors group`}>
            <div className="flex items-center justify-between mb-1">
              <card.icon className={`h-4 w-4 ${card.color}`}/>
              <span className="font-mono text-xs font-semibold text-slate-700">{card.count}</span>
            </div>
            <p className="text-xs font-semibold text-slate-700">{card.label}</p>
            <p className="text-2xs text-slate-600">{card.sub}</p>
            <ChevronRight className="h-3 w-3 text-slate-300 group-hover:text-slate-600 mt-1 transition-colors"/>
          </button>
        ))}
      </div>
      </>
      )}
    </div>
  )
}
