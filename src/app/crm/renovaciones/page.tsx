'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search, RefreshCw, X, Eye, MessageCircle,
  AlertTriangle, Clock, AlertOctagon, CheckCircle2, Timer, Send
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { formatFechaLocal, hoyAR, diasHastaVencimiento, getLabelEstado, getPolizaBadgeColor, getEstadoEfectivoPoliza, sanitizarBusquedaNormalizada } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { obtenerIdsPersonas, filtrarPorPersonas } from '@/lib/cartera-filter'
import ModalEnviarEmailMasivo from '@/components/ModalEnviarEmailMasivo'
import { EstadoCarga } from '@/components/EstadoCarga'
import { apiCall } from '@/lib/api-client'
import { construirUrlWhatsapp } from '@/lib/whatsapp-templates'
import { useRealtimeRefresh } from '@/lib/hooks/useRealtimeRefresh'

interface Poliza {
  id: string
  numero_poliza: string
  fecha_inicio: string
  fecha_fin: string
  estado: string
  poliza_origen_id: string | null
  asegurado: { id: string; apellido: string; nombre: string; razon_social: string | null; email: string | null; acepta_marketing: boolean; telefono: string | null; whatsapp: string | null }
  compania: { id: string; nombre: string } | null
  ramo: { id: string; nombre: string } | null
  cobertura: { id: string; nombre: string } | null
}

interface Catalogo { id: string; nombre: string }

function nombreAsegurado(p: Poliza) {
  return [p.asegurado?.apellido, p.asegurado?.nombre].filter(Boolean).join(', ') || p.asegurado?.razon_social || '—'
}

function diasColor(dias: number, estado: string) {
  if (estado === 'RENOVADA') return 'text-violet-700'
  if (estado === 'NO_VIGENTE') return 'text-red-800 font-semibold'
  if (dias < 0) return 'text-red-800 font-semibold'
  if (dias <= 7) return 'text-red-600 font-semibold'
  if (dias <= 15) return 'text-orange-600 font-semibold'
  if (dias <= 30) return 'text-amber-600 font-medium'
  return 'text-slate-600'
}

export default function RenovacionesPage() {
  const router    = useRouter()
  const supabase  = getSupabaseClient()
  const searchRef = useRef<NodeJS.Timeout>()
  const { usuario } = useAuth()

  const [polizas,   setPolizas]   = useState<Poliza[]>([])
  const [cargando,  setCargando]  = useState(true)
  const [errorCarga, setErrorCarga] = useState<{ codigo?: string; mensaje: string } | null>(null)
  const [total,     setTotal]     = useState(0)
  const [pagina,    setPagina]    = useState(0)
  const POR_PAGINA = 25

  // Selección masiva
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  const [modalMasivo, setModalMasivo] = useState(false)
  const [comunicacionesActivo, setComunicacionesActivo] = useState(false)
  const isAdmin = usuario?.rol === 'ADMIN'

  const [busqueda,         setBusqueda]         = useState('')
  const [busquedaDebounce, setBusquedaDebounce] = useState('')
  const [filtroCompania,   setFiltroCompania]   = useState('')
  const [filtroRamo,       setFiltroRamo]       = useState('')

  const [companias, setCompanias] = useState<Catalogo[]>([])
  const [ramos,     setRamos]     = useState<Catalogo[]>([])
  const [kpiActivo, setKpiActivo] = useState<string | null>(null)

  const [kpis, setKpis] = useState({ en7: 0, en15: 0, en30: 0, vencidas: 0, renovadas: 0 })

  // IDs de pólizas que ya tienen renovación (para filtro "vencidas sin renovar")
  const [idsConRenovacion, setIdsConRenovacion] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function cargar() {
      const { data: tipos } = await supabase.from('tipo_catalogo').select('id, codigo')
      if (!tipos) return
      const tipoComp = tipos.find((t: any) => t.codigo === 'COMPANIA')
      const tipoRamo = tipos.find((t: any) => t.codigo === 'RAMO')
      const [{ data: comps }, { data: rams }] = await Promise.all([
        tipoComp ? supabase.from('catalogos').select('id,nombre').eq('tipo_id', tipoComp.id).eq('activo', true).order('nombre') : Promise.resolve({ data: [] }),
        tipoRamo ? supabase.from('catalogos').select('id,nombre').eq('tipo_id', tipoRamo.id).eq('activo', true).order('nombre') : Promise.resolve({ data: [] }),
      ])
      setCompanias((comps ?? []) as Catalogo[])
      setRamos((rams ?? []) as Catalogo[])
    }
    cargar()
  }, [supabase])

  useEffect(() => {
    clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => { setBusquedaDebounce(busqueda); setPagina(0) }, 350)
  }, [busqueda])

  useEffect(() => {
    async function cargarKpis() {
      const idsPersonas = await obtenerIdsPersonas(supabase, usuario)
      const hoy = hoyAR()
      const d7  = new Date(); d7.setDate(d7.getDate() + 7)
      const d15 = new Date(); d15.setDate(d15.getDate() + 15)
      const d30 = new Date(); d30.setDate(d30.getDate() + 30)
      const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`

      // 1) IDs de pólizas que ya tienen renovación ACTIVA (para descontar de
      //    "vencidas sin renovar"). Solo cuentan las hijas en estado activo:
      //      - RENOVADA (latente esperando activarse)
      //      - VIGENTE  (renovación ya activada, reemplazó a la origen)
      //      - PROGRAMADA (rara pero posible)
      //    NO cuentan las hijas CANCELADA/ANULADA — esas renovaciones se
      //    cayeron y la póliza origen queda efectivamente vencida sin renovar.
      const { data: conRen } = await supabase
        .from('polizas')
        .select('poliza_origen_id')
        .not('poliza_origen_id', 'is', null)
        .in('estado', ['RENOVADA', 'VIGENTE', 'PROGRAMADA'])
      const idsRen = new Set<string>((conRen ?? []).map((r: any) => r.poliza_origen_id).filter(Boolean))
      setIdsConRenovacion(idsRen)

      let q7 = supabase.from('polizas').select('id', { count: 'exact', head: true }).eq('estado', 'VIGENTE').gte('fecha_fin', hoy).lte('fecha_fin', fmt(d7))
      let q15 = supabase.from('polizas').select('id', { count: 'exact', head: true }).eq('estado', 'VIGENTE').gt('fecha_fin', fmt(d7)).lte('fecha_fin', fmt(d15))
      let q30 = supabase.from('polizas').select('id', { count: 'exact', head: true }).eq('estado', 'VIGENTE').gt('fecha_fin', fmt(d15)).lte('fecha_fin', fmt(d30))
      // KPI "vencidas" cuenta ambos casos: NO_VIGENTE + VIGENTE con fecha_fin < hoy
      // (últimas se cuentan porque el cron aún no las movió). Ambos casos
      // excluyen las que YA tienen renovación activa.
      let qNVReal = supabase.from('polizas').select('id', { count: 'exact', head: true }).eq('estado', 'NO_VIGENTE')
      let qNVSinCron = supabase.from('polizas').select('id', { count: 'exact', head: true }).eq('estado', 'VIGENTE').lt('fecha_fin', hoy)
      // KPI "Renovadas" = renovaciones (hijas) creadas en los últimos 30 días,
      // en cualquier estado. Antes contaba solo RENOVADA (latentes) — cuando
      // el cron activaba la hija pasaba a VIGENTE y desaparecía del KPI.
      // Ahora cuenta el trabajo realizado en el período, independiente del
      // estado actual.
      const hace30 = new Date(); hace30.setDate(hace30.getDate() - 30)
      const hace30Iso = hace30.toISOString()
      let qRen = supabase.from('polizas').select('id', { count: 'exact', head: true })
        .not('poliza_origen_id', 'is', null)
        .gte('created_at', hace30Iso)

      // Excluir las que ya tienen renovación activa — aplica a TODOS los KPIs.
      // Antes solo se excluía en el KPI "vencidas". Ahora también en 7/15/30d
      // porque una póliza que vence en 5 días pero YA está renovada NO debería
      // aparecer como "por gestionar".
      const idsRenArr = Array.from(idsRen)
      if (idsRenArr.length > 0) {
        const filtroExcluir = `(${idsRenArr.join(',')})`
        q7 = q7.not('id', 'in', filtroExcluir)
        q15 = q15.not('id', 'in', filtroExcluir)
        q30 = q30.not('id', 'in', filtroExcluir)
        qNVReal = qNVReal.not('id', 'in', filtroExcluir)
        qNVSinCron = qNVSinCron.not('id', 'in', filtroExcluir)
      }

      q7 = filtrarPorPersonas(q7, idsPersonas, 'asegurado_id')
      q15 = filtrarPorPersonas(q15, idsPersonas, 'asegurado_id')
      q30 = filtrarPorPersonas(q30, idsPersonas, 'asegurado_id')
      qNVReal = filtrarPorPersonas(qNVReal, idsPersonas, 'asegurado_id')
      qNVSinCron = filtrarPorPersonas(qNVSinCron, idsPersonas, 'asegurado_id')
      qRen = filtrarPorPersonas(qRen, idsPersonas, 'asegurado_id')

      const [k7, k15, k30, kNVReal, kNVSinCron, kRen] = await Promise.all([q7, q15, q30, qNVReal, qNVSinCron, qRen])

      setKpis({
        en7: k7.count ?? 0,
        en15: k15.count ?? 0,
        en30: k30.count ?? 0,
        vencidas: (kNVReal.count ?? 0) + (kNVSinCron.count ?? 0),
        renovadas: kRen.count ?? 0,
      })
    }
    cargarKpis()
  }, [supabase, usuario])

  const cargarPolizas = useCallback(async () => {
    setCargando(true)
    setErrorCarga(null)
    const idsPersonas = await obtenerIdsPersonas(supabase, usuario)
    const hoy = hoyAR()
    const d30 = new Date(); d30.setDate(d30.getDate() + 30)
    const fmt30 = `${d30.getFullYear()}-${String(d30.getMonth()+1).padStart(2,'0')}-${String(d30.getDate()).padStart(2,'0')}`

    let personaIds: string[] = []
    if (busquedaDebounce) {
      const safeBusq = sanitizarBusquedaNormalizada(busquedaDebounce)
      const { data: pers } = await supabase
        .from('personas')
        .select('id')
        .or(`apellido_norm.ilike.%${safeBusq}%,nombre_norm.ilike.%${safeBusq}%,dni_cuil.ilike.%${safeBusq}%,razon_social_norm.ilike.%${safeBusq}%`)
      personaIds = (pers ?? []).map((p: any) => p.id)
    }

    let query = supabase
      .from('polizas')
      .select(`
        id, numero_poliza, fecha_inicio, fecha_fin, estado, poliza_origen_id,
        asegurado:personas!asegurado_id (id, apellido, nombre, razon_social, email, acepta_marketing, telefono, whatsapp),
        compania:catalogos!compania_id (id, nombre),
        ramo:catalogos!ramo_id (id, nombre),
        cobertura:catalogos!cobertura_id (id, nombre)
      `, { count: 'exact' })

    // Filtro base: solo renovaciones relevantes.
    // Todos los sub-filtros excluyen las pólizas que YA tienen renovación
    // activa (RENOVADA/VIGENTE/PROGRAMADA hija apuntando a ellas). Sin esta
    // exclusión, aparecen las viejas ya reemplazadas como si necesitaran
    // gestión.
    const idsRenArrGlobal = Array.from(idsConRenovacion)
    const excluirRenGlobal = idsRenArrGlobal.length > 0
      ? `(${idsRenArrGlobal.join(',')})`
      : null

    if (kpiActivo === 'en7') {
      const d7 = new Date(); d7.setDate(d7.getDate() + 7)
      const fmt7 = `${d7.getFullYear()}-${String(d7.getMonth()+1).padStart(2,'0')}-${String(d7.getDate()).padStart(2,'0')}`
      query = query.eq('estado', 'VIGENTE').gte('fecha_fin', hoy).lte('fecha_fin', fmt7)
      if (excluirRenGlobal) query = query.not('id', 'in', excluirRenGlobal)
    } else if (kpiActivo === 'en15') {
      const d7  = new Date(); d7.setDate(d7.getDate() + 7)
      const d15 = new Date(); d15.setDate(d15.getDate() + 15)
      const fmt7 = `${d7.getFullYear()}-${String(d7.getMonth()+1).padStart(2,'0')}-${String(d7.getDate()).padStart(2,'0')}`
      const fmt15 = `${d15.getFullYear()}-${String(d15.getMonth()+1).padStart(2,'0')}-${String(d15.getDate()).padStart(2,'0')}`
      query = query.eq('estado', 'VIGENTE').gt('fecha_fin', fmt7).lte('fecha_fin', fmt15)
      if (excluirRenGlobal) query = query.not('id', 'in', excluirRenGlobal)
    } else if (kpiActivo === 'en30') {
      const d15 = new Date(); d15.setDate(d15.getDate() + 15)
      const fmt15 = `${d15.getFullYear()}-${String(d15.getMonth()+1).padStart(2,'0')}-${String(d15.getDate()).padStart(2,'0')}`
      query = query.eq('estado', 'VIGENTE').gt('fecha_fin', fmt15).lte('fecha_fin', fmt30)
      if (excluirRenGlobal) query = query.not('id', 'in', excluirRenGlobal)
    } else if (kpiActivo === 'vencidas') {
      // Vencidas = NO_VIGENTE + VIGENTE con fecha_fin < hoy (cron aún no las movió).
      // Excluye las que ya tienen renovación activa (fueron reemplazadas).
      query = query.or(`estado.eq.NO_VIGENTE,and(estado.eq.VIGENTE,fecha_fin.lt.${hoy})`)
      if (excluirRenGlobal) query = query.not('id', 'in', excluirRenGlobal)
    } else if (kpiActivo === 'renovadas') {
      // Renovaciones (hijas) creadas en los últimos 30 días, cualquier estado.
      const hace30 = new Date(); hace30.setDate(hace30.getDate() - 30)
      query = query.not('poliza_origen_id', 'is', null).gte('created_at', hace30.toISOString())
    } else {
      // Default: vencidas + próximas a vencer (30 días) + RENOVADAs latentes.
      // Se INCLUYEN las vencidas al tope de la lista para que el PAS las vea
      // sin tener que hacer click en el KPI. El sort ascendente por fecha_fin
      // hace que las más viejas (más urgentes) aparezcan primero.
      query = query.or(
        `and(estado.eq.VIGENTE,fecha_fin.gte.${hoy},fecha_fin.lte.${fmt30}),` +
        `estado.eq.NO_VIGENTE,` +
        `and(estado.eq.VIGENTE,fecha_fin.lt.${hoy}),` +
        `estado.eq.RENOVADA`
      )
      // Excluir las pólizas que ya tienen renovación activa — se ven a través
      // de la hija, no de la vieja.
      if (excluirRenGlobal) query = query.not('id', 'in', excluirRenGlobal)
    }

    query = filtrarPorPersonas(query, idsPersonas, 'asegurado_id')

    if (filtroCompania) query = query.eq('compania_id', filtroCompania)
    if (filtroRamo)     query = query.eq('ramo_id', filtroRamo)

    if (busquedaDebounce) {
      const safeBusq = busquedaDebounce.replace(/[,()]/g, ' ')
      if (personaIds.length > 0) {
        query = query.or(`numero_poliza.ilike.%${safeBusq}%,asegurado_id.in.(${personaIds.join(',')})`)
      } else {
        query = query.ilike('numero_poliza', `%${safeBusq}%`)
      }
    }

    query = query
      .order('fecha_fin', { ascending: true })
      .range(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA - 1)

    const { data, count, error } = await query
    if (error) {
      setErrorCarga({ mensaje: error.message ?? 'No se pudieron cargar las renovaciones.' })
    } else if (data) {
      setPolizas(data as unknown as Poliza[])
      setTotal(count ?? 0)
    }
    setCargando(false)
  }, [supabase, usuario, kpiActivo, filtroCompania, filtroRamo, busquedaDebounce, pagina, idsConRenovacion])

  useEffect(() => { cargarPolizas() }, [cargarPolizas])

  // Realtime: cualquier alta/renovación/baja/edición de póliza refresca el listado
  // para que no dependa de F5. Filosofía general del sistema: cambios se ven en el acto.
  useRealtimeRefresh({ tablas: ['polizas'], onCambio: cargarPolizas })

  useEffect(() => {
    apiCall<{ activo: boolean }>('/api/comunicaciones/estado', {}, { mostrar_toast_en_error: false })
      .then(r => { if (r.ok && r.data) setComunicacionesActivo(Boolean((r.data as any).activo)) })
  }, [])

  const toggleSeleccion = (id: string) => {
    setSeleccionados(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const seleccionarPagina = () => {
    const ids = polizas.map(p => p.id)
    const todos = ids.every(id => seleccionados.has(id))
    if (todos) {
      setSeleccionados(prev => { const next = new Set(prev); ids.forEach(id => next.delete(id)); return next })
    } else {
      setSeleccionados(prev => { const next = new Set(prev); ids.forEach(id => next.add(id)); return next })
    }
  }

  const todosEnPaginaSeleccionados = polizas.length > 0 && polizas.every(p => seleccionados.has(p.id))

  const personasParaMasivo = (() => {
    const mapa = new Map<string, { id: string; nombre: string; apellido: string; email: string | null; acepta_marketing: boolean }>()
    polizas.filter(p => seleccionados.has(p.id)).forEach(p => {
      if (p.asegurado && !mapa.has(p.asegurado.id)) {
        mapa.set(p.asegurado.id, {
          id: p.asegurado.id,
          nombre: p.asegurado.nombre || '',
          apellido: p.asegurado.apellido,
          email: p.asegurado.email || null,
          acepta_marketing: p.asegurado.acepta_marketing ?? true,
        })
      }
    })
    return Array.from(mapa.values())
  })()

  const limpiarFiltros = () => { setBusqueda(''); setFiltroCompania(''); setFiltroRamo(''); setKpiActivo(null); setPagina(0) }
  const hayFiltros = busqueda || filtroCompania || filtroRamo || kpiActivo

  const toggleKpi = (key: string) => {
    if (kpiActivo === key) { setKpiActivo(null) } else { setKpiActivo(key) }
    setPagina(0)
  }

  return (
    <div className="flex flex-col gap-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Renovaciones</h1>
          <p className="text-xs text-slate-500">{total.toLocaleString('es-AR')} pólizas en gestión</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-5 gap-2">
        <div className={`kpi-card bg-red-50 border border-red-200 cursor-pointer hover:opacity-80 transition-all ${kpiActivo === 'en7' ? 'ring-2 ring-red-400' : ''}`}
          onClick={() => toggleKpi('en7')}>
          <span className="kpi-label flex items-center gap-1">
            <AlertOctagon className="h-3.5 w-3.5 text-red-600" /> Vencen en 7d
          </span>
          <span className="kpi-value text-red-700">{kpis.en7.toLocaleString('es-AR')}</span>
          <span className="kpi-sub">acción urgente</span>
        </div>
        <div className={`kpi-card bg-orange-50 border border-orange-200 cursor-pointer hover:opacity-80 transition-all ${kpiActivo === 'en15' ? 'ring-2 ring-orange-400' : ''}`}
          onClick={() => toggleKpi('en15')}>
          <span className="kpi-label flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5 text-orange-600" /> Vencen en 15d
          </span>
          <span className="kpi-value text-orange-700">{kpis.en15.toLocaleString('es-AR')}</span>
          <span className="kpi-sub">entre 8 y 15 días</span>
        </div>
        <div className={`kpi-card bg-amber-50 border border-amber-200 cursor-pointer hover:opacity-80 transition-all ${kpiActivo === 'en30' ? 'ring-2 ring-amber-400' : ''}`}
          onClick={() => toggleKpi('en30')}>
          <span className="kpi-label flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-amber-600" /> Vencen en 30d
          </span>
          <span className="kpi-value text-amber-700">{kpis.en30.toLocaleString('es-AR')}</span>
          <span className="kpi-sub">entre 16 y 30 días</span>
        </div>
        <div className={`kpi-card bg-slate-50 border border-slate-200 cursor-pointer hover:opacity-80 transition-all ${kpiActivo === 'vencidas' ? 'ring-2 ring-slate-400' : ''}`}
          onClick={() => toggleKpi('vencidas')}>
          <span className="kpi-label flex items-center gap-1">
            <Timer className="h-3.5 w-3.5 text-slate-500" /> Vencidas
          </span>
          <span className="kpi-value text-slate-700">{kpis.vencidas.toLocaleString('es-AR')}</span>
          <span className="kpi-sub">sin renovar</span>
        </div>
        <div className={`kpi-card bg-violet-50 border border-violet-200 cursor-pointer hover:opacity-80 transition-all ${kpiActivo === 'renovadas' ? 'ring-2 ring-violet-400' : ''}`}
          onClick={() => toggleKpi('renovadas')}>
          <span className="kpi-label flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-violet-600" /> Renovadas
          </span>
          <span className="kpi-value text-violet-700">{kpis.renovadas.toLocaleString('es-AR')}</span>
          <span className="kpi-sub">últimos 30 días</span>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-slate-200 rounded p-2 flex items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400"/>
          <input className="search-input w-full pl-6" placeholder="Buscar por nro. póliza, apellido o DNI..."
            value={busqueda} onChange={e => setBusqueda(e.target.value)}/>
        </div>
        <select className="form-input" value={filtroCompania} onChange={e => { setFiltroCompania(e.target.value); setPagina(0) }}>
          <option value="">Todas las compañías</option>
          {companias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select className="form-input" value={filtroRamo} onChange={e => { setFiltroRamo(e.target.value); setPagina(0) }}>
          <option value="">Todos los ramos</option>
          {ramos.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </select>
        {hayFiltros && (
          <button onClick={limpiarFiltros} className="btn-secondary flex items-center gap-1">
            <X className="h-3.5 w-3.5"/> Limpiar
          </button>
        )}
        <button onClick={cargarPolizas} className="btn-secondary h-7 w-7 p-0 flex items-center justify-center ml-auto" title="Actualizar">
          <RefreshCw className="h-3.5 w-3.5"/>
        </button>
      </div>

      {/* Barra de selección masiva */}
      {seleccionados.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded p-2 flex items-center gap-3">
          <span className="text-xs font-medium text-blue-800">
            {seleccionados.size} póliza{seleccionados.size !== 1 ? 's' : ''} seleccionada{seleccionados.size !== 1 ? 's' : ''}
            {personasParaMasivo.length !== seleccionados.size && ` (${personasParaMasivo.length} cliente${personasParaMasivo.length !== 1 ? 's' : ''} único${personasParaMasivo.length !== 1 ? 's' : ''})`}
          </span>
          {isAdmin && comunicacionesActivo && (
            <button onClick={() => setModalMasivo(true)} className="btn-primary text-xs px-3 py-1 flex items-center gap-1.5">
              <Send className="h-3.5 w-3.5" /> Enviar email
            </button>
          )}
          <button onClick={() => setSeleccionados(new Set())} className="btn-secondary text-xs px-2 py-1 ml-auto">
            <X className="h-3.5 w-3.5" /> Limpiar
          </button>
        </div>
      )}

      {/* Tabla */}
      <EstadoCarga
        loading={cargando}
        error={errorCarga}
        empty={!cargando && !errorCarga && polizas.length === 0}
        emptyMensaje={hayFiltros ? 'No hay pólizas con esos filtros.' : 'No hay pólizas pendientes de renovación.'}
        onReintentar={cargarPolizas}
      >
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <table className="crm-table">
          <thead>
            <tr>
              {isAdmin && comunicacionesActivo && (
                <th style={{ width: 32 }}>
                  <input type="checkbox" checked={todosEnPaginaSeleccionados} onChange={seleccionarPagina}
                    className="rounded border-slate-300 text-blue-600" />
                </th>
              )}
              <th>Cliente</th>
              <th>Nro. Póliza</th>
              <th>Compañía</th>
              <th>Ramo</th>
              <th>Cobertura</th>
              <th>Vence el</th>
              <th>Días</th>
              <th>Estado</th>
              <th style={{ width: 100 }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {polizas.map(p => {
              const dias = diasHastaVencimiento(p.fecha_fin)
              const esRenovada = p.estado === 'RENOVADA'
              const yaTieneRenovacion = idsConRenovacion.has(p.id)
              const estadoEfectivo = getEstadoEfectivoPoliza(p.estado, p.fecha_fin, yaTieneRenovacion)
              const esVencida = estadoEfectivo === 'VENCIDA'
              // NO_VIGENTE con renovación → histórica, se atenúa. Vencida NO
              // se atenúa (necesita gestión).
              const opaca = p.estado === 'NO_VIGENTE' && yaTieneRenovacion

              return (
                <tr key={p.id}
                  className={`cursor-pointer ${opaca ? 'opacity-55' : ''}`}
                  onClick={() => router.push(`/crm/polizas/${p.id}`)}>
                  {isAdmin && comunicacionesActivo && (
                    <td onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={seleccionados.has(p.id)} onChange={() => toggleSeleccion(p.id)}
                        className="rounded border-slate-300 text-blue-600" />
                    </td>
                  )}
                  <td onClick={e => e.stopPropagation()}>
                    <button onClick={() => router.push(`/crm/personas/${p.asegurado?.id}`)}
                      className="text-blue-600 hover:underline text-xs font-medium text-left">
                      {nombreAsegurado(p)}
                    </button>
                  </td>
                  <td>
                    <span className="font-mono text-xs font-semibold text-slate-800">
                      {p.numero_poliza}
                    </span>
                  </td>
                  <td className="text-xs text-slate-600">{p.compania?.nombre ?? '—'}</td>
                  <td className="text-xs text-slate-600">{p.ramo?.nombre ?? '—'}</td>
                  <td className="text-xs text-slate-600">{p.cobertura?.nombre ?? '—'}</td>
                  <td className="text-xs text-slate-600 whitespace-nowrap">{formatFechaLocal(p.fecha_fin)}</td>
                  <td className={`text-xs font-mono whitespace-nowrap ${diasColor(dias, p.estado)}`}>
                    {esRenovada ? (
                      <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${getPolizaBadgeColor('RENOVADA')}`}>Renovada</span>
                    ) : esVencida ? (
                      // Póliza ya vencida — los días son irrelevantes, mostramos "—"
                      <span className="text-slate-400">—</span>
                    ) : (
                      // Póliza VIGENTE con fecha futura — mostramos días positivos
                      `${dias}d`
                    )}
                  </td>
                  <td>
                    <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${getPolizaBadgeColor(estadoEfectivo)}`}>
                      {estadoEfectivo === 'VENCIDA' ? 'Vencida' : getLabelEstado(p.estado)}
                    </span>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-0.5">
                      {!esRenovada && !yaTieneRenovacion && (
                        <button onClick={() => router.push(`/crm/renovaciones/${p.id}`)}
                          className="btn-tabla-accion-violet" title="Renovar">
                          <RefreshCw />
                        </button>
                      )}
                      <button onClick={() => router.push(`/crm/polizas/${p.id}`)}
                        className="btn-tabla-accion" title="Ver póliza">
                        <Eye />
                      </button>
                      <button onClick={async () => {
                          const url = await construirUrlWhatsapp('recordatorio_renovacion',
                            p.asegurado?.whatsapp ?? p.asegurado?.telefono ?? '',
                            {
                              nombre: p.asegurado?.nombre || nombreAsegurado(p),
                              numero_poliza: p.numero_poliza,
                              fecha_fin: formatFechaLocal(p.fecha_fin),
                              compania: p.compania?.nombre ?? '',
                            })
                          window.open(url, '_blank')
                        }}
                        className="btn-tabla-accion-whatsapp" title="WhatsApp">
                        <MessageCircle />
                      </button>
                    </div>
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
        <div className="flex items-center justify-between text-xs text-slate-500 pb-2">
          <span>Mostrando {pagina * POR_PAGINA + 1}–{Math.min((pagina + 1) * POR_PAGINA, total)} de {total.toLocaleString('es-AR')}</span>
          <div className="flex gap-1">
            <button onClick={() => setPagina(p => Math.max(0, p - 1))} disabled={pagina === 0} className="btn-secondary px-3">← Anterior</button>
            <button onClick={() => setPagina(p => Math.min(Math.ceil(total/POR_PAGINA) - 1, p + 1))} disabled={pagina >= Math.ceil(total/POR_PAGINA) - 1} className="btn-secondary px-3">Siguiente →</button>
          </div>
        </div>
      )}

      {/* Modal envío masivo */}
      <ModalEnviarEmailMasivo
        isOpen={modalMasivo}
        onClose={() => setModalMasivo(false)}
        personas={personasParaMasivo}
        contexto="POLIZA"
        onSuccess={() => setSeleccionados(new Set())}
      />
    </div>
  )
}
