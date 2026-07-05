'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Plus, Search, MessageCircle, AlertTriangle,
  RefreshCw, ChevronUp, ChevronDown, X, Eye, FolderOpen,
  CheckCircle, Clock, XCircle, CalendarCheck, Send, Download, Loader2
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { formatFecha, formatFechaLocal, hoyLocal, diasHastaVencimiento, getLabelEstado, getPolizaBadgeColor, getEstadoEfectivoPoliza, sanitizarBusquedaNormalizada } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { obtenerIdsPersonas, filtrarPorPersonas } from '@/lib/cartera-filter'
import ModalEnviarEmailMasivo from '@/components/ModalEnviarEmailMasivo'
import ModalArchivosPoliza from '@/components/ModalArchivosPoliza'
import { EstadoCarga } from '@/components/EstadoCarga'
import { construirUrlWhatsapp } from '@/lib/whatsapp-templates'
import { apiCall } from '@/lib/api-client'
import { useEsSoloLectura } from '@/contexts/LicenciaContext'
import AyudaTooltip from '@/components/AyudaTooltip'
import { describirBien } from '@/lib/tipos-riesgo'

interface Poliza {
  id: string
  numero_poliza: string
  fecha_inicio: string
  fecha_fin: string
  estado: string
  asegurado: { id: string; apellido: string; nombre: string; razon_social: string | null; email: string | null; acepta_marketing: boolean; telefono: string | null; whatsapp: string | null; usuario_id: string | null }
  compania: { id: string; nombre: string } | null
  ramo: { id: string; nombre: string } | null
  cobertura: { id: string; nombre: string } | null
  riesgos: { tipo_riesgo: string | null; detalle_tecnico: Record<string, any> }[]
}

interface Catalogo { id: string; nombre: string }
type SortField = 'numero_poliza' | 'fecha_fin'
type SortDir   = 'asc' | 'desc'

function estadoBadge(poliza: Poliza) {
  // Compensar el cron: si estado=VIGENTE pero fecha_fin ya pasó, mostramos
  // "Vencida" en rojo sin esperar a que el cron actualice el estado en DB.
  const estadoEfectivo = getEstadoEfectivoPoliza(poliza.estado, poliza.fecha_fin)
  if (estadoEfectivo === 'VENCIDA') {
    return { label: 'Vencida', color: getPolizaBadgeColor('VENCIDA') }
  }
  const dias = diasHastaVencimiento(poliza.fecha_fin)
  // Para VIGENTE que está por vencer, mostrar indicador de días
  if (poliza.estado === 'VIGENTE' && dias >= 0 && dias <= 30) {
    return { label: `Vence en ${dias}d`, color: 'bg-orange-50 text-orange-700 border-orange-200' }
  }
  return { label: getLabelEstado(poliza.estado), color: getPolizaBadgeColor(poliza.estado) }
}

function nombreAsegurado(p: Poliza) {
  return [p.asegurado?.apellido, p.asegurado?.nombre].filter(Boolean).join(', ') || p.asegurado?.razon_social || '—'
}

export default function PolizasPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20 text-slate-400 text-sm gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Cargando pólizas...</div>}>
      <PolizasContent />
    </Suspense>
  )
}

function PolizasContent() {
  const router    = useRouter()
  const searchParams = useSearchParams()
  const supabase  = getSupabaseClient()
  const soloLectura = useEsSoloLectura()
  const { usuario } = useAuth()
  const searchRef = useRef<NodeJS.Timeout>()

  const [polizas,   setPolizas]   = useState<Poliza[]>([])
  const [cargando,  setCargando]  = useState(true)
  const [errorCarga, setErrorCarga] = useState<{ codigo?: string; mensaje: string } | null>(null)
  const [total,     setTotal]     = useState(0)
  const [pagina,    setPagina]    = useState(0)
  const POR_PAGINA = 25

  // Selección masiva
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  const [modalMasivo, setModalMasivo] = useState(false)
  const [modalArchivos, setModalArchivos] = useState<{ id: string; numero: string } | null>(null)
  const [comunicacionesActivo, setComunicacionesActivo] = useState(false)
  const isAdmin = usuario?.rol === 'ADMIN'

  const [busqueda,         setBusqueda]         = useState('')
  const [busquedaDebounce, setBusquedaDebounce] = useState('')
  const [filtroCompania,   setFiltroCompania]   = useState('')
  const [filtroRamo,       setFiltroRamo]       = useState('')
  // Filtro por estado con default "ACTIVAS" (VIGENTE + PROGRAMADA + RENOVADA).
  // Las terminales (NO_VIGENTE, CANCELADA, ANULADA) quedan ocultas salvo que
  // el PAS elija "Todas" o un estado terminal específico.
  const [filtroEstado,     setFiltroEstado]     = useState<string>('ACTIVAS')
  const [filtroTemporal,   setFiltroTemporal]   = useState('')
  // Filtro "Asignado a" — solo admin. Las pólizas no tienen usuario_id
  // propio: la asignación vive en `asegurado.usuario_id`, así que para
  // filtrar usamos un sub-query sobre personas y después `.in('asegurado_id', ...)`.
  const [filtroAsignado, setFiltroAsignado] = useState<string | null>(null)
  const [usuariosLista, setUsuariosLista] = useState<Array<{ id: string; nombre: string; apellido: string }>>([])
  const usuariosMap = useCallback(() => {
    const m = new Map<string, string>()
    for (const u of usuariosLista) m.set(u.id, `${u.apellido}, ${u.nombre}`.trim().replace(/^,\s*/, ''))
    return m
  }, [usuariosLista])

  const [companias, setCompanias] = useState<Catalogo[]>([])
  const [ramos,     setRamos]     = useState<Catalogo[]>([])
  const [sortField, setSortField] = useState<SortField>('fecha_fin')
  const [sortDir,   setSortDir]   = useState<SortDir>('asc')
  const [kpis,      setKpis]      = useState({ vigentes: 0, porVencer: 0, noVigentes: 0, programadas: 0 })
  const [kpiActivo, setKpiActivo] = useState<string | null>(null)

  // Filtro por importación (query param ?importacion_id=...)
  const importacionId = searchParams.get('importacion_id')
  const [filtroImportacion, setFiltroImportacion] = useState<{ id: string; fecha: string; archivos: string[]; total: number } | null>(null)
  const [idsImportacion, setIdsImportacion] = useState<string[] | null>(null)
  const [errorImportacion, setErrorImportacion] = useState<string | null>(null)

  useEffect(() => {
    if (!importacionId) {
      setFiltroImportacion(null)
      setIdsImportacion(null)
      setErrorImportacion(null)
      return
    }
    let cancelado = false
    apiCall<{ importacion?: any }>(`/api/importar/${importacionId}/resumen`, {}, { mostrar_toast_en_error: false })
      .then((r) => {
        if (cancelado) return
        if (!r.ok) {
          setErrorImportacion(importacionId)
          setFiltroImportacion(null)
          setIdsImportacion([])
          return
        }
        const imp = (r.data as any)?.importacion ?? (r.data as any) ?? {}
        const creados: string[] = imp?.ids_creados?.polizas ?? []
        const actualizados: string[] = imp?.ids_actualizados?.polizas ?? []
        const ids = [...creados, ...actualizados]
        const archivos: string[] = Array.isArray(imp?.archivos_metadata)
          ? imp.archivos_metadata.map((a: any) => a?.nombre).filter(Boolean)
          : []
        setErrorImportacion(null)
        setFiltroImportacion({
          id: importacionId,
          fecha: imp?.fecha_fin ?? imp?.created_at ?? '',
          archivos,
          total: ids.length,
        })
        setIdsImportacion(ids)
        setPagina(0)
      })
    return () => { cancelado = true }
  }, [importacionId])

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

  const cargarKpis = useCallback(async () => {
    const idsPersonas = await obtenerIdsPersonas(supabase, usuario)
    const hoy     = hoyLocal()
    const en30    = new Date(); en30.setDate(en30.getDate() + 30)
    const en30str = `${en30.getFullYear()}-${String(en30.getMonth() + 1).padStart(2, '0')}-${String(en30.getDate()).padStart(2, '0')}`
    let qV = supabase.from('polizas').select('id', { count: 'exact', head: true }).eq('estado', 'VIGENTE')
    let qPV = supabase.from('polizas').select('id', { count: 'exact', head: true }).eq('estado', 'VIGENTE').lte('fecha_fin', en30str).gte('fecha_fin', hoy)
    let qNV = supabase.from('polizas').select('id', { count: 'exact', head: true }).eq('estado', 'NO_VIGENTE')
    let qProg = supabase.from('polizas').select('id', { count: 'exact', head: true }).in('estado', ['PROGRAMADA', 'RENOVADA'])
    qV = filtrarPorPersonas(qV, idsPersonas, 'asegurado_id')
    qPV = filtrarPorPersonas(qPV, idsPersonas, 'asegurado_id')
    qNV = filtrarPorPersonas(qNV, idsPersonas, 'asegurado_id')
    qProg = filtrarPorPersonas(qProg, idsPersonas, 'asegurado_id')
    const [v, pv, nv, prog] = await Promise.all([qV, qPV, qNV, qProg])
    setKpis({ vigentes: v.count ?? 0, porVencer: pv.count ?? 0, noVigentes: nv.count ?? 0, programadas: prog.count ?? 0 })
  }, [supabase, usuario])

  useEffect(() => { cargarKpis() }, [cargarKpis])

  // Cargar lista de usuarios para el filtro + columna "Asignado a" (admin-only).
  useEffect(() => {
    if (!isAdmin) return
    apiCall<{ usuarios: Array<{ id: string; nombre: string; apellido: string; activo: boolean }> }>(
      '/api/usuarios',
      {},
      { mostrar_toast_en_error: false },
    ).then(r => {
      if (r.ok && r.data) {
        const u = (r.data as any).usuarios ?? []
        setUsuariosLista(u.filter((x: any) => x.activo !== false))
      }
    })
  }, [isAdmin])

  const cargarPolizas = useCallback(async () => {
    // Si hay filtro por importación pero los IDs no se cargaron aún, esperar
    if (importacionId && idsImportacion === null) {
      return
    }

    setCargando(true)
    setErrorCarga(null)

    // Filtro por importación: array vacío => listado vacío
    if (idsImportacion !== null && idsImportacion.length === 0) {
      setPolizas([])
      setTotal(0)
      setCargando(false)
      return
    }

    const idsPersonas = await obtenerIdsPersonas(supabase, usuario)

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
        id, numero_poliza, fecha_inicio, fecha_fin, estado,
        asegurado:personas!asegurado_id (id, apellido, nombre, razon_social, email, acepta_marketing, telefono, whatsapp, usuario_id),
        compania:catalogos!compania_id (id, nombre),
        ramo:catalogos!ramo_id (id, nombre),
        cobertura:catalogos!cobertura_id (id, nombre),
        riesgos (tipo_riesgo, detalle_tecnico)
      `, { count: 'exact' })

    query = filtrarPorPersonas(query, idsPersonas, 'asegurado_id')

    // Filtro "Asignado a" (admin) — resuelvo a través de personas porque la
    // póliza no tiene usuario_id propio (la asignación vive en el asegurado).
    if (filtroAsignado) {
      let qPersonas = supabase.from('personas').select('id')
      if (filtroAsignado === 'SIN_ASIGNAR') qPersonas = qPersonas.is('usuario_id', null)
      else qPersonas = qPersonas.eq('usuario_id', filtroAsignado)
      const { data: personasFiltradas } = await qPersonas
      const ids = (personasFiltradas ?? []).map((p: any) => p.id)
      if (ids.length === 0) {
        setPolizas([]); setTotal(0); setCargando(false); return
      }
      query = query.in('asegurado_id', ids)
    }

    // Filtro por importación: limitar a los IDs importados
    if (idsImportacion !== null && idsImportacion.length > 0) {
      query = query.in('id', idsImportacion)
    }

    if (filtroCompania) query = query.eq('compania_id', filtroCompania)
    if (filtroRamo)     query = query.eq('ramo_id', filtroRamo)
    if (filtroEstado === 'ACTIVAS') {
      // Default: ocultamos las terminales para reducir ruido visual.
      query = query.in('estado', ['VIGENTE', 'PROGRAMADA', 'RENOVADA'])
    } else if (filtroEstado) {
      query = query.eq('estado', filtroEstado)
    }

    const hoy = hoyLocal()
    const fmtISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (filtroTemporal === 'hoy') {
      // Vencen hoy — solo VIGENTE con fecha_fin = hoy
      query = query.eq('estado', 'VIGENTE').eq('fecha_fin', hoy)
    } else if (filtroTemporal === 'semana') {
      // Esta semana — VIGENTE con fecha_fin entre hoy y hoy+7
      const fin = new Date(); fin.setDate(fin.getDate() + 7)
      query = query.eq('estado', 'VIGENTE').gte('fecha_fin', hoy).lte('fecha_fin', fmtISO(fin))
    } else if (filtroTemporal === 'mes') {
      // Este mes — VIGENTE con fecha_fin entre hoy y hoy+30
      const fin = new Date(); fin.setDate(fin.getDate() + 30)
      query = query.eq('estado', 'VIGENTE').gte('fecha_fin', hoy).lte('fecha_fin', fmtISO(fin))
    } else if (filtroTemporal === '10dias') {
      const fin = new Date(); fin.setDate(fin.getDate() + 10)
      query = query.eq('estado', 'VIGENTE').gte('fecha_fin', hoy).lte('fecha_fin', fmtISO(fin))
    } else if (filtroTemporal === 'recientes') {
      const desde = new Date(); desde.setDate(desde.getDate() - 30)
      query = query.gte('created_at', desde.toISOString())
    } else if (filtroTemporal === 'vencidas') {
      // Vencidas = NO_VIGENTE + VIGENTE con fecha pasada (cron aún no las movió).
      // Excluimos las que YA tienen renovación activa — el PAS no necesita ver
      // la vieja NO_VIGENTE si ya fue reemplazada por su renovación.
      const { data: conRen } = await supabase
        .from('polizas')
        .select('poliza_origen_id')
        .not('poliza_origen_id', 'is', null)
        .in('estado', ['RENOVADA', 'VIGENTE', 'PROGRAMADA'])
      const idsRenActiva = ((conRen ?? []) as Array<{ poliza_origen_id: string | null }>)
        .map(r => r.poliza_origen_id)
        .filter((x): x is string => !!x)
      query = query.or(`estado.eq.NO_VIGENTE,and(estado.eq.VIGENTE,fecha_fin.lt.${hoy})`)
      if (idsRenActiva.length > 0) {
        query = query.not('id', 'in', `(${idsRenActiva.join(',')})`)
      }
    } else if (filtroTemporal === 'programadas') {
      query = query.in('estado', ['PROGRAMADA', 'RENOVADA'])
    }

    if (busquedaDebounce) {
      const safeBusq = busquedaDebounce.replace(/[,()]/g, ' ')
      if (personaIds.length > 0) {
        query = query.or(`numero_poliza.ilike.%${safeBusq}%,asegurado_id.in.(${personaIds.join(',')})`)
      } else {
        query = query.ilike('numero_poliza', `%${safeBusq}%`)
      }
    }

    query = query
      .order(sortField, { ascending: sortDir === 'asc' })
      .range(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA - 1)

    const { data, count, error } = await query
    if (error) {
      setErrorCarga({ mensaje: error.message ?? 'No se pudieron cargar las pólizas.' })
    } else if (data) {
      setPolizas(data as unknown as Poliza[])
      setTotal(count ?? 0)
    }
    setCargando(false)
  }, [supabase, usuario, filtroCompania, filtroRamo, filtroEstado, filtroTemporal, busquedaDebounce, pagina, sortField, sortDir, idsImportacion, importacionId, filtroAsignado])

  useEffect(() => { cargarPolizas() }, [cargarPolizas])

  // Realtime: refrescar listado + KPIs cuando cualquier póliza se crea/edita/
  // elimina (en otra pestaña, por cron de transiciones de estado, por agente
  // PDF, importador, etc.). Refs estables para no re-suscribir ante cambios
  // de filtros/paginación.
  const cargarPolizasRef = useRef(cargarPolizas)
  const cargarKpisRef = useRef(cargarKpis)
  useEffect(() => { cargarPolizasRef.current = cargarPolizas }, [cargarPolizas])
  useEffect(() => { cargarKpisRef.current = cargarKpis }, [cargarKpis])

  useEffect(() => {
    const refetchTimer = { current: null as ReturnType<typeof setTimeout> | null }
    const refrescar = () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current)
      refetchTimer.current = setTimeout(() => {
        cargarPolizasRef.current()
        cargarKpisRef.current()
      }, 300)
    }

    const canal = supabase
      .channel('listado-polizas')
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'polizas' },
        refrescar
      )
      .subscribe()

    const onFocus = () => {
      cargarPolizasRef.current()
      cargarKpisRef.current()
    }
    window.addEventListener('focus', onFocus)

    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current)
      window.removeEventListener('focus', onFocus)
      supabase.removeChannel(canal)
    }
  }, [supabase])

  useEffect(() => {
    apiCall<{ activo: boolean }>('/api/comunicaciones/estado', {}, { mostrar_toast_en_error: false })
      .then(r => { if (r.ok && r.data) setComunicacionesActivo(Boolean((r.data as any).activo)) })
  }, [])

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

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

  // Deduplicar personas de pólizas seleccionadas
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

  const limpiarFiltros = () => { setBusqueda(''); setFiltroCompania(''); setFiltroRamo(''); setFiltroEstado('ACTIVAS'); setFiltroTemporal(''); setKpiActivo(null); setPagina(0) }
  // "ACTIVAS" es el default — no lo considero un filtro explícito del usuario.
  const hayFiltros = busqueda || filtroCompania || filtroRamo || (filtroEstado && filtroEstado !== 'ACTIVAS') || filtroTemporal

  const SortIcon = ({ field }: { field: SortField }) => (
    sortField === field
      ? sortDir === 'asc' ? <ChevronUp className="h-3.5 w-3.5 text-blue-500"/> : <ChevronDown className="h-3.5 w-3.5 text-blue-500"/>
      : <ChevronUp className="h-3.5 w-3.5 text-slate-300"/>
  )

  return (
    <div className="flex flex-col gap-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Pólizas</h1>
          <p className="text-xs text-slate-500">{total.toLocaleString('es-AR')} pólizas en total</p>
        </div>
        {!soloLectura && (
          <button onClick={() => router.push('/crm/polizas/nueva')} className="btn-primary">
            <Plus className="h-3.5 w-3.5"/> Nueva Póliza
          </button>
        )}
      </div>

      {/* Banner filtro por importación */}
      {filtroImportacion && (
        <div className="bg-amber-50 border border-amber-200 rounded p-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-amber-900">
            <Download className="h-4 w-4 text-amber-600" />
            <span>
              Mostrando <strong>{filtroImportacion.total}</strong> póliza{filtroImportacion.total !== 1 ? 's' : ''} importada{filtroImportacion.total !== 1 ? 's' : ''}
              {filtroImportacion.fecha && <> el {formatFecha(filtroImportacion.fecha)}</>}
              {filtroImportacion.archivos.length > 0 && (
                <span className="text-amber-700"> desde: {filtroImportacion.archivos.join(', ')}</span>
              )}
            </span>
          </div>
          <button
            onClick={() => router.push('/crm/polizas')}
            className="btn-secondary text-2xs flex items-center gap-1"
          >
            <X className="h-3.5 w-3.5" /> Quitar filtro
          </button>
        </div>
      )}
      {errorImportacion && !filtroImportacion && (
        <div className="bg-red-50 border border-red-200 rounded p-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-red-800">
            <X className="h-4 w-4 text-red-600" />
            <span>No se pudo cargar la importación <strong className="font-mono">{errorImportacion}</strong></span>
          </div>
          <button
            onClick={() => router.push('/crm/polizas')}
            className="btn-secondary text-2xs flex items-center gap-1"
          >
            <X className="h-3.5 w-3.5" /> Quitar filtro
          </button>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-2">
        <div className={`kpi-card bg-emerald-50 border border-emerald-200 cursor-pointer hover:opacity-80 transition-all ${kpiActivo === 'vigentes' ? 'ring-2 ring-emerald-400' : ''}`}
          onClick={() => { if (kpiActivo === 'vigentes') { setKpiActivo(null); setFiltroEstado('ACTIVAS'); setFiltroTemporal('') } else { setKpiActivo('vigentes'); setFiltroEstado('VIGENTE'); setFiltroTemporal('') } setPagina(0) }}>
          <span className="kpi-label flex items-center gap-1">
            <CheckCircle className="h-3.5 w-3.5 text-emerald-600"/> Vigentes
          </span>
          <span className="kpi-value text-emerald-700">{kpis.vigentes.toLocaleString('es-AR')}</span>
          <span className="kpi-sub">pólizas activas</span>
        </div>
        <div className={`kpi-card bg-amber-50 border border-amber-200 cursor-pointer hover:opacity-80 transition-all ${kpiActivo === 'porVencer' ? 'ring-2 ring-amber-400' : ''}`}
          onClick={() => { if (kpiActivo === 'porVencer') { setKpiActivo(null); setFiltroEstado('ACTIVAS'); setFiltroTemporal('') } else { setKpiActivo('porVencer'); setFiltroEstado('VIGENTE'); setFiltroTemporal('mes') } setPagina(0) }}>
          <span className="kpi-label flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-amber-600"/> Por vencer (30d)
          </span>
          <span className="kpi-value text-amber-700">{kpis.porVencer.toLocaleString('es-AR')}</span>
          <span className="kpi-sub">requieren renovación</span>
        </div>
        <div className={`kpi-card bg-slate-50 border border-slate-200 cursor-pointer hover:opacity-80 transition-all ${kpiActivo === 'noVigentes' ? 'ring-2 ring-slate-400' : ''}`}
          onClick={() => { if (kpiActivo === 'noVigentes') { setKpiActivo(null); setFiltroEstado('ACTIVAS'); setFiltroTemporal('') } else { setKpiActivo('noVigentes'); setFiltroEstado('NO_VIGENTE'); setFiltroTemporal('') } setPagina(0) }}>
          <span className="kpi-label flex items-center gap-1">
            <XCircle className="h-3.5 w-3.5 text-slate-500"/> No vigentes
          </span>
          <span className="kpi-value text-slate-700">{kpis.noVigentes.toLocaleString('es-AR')}</span>
          <span className="kpi-sub">vencidas sin renovar</span>
        </div>
        <div className={`kpi-card bg-blue-50 border border-blue-200 cursor-pointer hover:opacity-80 transition-all ${kpiActivo === 'programadas' ? 'ring-2 ring-blue-400' : ''}`}
          onClick={() => { if (kpiActivo === 'programadas') { setKpiActivo(null); setFiltroEstado('ACTIVAS'); setFiltroTemporal('') } else { setKpiActivo('programadas'); setFiltroEstado(''); setFiltroTemporal('programadas') } setPagina(0) }}>
          <span className="kpi-label flex items-center gap-1">
            <CalendarCheck className="h-3.5 w-3.5 text-blue-600"/> Programadas
          </span>
          <span className="kpi-value text-blue-700">{kpis.programadas.toLocaleString('es-AR')}</span>
          <span className="kpi-sub">programadas + renovadas</span>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-slate-200 rounded p-2 flex items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400"/>
          <input className="search-input w-full pl-6" placeholder="Buscar por nro. póliza, apellido o DNI..."
            value={busqueda} onChange={e => setBusqueda(e.target.value)}/>
        </div>
        <select className="form-input" value={filtroCompania} onChange={e => { setFiltroCompania(e.target.value); setKpiActivo(null); setPagina(0) }}>
          <option value="">Todas las compañías</option>
          {companias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select className="form-input" value={filtroRamo} onChange={e => { setFiltroRamo(e.target.value); setKpiActivo(null); setPagina(0) }}>
          <option value="">Todos los ramos</option>
          {ramos.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </select>
        <select className="form-input" value={filtroEstado} onChange={e => { setFiltroEstado(e.target.value); setKpiActivo(null); setPagina(0) }}>
          <option value="ACTIVAS">Activas (VIGENTE + PROGRAMADA + RENOVADA)</option>
          <option value="">Todas (incluye histórico)</option>
          <option value="VIGENTE">Vigente</option>
          <option value="PROGRAMADA">Programada</option>
          <option value="RENOVADA">Renovada</option>
          <option value="NO_VIGENTE">Vencida</option>
          <option value="CANCELADA">Cancelada</option>
          <option value="ANULADA">Anulada</option>
        </select>
        <select className="form-input" value={filtroTemporal} onChange={e => { setFiltroTemporal(e.target.value); setKpiActivo(null); setPagina(0) }}>
          <option value="">Todos los períodos</option>
          <option value="hoy">Vencen hoy</option>
          <option value="semana">Vencen esta semana (7d)</option>
          <option value="10dias">Vencen en 10 días</option>
          <option value="mes">Vencen este mes (30d)</option>
          <option value="vencidas">Vencidas</option>
          <option value="programadas">Programadas / Renovadas</option>
          <option value="recientes">Creadas este mes</option>
        </select>
        {isAdmin && usuariosLista.length > 1 && (
          <select
            className="form-input"
            value={filtroAsignado ?? ''}
            onChange={e => { setFiltroAsignado(e.target.value || null); setPagina(0) }}
            title="Filtrar por usuario asignado al cliente"
          >
            <option value="">Todos los asignados</option>
            <option value="SIN_ASIGNAR">Sin asignar</option>
            {usuariosLista.map(u => (
              <option key={u.id} value={u.id}>{`${u.apellido}, ${u.nombre}`.replace(/^,\s*/, '')}</option>
            ))}
          </select>
        )}
        {hayFiltros && (
          <button onClick={limpiarFiltros} className="btn-secondary flex items-center gap-1">
            <X className="h-3.5 w-3.5"/> Limpiar
          </button>
        )}
        <button onClick={() => { cargarPolizas(); cargarKpis() }} className="btn-secondary h-7 w-7 p-0 flex items-center justify-center ml-auto" title="Actualizar">
          <RefreshCw className="h-3.5 w-3.5"/>
        </button>
      </div>

      {/* Chips rápidos de filtro temporal — accesos visibles a los casos
          que el PAS usa a diario. Complementan los selects de arriba. */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-2xs text-slate-500 font-medium uppercase tracking-wide">Ver:</span>
        {[
          { valor: '', label: 'Todas', color: 'bg-slate-50 border-slate-200 text-slate-700' },
          { valor: 'hoy', label: 'Vencen hoy', color: 'bg-red-50 border-red-200 text-red-700' },
          { valor: 'semana', label: 'Esta semana', color: 'bg-orange-50 border-orange-200 text-orange-700' },
          { valor: 'mes', label: 'Este mes', color: 'bg-amber-50 border-amber-200 text-amber-700' },
          { valor: 'vencidas', label: 'Vencidas', color: 'bg-red-100 border-red-300 text-red-800' },
          { valor: 'programadas', label: 'Programadas / Renovadas', color: 'bg-blue-50 border-blue-200 text-blue-700' },
        ].map(chip => (
          <button
            key={chip.valor}
            onClick={() => { setFiltroTemporal(chip.valor); setKpiActivo(null); setPagina(0) }}
            className={`text-xs px-2.5 py-1 rounded border transition-all ${
              filtroTemporal === chip.valor
                ? `${chip.color} font-semibold ring-2 ring-offset-1 ring-slate-300`
                : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            {chip.label}
          </button>
        ))}
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
            <X className="h-3.5 w-3.5" /> Limpiar selección
          </button>
        </div>
      )}

      {/* Tabla */}
      <EstadoCarga
        loading={cargando}
        error={errorCarga}
        empty={!cargando && !errorCarga && polizas.length === 0}
        emptyMensaje={hayFiltros ? 'No hay pólizas con esos filtros.' : 'No hay pólizas cargadas todavía.'}
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
              <th onClick={() => toggleSort('numero_poliza')} className="cursor-pointer select-none">
                <div className="flex items-center gap-1">Nro. Póliza <SortIcon field="numero_poliza"/></div>
              </th>
              <th>Cliente</th>
              <th>Compañía</th>
              <th>Ramo</th>
              <th>Cobertura</th>
              <th>Bien asegurado</th>
              <th onClick={() => toggleSort('fecha_fin')} className="cursor-pointer select-none">
                <div className="flex items-center gap-1">Vigencia <SortIcon field="fecha_fin"/></div>
              </th>
              <th>
                <span className="inline-flex items-center gap-1">
                  Estado
                  <AyudaTooltip clave="polizas.estado" inline />
                </span>
              </th>
              {isAdmin && usuariosLista.length > 1 && (
                <th style={{ width: 130 }}>Asignado a</th>
              )}
              <th style={{width:100}}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {polizas.map(p => {
              const badge   = estadoBadge(p)
              const vencida = ['NO_VIGENTE', 'CANCELADA', 'ANULADA'].includes(p.estado)
              const primerRiesgo = p.riesgos?.[0]
              const dt      = primerRiesgo?.detalle_tecnico ?? {}
              const labelBase = describirBien(primerRiesgo?.tipo_riesgo, dt) ?? '—'
              const cantRiesgos = p.riesgos?.length ?? 0
              const riesgoLabel = cantRiesgos > 1
                ? `${labelBase} +${cantRiesgos - 1}`
                : labelBase

              return (
                <tr key={p.id}
                  className={`cursor-pointer ${vencida ? 'opacity-55' : ''}`}
                  onClick={() => router.push(`/crm/polizas/${p.id}`)}>
                  {isAdmin && comunicacionesActivo && (
                    <td onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={seleccionados.has(p.id)} onChange={() => toggleSeleccion(p.id)}
                        className="rounded border-slate-300 text-blue-600" />
                    </td>
                  )}
                  <td>
                    <span className="font-mono text-xs font-semibold text-slate-800">
                      {p.numero_poliza}
                    </span>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <button onClick={() => router.push(`/crm/personas/${p.asegurado?.id}`)}
                      className="text-blue-600 hover:underline text-xs font-medium text-left">
                      {nombreAsegurado(p)}
                    </button>
                  </td>
                  <td className="text-xs text-slate-600">{p.compania?.nombre ?? '—'}</td>
                  <td className="text-xs text-slate-600">{p.ramo?.nombre ?? '—'}</td>
                  <td className="text-xs text-slate-600">{p.cobertura?.nombre ?? '—'}</td>
                  <td className="text-xs text-slate-600 truncate max-w-56" title={riesgoLabel}>{riesgoLabel}</td>
                  <td className="text-xs text-slate-600 whitespace-nowrap">
                    {formatFechaLocal(p.fecha_inicio)} → <span className={vencida ? 'text-red-600 font-medium' : ''}>{formatFechaLocal(p.fecha_fin)}</span>
                  </td>
                  <td>
                    <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${badge.color}`}>
                      {badge.label}
                    </span>
                  </td>
                  {isAdmin && usuariosLista.length > 1 && (
                    <td>
                      {p.asegurado?.usuario_id ? (
                        <span className="text-xs text-slate-600 truncate block max-w-32" title={usuariosMap().get(p.asegurado.usuario_id) ?? ''}>
                          {usuariosMap().get(p.asegurado.usuario_id) ?? '—'}
                        </span>
                      ) : (
                        <span className="text-2xs text-amber-600 italic">Sin asignar</span>
                      )}
                    </td>
                  )}
                  <td onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => router.push(`/crm/polizas/${p.id}`)}
                        className="btn-tabla-accion" title="Ver ficha de la póliza">
                        <Eye />
                      </button>
                      <button onClick={() => setModalArchivos({ id: p.id, numero: p.numero_poliza })}
                        className="btn-tabla-accion" title="Ver archivos y documentación">
                        <FolderOpen />
                      </button>
                      <button onClick={async () => {
                          const url = await construirUrlWhatsapp('info_poliza',
                            p.asegurado?.whatsapp ?? p.asegurado?.telefono ?? '',
                            {
                              nombre: p.asegurado?.nombre || nombreAsegurado(p),
                              numero_poliza: p.numero_poliza,
                              compania: p.compania?.nombre ?? '',
                              ramo: p.ramo?.nombre ?? '',
                            })
                          window.open(url, '_blank')
                        }}
                        className="btn-tabla-accion-whatsapp" title="WhatsApp">
                        <MessageCircle />
                      </button>
                      <button onClick={() => router.push(`/crm/siniestros/nuevo?poliza_id=${p.id}&persona_id=${p.asegurado?.id}`)}
                        className="btn-tabla-accion-warn" title="Registrar siniestro">
                        <AlertTriangle />
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

      {/* Modal archivos */}
      {modalArchivos && (
        <ModalArchivosPoliza
          isOpen={true}
          onClose={() => setModalArchivos(null)}
          polizaId={modalArchivos.id}
          numeroPoliza={modalArchivos.numero}
        />
      )}
    </div>
  )
}
