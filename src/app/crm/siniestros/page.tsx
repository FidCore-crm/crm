'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Plus, Search, RefreshCw, ChevronUp, ChevronDown, X,
  Car, Home, Heart, Package, Eye, MessageCircle, Trash2, AlertTriangle
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { obtenerIdsPersonas, filtrarPorPersonas } from '@/lib/cartera-filter'
import { ESTADOS_SINIESTRO, getEstadoBadge, getBienAfectado } from '@/lib/siniestros-config'
import { formatFechaLocal, formatMoneda, getTooltipEstado, sanitizarBusquedaNormalizada } from '@/lib/utils'
import { construirUrlWhatsapp } from '@/lib/whatsapp-templates'
import { EstadoCarga } from '@/components/EstadoCarga'
import { useEsSoloLectura } from '@/contexts/LicenciaContext'

// ── Tipos ────────────────────────────────────────────────────
interface Siniestro {
  id: string
  numero_caso: string
  numero_siniestro: string | null
  fecha_denuncia: string
  tipo_siniestro: string
  estado: string
  monto_estimado: number | null
  descripcion: string | null
  origen_creacion: 'MANUAL_PAS' | 'PORTAL_CLIENTE'
  revisado_por_pas: boolean
  asegurado: { id: string; apellido: string; nombre: string; razon_social: string | null; telefono: string | null; whatsapp: string | null }
  poliza: {
    id: string
    numero_poliza: string
    ramo: { nombre: string; metadata: Record<string, any> | null } | null
    riesgos: { tipo_riesgo: string; detalle_tecnico: Record<string, any> }[]
  }
}

function iconoRamo(metadata: Record<string, any> | null) {
  const tipo = metadata?.tipo_riesgo ?? ''
  if (tipo === 'automotor') return <Car   className="h-3 w-3 text-blue-500" />
  if (tipo === 'hogar')     return <Home  className="h-3 w-3 text-amber-500" />
  if (tipo === 'vida')      return <Heart className="h-3 w-3 text-rose-500" />
  return <Package className="h-3 w-3 text-slate-400" />
}

function nombrePersona(s: Siniestro) {
  return [s.asegurado?.apellido, s.asegurado?.nombre].filter(Boolean).join(', ') || s.asegurado?.razon_social || '—'
}

const formatPeso = (n: number | null | undefined) => formatMoneda(n)

// ── Página ───────────────────────────────────────────────────
export default function SiniestrosPage() {
  const router   = useRouter()
  const searchParams = useSearchParams()
  const supabase = getSupabaseClient()
  const { usuario } = useAuth()
  const searchRef = useRef<NodeJS.Timeout>()
  const soloLectura = useEsSoloLectura()

  const [siniestros,  setSiniestros]  = useState<Siniestro[]>([])
  const [cargando,    setCargando]    = useState(true)
  const [errorCarga,  setErrorCarga]  = useState<{ codigo?: string; mensaje: string } | null>(null)
  const [total,       setTotal]       = useState(0)
  const [pagina,      setPagina]      = useState(0)
  const POR_PAGINA = 25

  const [busqueda,         setBusqueda]         = useState('')
  const [busquedaDebounce, setBusquedaDebounce] = useState('')
  const [filtroEstado,     setFiltroEstado]     = useState('')
  const [filtroPeriodo,    setFiltroPeriodo]    = useState<'TODOS' | '7' | '30' | '90' | '365'>('TODOS')
  const [sortDir,          setSortDir]          = useState<'asc'|'desc'>('desc')

  const cargaAbortRef = useRef<AbortController | null>(null)

  const [kpis, setKpis] = useState({ abiertos: 0, enProceso: 0, finalizados: 0, rechazados: 0, denunciasPendientes: 0 })
  const [kpiActivo, setKpiActivo] = useState<string | null>(null)
  const [enPapelera, setEnPapelera] = useState(0)
  const [filtroDenunciasPendientes, setFiltroDenunciasPendientes] = useState(false)

  // ── KPIs ───────────────────────────────────────────────
  const cargarKpis = useCallback(async () => {
    const idsPersonas = await obtenerIdsPersonas(supabase, usuario)
    let qAb = supabase.from('siniestros').select('id', { count: 'exact', head: true }).eq('estado', 'DENUNCIADO').is('deleted_at', null)
    let qEp = supabase.from('siniestros').select('id', { count: 'exact', head: true }).in('estado', ['EN_TRAMITE', 'INSPECCION', 'LIQUIDACION', 'REPARACION']).is('deleted_at', null)
    let qFi = supabase.from('siniestros').select('id', { count: 'exact', head: true }).eq('estado', 'FINALIZADO').is('deleted_at', null)
    let qRe = supabase.from('siniestros').select('id', { count: 'exact', head: true }).eq('estado', 'RECHAZADO').is('deleted_at', null)
    let qPa = supabase.from('siniestros').select('id', { count: 'exact', head: true }).not('deleted_at', 'is', null)
    let qDp = supabase.from('siniestros').select('id', { count: 'exact', head: true }).eq('origen_creacion', 'PORTAL_CLIENTE').eq('revisado_por_pas', false).is('deleted_at', null)
    qAb = filtrarPorPersonas(qAb, idsPersonas, 'persona_id')
    qEp = filtrarPorPersonas(qEp, idsPersonas, 'persona_id')
    qFi = filtrarPorPersonas(qFi, idsPersonas, 'persona_id')
    qRe = filtrarPorPersonas(qRe, idsPersonas, 'persona_id')
    qPa = filtrarPorPersonas(qPa, idsPersonas, 'persona_id')
    qDp = filtrarPorPersonas(qDp, idsPersonas, 'persona_id')
    const [ab, ep, fi, re, pa, dp] = await Promise.all([qAb, qEp, qFi, qRe, qPa, qDp])
    setKpis({ abiertos: ab.count ?? 0, enProceso: ep.count ?? 0, finalizados: fi.count ?? 0, rechazados: re.count ?? 0, denunciasPendientes: dp.count ?? 0 })
    setEnPapelera(pa.count ?? 0)
  }, [supabase, usuario])

  useEffect(() => { cargarKpis() }, [cargarKpis])

  // Si entra con ?denuncias_pendientes=1, activar el filtro automáticamente
  useEffect(() => {
    if (searchParams.get('denuncias_pendientes') === '1') {
      setFiltroDenunciasPendientes(true)
      setKpiActivo('denuncias')
    }
  }, [searchParams])

  // ── Debounce ───────────────────────────────────────────
  useEffect(() => {
    clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => { setBusquedaDebounce(busqueda); setPagina(0) }, 350)
  }, [busqueda])

  // ── Cargar siniestros ──────────────────────────────────
  const cargar = useCallback(async () => {
    setCargando(true)
    setErrorCarga(null)

    cargaAbortRef.current?.abort()
    const controller = new AbortController()
    cargaAbortRef.current = controller

    const idsPersonas = await obtenerIdsPersonas(supabase, usuario)

    // Excluir personas en papelera (sus siniestros no deberían aparecer)
    const { data: personasActivas } = await supabase
      .from('personas')
      .select('id')
      .is('deleted_at', null)
    const idsPersonasActivas = new Set((personasActivas ?? []).map((p: any) => p.id))

    let personaIds: string[] = []
    if (busquedaDebounce) {
      const safeBusq = sanitizarBusquedaNormalizada(busquedaDebounce)
      const { data: pers } = await supabase
        .from('personas')
        .select('id')
        .is('deleted_at', null)
        .or(`apellido_norm.ilike.%${safeBusq}%,nombre_norm.ilike.%${safeBusq}%,dni_cuil.ilike.%${safeBusq}%,razon_social_norm.ilike.%${safeBusq}%`)
      personaIds = (pers ?? []).map((p: any) => p.id)
    }

    let query = supabase
      .from('siniestros')
      .select(`
        id, numero_caso, numero_siniestro, fecha_denuncia, tipo_siniestro,
        estado, monto_estimado, descripcion,
        origen_creacion, revisado_por_pas,
        asegurado:personas!persona_id (id, apellido, nombre, razon_social, telefono, whatsapp),
        poliza:polizas!poliza_id (
          id, numero_poliza,
          ramo:catalogos!ramo_id (nombre, metadata),
          riesgos (tipo_riesgo, detalle_tecnico)
        )
      `, { count: 'exact' })
      .is('deleted_at', null)
      .abortSignal(controller.signal)

    query = filtrarPorPersonas(query, idsPersonas, 'persona_id')

    if (filtroEstado) query = query.eq('estado', filtroEstado)
    if (filtroDenunciasPendientes) {
      query = query.eq('origen_creacion', 'PORTAL_CLIENTE').eq('revisado_por_pas', false)
    }

    // Filtro por período (días desde hoy)
    if (filtroPeriodo !== 'TODOS') {
      const dias = parseInt(filtroPeriodo, 10)
      const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      query = query.gte('fecha_denuncia', desde)
    }

    if (busquedaDebounce) {
      const safe = sanitizarBusquedaNormalizada(busquedaDebounce)
      if (personaIds.length > 0) {
        query = query.or(`numero_caso.ilike.%${safe}%,numero_siniestro.ilike.%${safe}%,persona_id.in.(${personaIds.join(',')})`)
      } else {
        query = query.or(`numero_caso.ilike.%${safe}%,numero_siniestro.ilike.%${safe}%`)
      }
    }

    query = query
      .order('created_at', { ascending: sortDir === 'asc' })
      .range(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA - 1)

    const { data, count, error } = await query
    if (controller.signal.aborted) return
    if (error) {
      const codigo = (error as any)?.code ?? ''
      if (codigo !== '20' && error.message !== 'AbortError') {
        setErrorCarga({ mensaje: error.message ?? 'No se pudieron cargar los siniestros.' })
      }
    } else if (data) {
      // Filtrar siniestros cuyo asegurado esté en papelera (defensivo).
      const filtrados = (data as unknown as Siniestro[]).filter(
        s => !s.asegurado?.id || idsPersonasActivas.has(s.asegurado.id),
      )
      setSiniestros(filtrados)
      setTotal(count ?? 0)
    }
    setCargando(false)
  }, [supabase, usuario, filtroEstado, filtroPeriodo, busquedaDebounce, pagina, sortDir, filtroDenunciasPendientes])

  useEffect(() => { cargar() }, [cargar])

  // Realtime: refrescar listado + KPIs cuando cualquier siniestro se crea/
  // edita/elimina (en otra pestaña, por API, etc.). Refs estables para no
  // re-suscribir ante cambios de filtros/paginación.
  const cargarRef = useRef(cargar)
  const cargarKpisRef = useRef(cargarKpis)
  useEffect(() => { cargarRef.current = cargar }, [cargar])
  useEffect(() => { cargarKpisRef.current = cargarKpis }, [cargarKpis])

  useEffect(() => {
    const refetchTimer = { current: null as ReturnType<typeof setTimeout> | null }
    const refrescar = () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current)
      refetchTimer.current = setTimeout(() => {
        cargarRef.current()
        cargarKpisRef.current()
      }, 300)
    }

    const canal = supabase
      .channel('listado-siniestros')
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'siniestros' },
        refrescar
      )
      .subscribe()

    const onFocus = () => {
      cargarRef.current()
      cargarKpisRef.current()
    }
    window.addEventListener('focus', onFocus)

    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current)
      window.removeEventListener('focus', onFocus)
      supabase.removeChannel(canal)
    }
  }, [supabase])

  const limpiar = () => { setBusqueda(''); setFiltroEstado(''); setFiltroPeriodo('TODOS'); setKpiActivo(null); setFiltroDenunciasPendientes(false); setPagina(0) }
  const hayFiltros = busqueda || filtroEstado || filtroPeriodo !== 'TODOS' || filtroDenunciasPendientes

  // Scroll-to-top al cambiar de página
  const primeraCargaRef = useRef(true)
  useEffect(() => {
    if (primeraCargaRef.current) { primeraCargaRef.current = false; return }
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [pagina])

  return (
    <div className="flex flex-col gap-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Siniestros</h1>
          <p className="text-xs text-slate-500">{total.toLocaleString('es-AR')} siniestros en total</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push('/crm/siniestros/papelera')}
            className="btn-secondary relative"
            title="Ver siniestros en la papelera"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Papelera
            {enPapelera > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-4 px-1 text-2xs font-medium rounded-full bg-amber-100 text-amber-700 border border-amber-300">
                {enPapelera}
              </span>
            )}
          </button>
          {!soloLectura && (
            <button onClick={() => router.push('/crm/siniestros/nuevo')} className="btn-primary">
              <Plus className="h-3.5 w-3.5" /> Nuevo Siniestro
            </button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className={`grid gap-2 ${kpis.denunciasPendientes > 0 ? 'grid-cols-5' : 'grid-cols-4'}`}>
        {kpis.denunciasPendientes > 0 && (
          <div className={`kpi-card bg-red-50 border-2 border-red-300 cursor-pointer hover:opacity-80 transition-all ${kpiActivo === 'denuncias' ? 'ring-2 ring-red-500' : ''}`}
            onClick={() => {
              if (kpiActivo === 'denuncias') { setKpiActivo(null); setFiltroDenunciasPendientes(false) }
              else { setKpiActivo('denuncias'); setFiltroDenunciasPendientes(true); setFiltroEstado('') }
              setPagina(0)
            }}>
            <span className="kpi-label flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-red-600 animate-pulse" />
              <span className="text-red-700 font-semibold">Sin revisar</span>
            </span>
            <span className="kpi-value text-red-700">{kpis.denunciasPendientes.toLocaleString('es-AR')}</span>
            <span className="kpi-sub text-red-600">denuncias del portal</span>
          </div>
        )}
        <div className={`kpi-card bg-blue-50 border border-blue-200 cursor-pointer hover:opacity-80 transition-all ${kpiActivo === 'abiertos' ? 'ring-2 ring-blue-400' : ''}`}
          onClick={() => { if (kpiActivo === 'abiertos') { setKpiActivo(null); setFiltroEstado('') } else { setKpiActivo('abiertos'); setFiltroEstado('DENUNCIADO') } setPagina(0) }}>
          <span className="kpi-label flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-blue-500 inline-block" /> Abiertos
          </span>
          <span className="kpi-value text-blue-700">{kpis.abiertos.toLocaleString('es-AR')}</span>
          <span className="kpi-sub">recién denunciados</span>
        </div>
        <div className={`kpi-card bg-amber-50 border border-amber-200 cursor-pointer hover:opacity-80 transition-all ${kpiActivo === 'enTramite' ? 'ring-2 ring-amber-400' : ''}`}
          onClick={() => { setKpiActivo('enTramite'); setFiltroEstado('INSPECCION'); setPagina(0) }}
          title="Hacé clic para ver INSPECCION. Cambiá a LIQUIDACION o REPARACION desde el filtro de estado."
        >
          <span className="kpi-label flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-amber-500 inline-block" /> En trámite
          </span>
          <span className="kpi-value text-amber-700">{kpis.enProceso.toLocaleString('es-AR')}</span>
          <span className="kpi-sub">inspección · liquidación · reparación</span>
        </div>
        <div className={`kpi-card bg-emerald-50 border border-emerald-200 cursor-pointer hover:opacity-80 transition-all ${kpiActivo === 'finalizados' ? 'ring-2 ring-emerald-400' : ''}`}
          onClick={() => { if (kpiActivo === 'finalizados') { setKpiActivo(null); setFiltroEstado('') } else { setKpiActivo('finalizados'); setFiltroEstado('FINALIZADO') } setPagina(0) }}>
          <span className="kpi-label flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" /> Finalizados
          </span>
          <span className="kpi-value text-emerald-700">{kpis.finalizados.toLocaleString('es-AR')}</span>
          <span className="kpi-sub">resueltos</span>
        </div>
        <div className={`kpi-card bg-red-50 border border-red-200 cursor-pointer hover:opacity-80 transition-all ${kpiActivo === 'rechazados' ? 'ring-2 ring-red-400' : ''}`}
          onClick={() => { if (kpiActivo === 'rechazados') { setKpiActivo(null); setFiltroEstado('') } else { setKpiActivo('rechazados'); setFiltroEstado('RECHAZADO') } setPagina(0) }}>
          <span className="kpi-label flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-red-500 inline-block" /> Rechazados
          </span>
          <span className="kpi-value text-red-700">{kpis.rechazados.toLocaleString('es-AR')}</span>
          <span className="kpi-sub">por la compañía</span>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-slate-200 rounded p-2 flex items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input className="search-input w-full pl-6" placeholder="Buscar por nro. siniestro, apellido o DNI..."
            value={busqueda} onChange={e => setBusqueda(e.target.value)} />
        </div>
        <select className="form-input" value={filtroEstado} onChange={e => { setFiltroEstado(e.target.value); setKpiActivo(null); setPagina(0) }} aria-label="Filtrar por estado">
          <option value="">Todos los estados</option>
          {ESTADOS_SINIESTRO.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
        </select>
        <select
          className="form-input"
          value={filtroPeriodo}
          onChange={e => { setFiltroPeriodo(e.target.value as any); setPagina(0) }}
          aria-label="Filtrar por período"
        >
          <option value="TODOS">Todo el historial</option>
          <option value="7">Últimos 7 días</option>
          <option value="30">Últimos 30 días</option>
          <option value="90">Últimos 90 días</option>
          <option value="365">Último año</option>
        </select>
        {hayFiltros && (
          <button onClick={limpiar} className="btn-secondary flex items-center gap-1">
            <X className="h-3.5 w-3.5" /> Limpiar
          </button>
        )}
        <button onClick={cargar} className="btn-secondary h-7 w-7 p-0 flex items-center justify-center ml-auto" title="Actualizar">
          <RefreshCw className="h-3.5 w-3.5" /></button>
      </div>

      {/* Tabla */}
      <EstadoCarga
        loading={cargando}
        error={errorCarga}
        empty={!cargando && !errorCarga && siniestros.length === 0}
        emptyMensaje={hayFiltros ? 'No hay siniestros con esos filtros.' : 'No hay siniestros registrados todavía.'}
        onReintentar={cargar}
      >
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Caso</th>
              <th>Siniestro N°</th>
              <th>
                <div className="flex items-center gap-1 cursor-pointer" onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}>
                  Fecha {sortDir === 'asc' ? <ChevronUp className="h-3.5 w-3.5 text-blue-500"/> : <ChevronDown className="h-3.5 w-3.5 text-blue-500"/>}
                </div>
              </th>
              <th>Cliente</th>
              <th>Ramo</th>
              <th>Tipo</th>
              <th>Bien afectado</th>
              <th>Póliza</th>
              <th className="text-right">Monto est.</th>
              <th>Estado</th>
              <th style={{ width: 80 }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {siniestros.map(s => {
              const badge     = getEstadoBadge(s.estado)
              const riesgo    = s.poliza?.riesgos?.[0]
              const bienAfect = getBienAfectado(riesgo?.tipo_riesgo ?? '', riesgo?.detalle_tecnico ?? null)
              const ramometa  = s.poliza?.ramo as any

              return (
                <tr key={s.id}
                  className={`cursor-pointer ${s.origen_creacion === 'PORTAL_CLIENTE' && !s.revisado_por_pas ? 'bg-red-50' : ''}`}
                  onClick={() => router.push(`/crm/siniestros/${s.id}`)}>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-semibold text-slate-800">
                        {s.numero_caso}
                      </span>
                      {s.origen_creacion === 'PORTAL_CLIENTE' && !s.revisado_por_pas && (
                        <span
                          className="inline-flex items-center gap-0.5 text-2xs font-semibold px-1.5 py-0.5 rounded border bg-red-100 text-red-700 border-red-300"
                          title="Denuncia cargada por el cliente desde el portal — sin revisar"
                        >
                          <AlertTriangle className="h-2.5 w-2.5" />
                          Sin revisar
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="font-mono text-xs text-slate-500">{s.numero_siniestro ?? '—'}</td>
                  <td className="text-xs text-slate-600 whitespace-nowrap">{formatFechaLocal(s.fecha_denuncia)}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <button onClick={() => router.push(`/crm/personas/${s.asegurado?.id}`)}
                      className="text-blue-600 hover:underline text-xs font-medium text-left">
                      {nombrePersona(s)}
                    </button>
                  </td>
                  <td>
                    <div className="flex items-center gap-1 text-xs text-slate-600">
                      {iconoRamo(ramometa?.metadata ?? null)}
                      {ramometa?.nombre ?? '—'}
                    </div>
                  </td>
                  <td className="text-xs text-slate-600">{s.tipo_siniestro?.replace(/_/g, ' ') ?? '—'}</td>
                  <td className="font-mono text-xs text-slate-500">{bienAfect}</td>
                  <td>
                    <span className="font-mono text-xs text-slate-500">{s.poliza?.numero_poliza ?? '—'}</span>
                  </td>
                  <td className="text-xs text-right font-mono text-slate-700">
                    {s.monto_estimado ? formatPeso(s.monto_estimado) : '—'}
                  </td>
                  <td>
                    <span
                      className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${badge.color}`}
                      title={getTooltipEstado(s.estado) || undefined}
                    >
                      {badge.label}
                    </span>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => router.push(`/crm/siniestros/${s.id}`)}
                        className="btn-tabla-accion" title="Ver siniestro">
                        <Eye />
                      </button>
                      <button onClick={async () => {
                          const url = await construirUrlWhatsapp('info_siniestro',
                            s.asegurado?.whatsapp ?? s.asegurado?.telefono ?? '',
                            {
                              nombre: s.asegurado?.nombre || nombrePersona(s),
                              numero_caso: s.numero_caso,
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
            <button onClick={() => setPagina(p => p + 1)} disabled={pagina >= Math.ceil(total / POR_PAGINA) - 1} className="btn-secondary px-3">Siguiente →</button>
          </div>
        </div>
      )}

    </div>
  )
}
