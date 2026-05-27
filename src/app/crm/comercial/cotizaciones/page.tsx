'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, Search, X, FileEdit, Send, Clock, CheckCircle, XCircle,
  Trash2, Loader2, FileText, AlertTriangle
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { formatFechaLocalLarga, hoyLocal, sanitizarBusquedaNormalizada } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { aplicarFiltroCartera, obtenerIdsPapelera, excluirPersonasEnPapelera, puedeEliminar } from '@/lib/cartera-filter'
import { toast } from '@/lib/toast'

interface Cotizacion {
  id: string
  numero_cotizacion: string
  estado: string
  oportunidad_id: string | null
  created_at: string
  fecha_envio: string | null
  fecha_cierre: string | null
  fecha_vencimiento: string | null
  persona: { apellido: string; nombre: string | null } | null
  lead: { apellido: string; nombre: string } | null
  ramo: { nombre: string } | null
  opciones_count: number
}

interface Catalogo { id: string; nombre: string }

const ESTADO_BADGE: Record<string, { label: string; color: string }> = {
  BORRADOR:   { label: 'Borrador',   color: 'bg-slate-100 text-slate-600 border-slate-200' },
  ENVIADA:    { label: 'Enviada',    color: 'bg-blue-50 text-blue-700 border-blue-200' },
  EN_PROCESO: { label: 'En proceso', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  GANADA:     { label: 'Ganada',     color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  PERDIDA:    { label: 'Perdida',    color: 'bg-red-50 text-red-700 border-red-200' },
}

export default function CotizacionesPage() {
  const router    = useRouter()
  const supabase  = getSupabaseClient()
  const searchRef = useRef<NodeJS.Timeout>()
  const { usuario } = useAuth()

  const [cotizaciones, setCotizaciones] = useState<Cotizacion[]>([])
  const [cargando,     setCargando]     = useState(true)
  const [total,        setTotal]        = useState(0)
  const [pagina,       setPagina]       = useState(0)
  const POR_PAGINA = 25

  const [busqueda,         setBusqueda]         = useState('')
  const [busquedaDebounce, setBusquedaDebounce] = useState('')
  const [filtroEstado,     setFiltroEstado]     = useState('')
  const [filtroRamo,       setFiltroRamo]       = useState('')
  const [ramos,            setRamos]            = useState<Catalogo[]>([])

  const [kpis, setKpis] = useState({ borradores: 0, enviadas: 0, enProceso: 0, ganadasMes: 0, perdidasMes: 0, vencidas: 0 })
  const [errorCarga, setErrorCarga] = useState<string | null>(null)

  // IDs de personas en papelera. La cartera (usuario_id) la maneja
  // `aplicarFiltroCartera`; este helper adicional evita que cotizaciones
  // a personas en papelera aparezcan en KPIs y tabla. No filtra las
  // cotizaciones a leads (persona_id NULL) que sí queremos preservar.
  const [papeleraIds, setPapeleraIds] = useState<string[]>([])
  const [papeleraCargada, setPapeleraCargada] = useState(false)

  useEffect(() => {
    obtenerIdsPapelera(supabase).then(ids => {
      setPapeleraIds(ids)
      setPapeleraCargada(true)
    })
  }, [supabase])

  useEffect(() => {
    clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => { setBusquedaDebounce(busqueda); setPagina(0) }, 350)
  }, [busqueda])

  // Cargar ramos
  useEffect(() => {
    async function cargar() {
      const { data: tipos } = await supabase.from('tipo_catalogo').select('id, codigo')
      const tipoRamo = (tipos ?? []).find((t: any) => t.codigo === 'RAMO')
      if (tipoRamo) {
        const { data } = await supabase.from('catalogos').select('id, nombre').eq('tipo_id', tipoRamo.id).eq('activo', true).order('nombre')
        setRamos((data ?? []) as Catalogo[])
      }
    }
    cargar()
  }, [supabase])

  // KPIs
  useEffect(() => {
    if (!papeleraCargada) return
    async function cargarKpis() {
      const primerDiaMes = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`
      const hoy = hoyLocal()
      const buildKpi = (q: any) => excluirPersonasEnPapelera(aplicarFiltroCartera(q, usuario), papeleraIds, 'persona_id')
      const [b, e, ep, g, p, v] = await Promise.all([
        buildKpi(supabase.from('cotizaciones').select('id', { count: 'exact', head: true }).eq('estado', 'BORRADOR')),
        buildKpi(supabase.from('cotizaciones').select('id', { count: 'exact', head: true }).eq('estado', 'ENVIADA')),
        buildKpi(supabase.from('cotizaciones').select('id', { count: 'exact', head: true }).eq('estado', 'EN_PROCESO')),
        buildKpi(supabase.from('cotizaciones').select('id', { count: 'exact', head: true }).eq('estado', 'GANADA').gte('fecha_cierre', primerDiaMes)),
        buildKpi(supabase.from('cotizaciones').select('id', { count: 'exact', head: true }).eq('estado', 'PERDIDA').gte('fecha_cierre', primerDiaMes)),
        buildKpi(supabase.from('cotizaciones').select('id', { count: 'exact', head: true }).in('estado', ['ENVIADA', 'EN_PROCESO']).lt('fecha_vencimiento', hoy)),
      ])
      setKpis({ borradores: b.count ?? 0, enviadas: e.count ?? 0, enProceso: ep.count ?? 0, ganadasMes: g.count ?? 0, perdidasMes: p.count ?? 0, vencidas: v.count ?? 0 })
    }
    cargarKpis()
  }, [supabase, usuario, papeleraIds, papeleraCargada])

  const cargarCotizaciones = useCallback(async () => {
    if (!papeleraCargada) return
    setCargando(true)
    setErrorCarga(null)

    // Búsqueda extendida: número de cotización, apellido/nombre/razón social/DNI
    // del cliente y apellido/nombre del lead. Resolvemos ids de personas/leads
    // que matcheen el término y los pasamos a la query principal con .or().
    let personaIdsBusqueda: string[] = []
    let leadIdsBusqueda: string[] = []
    let safeBusq = ''
    if (busquedaDebounce) {
      safeBusq = sanitizarBusquedaNormalizada(busquedaDebounce)
      if (safeBusq) {
        const [{ data: personasMatch }, { data: leadsMatch }] = await Promise.all([
          supabase
            .from('personas')
            .select('id')
            .is('deleted_at', null)
            .or(`apellido_norm.ilike.%${safeBusq}%,nombre_norm.ilike.%${safeBusq}%,razon_social_norm.ilike.%${safeBusq}%,dni_cuil.ilike.%${safeBusq}%`)
            .limit(200),
          supabase
            .from('leads')
            .select('id')
            .or(`apellido_norm.ilike.%${safeBusq}%,nombre_norm.ilike.%${safeBusq}%,dni.ilike.%${safeBusq}%`)
            .limit(200),
        ])
        personaIdsBusqueda = ((personasMatch ?? []) as any[]).map(p => p.id)
        leadIdsBusqueda = ((leadsMatch ?? []) as any[]).map(l => l.id)
      }
    }

    let query = excluirPersonasEnPapelera(
      aplicarFiltroCartera(supabase
        .from('cotizaciones')
        .select(`
          id, numero_cotizacion, estado, oportunidad_id, created_at, fecha_envio, fecha_cierre, fecha_vencimiento,
          persona:personas!persona_id (apellido, nombre),
          lead:leads!lead_id (apellido, nombre),
          ramo:catalogos!ramo_id (nombre)
        `, { count: 'exact' }), usuario),
      papeleraIds, 'persona_id'
    )

    if (filtroEstado === 'VENCIDAS') {
      const hoy = hoyLocal()
      query = query.in('estado', ['ENVIADA', 'EN_PROCESO']).lt('fecha_vencimiento', hoy)
    } else if (filtroEstado) {
      query = query.eq('estado', filtroEstado)
    }
    if (filtroRamo)   query = query.eq('ramo_id', filtroRamo)

    if (safeBusq) {
      const orParts = [`numero_cotizacion.ilike.%${safeBusq}%`]
      if (personaIdsBusqueda.length > 0) {
        orParts.push(`persona_id.in.(${personaIdsBusqueda.join(',')})`)
      }
      if (leadIdsBusqueda.length > 0) {
        orParts.push(`lead_id.in.(${leadIdsBusqueda.join(',')})`)
      }
      query = query.or(orParts.join(','))
    }

    query = query
      .order('created_at', { ascending: false })
      .range(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA - 1)

    const { data, count, error: errCot } = await query
    if (errCot) {
      setErrorCarga(errCot.message || 'No se pudieron cargar las cotizaciones')
      setCotizaciones([])
      setTotal(0)
      setCargando(false)
      return
    }

    // Cargar conteo de opciones por cotización
    const cotList = (data ?? []) as any[]
    const cotIds = cotList.map(c => c.id)

    let opcionesPorCot: Record<string, number> = {}
    if (cotIds.length > 0) {
      const { data: opcData, error: errOpc } = await supabase
        .from('cotizacion_companias')
        .select('cotizacion_id')
        .in('cotizacion_id', cotIds)
      if (errOpc) {
        setErrorCarga(errOpc.message || 'No se pudieron cargar las opciones de cotización')
        setCotizaciones([])
        setTotal(0)
        setCargando(false)
        return
      }
      for (const o of (opcData ?? []) as any[]) {
        opcionesPorCot[o.cotizacion_id] = (opcionesPorCot[o.cotizacion_id] ?? 0) + 1
      }
    }

    setCotizaciones(cotList.map(c => ({
      ...c,
      opciones_count: opcionesPorCot[c.id] ?? 0,
    })) as Cotizacion[])
    setTotal(count ?? 0)
    setCargando(false)
  }, [supabase, filtroEstado, filtroRamo, busquedaDebounce, pagina, usuario, papeleraIds, papeleraCargada])

  useEffect(() => { cargarCotizaciones() }, [cargarCotizaciones])

  const eliminar = async (e: React.MouseEvent, c: Cotizacion) => {
    e.stopPropagation()
    // Si está GANADA y tiene oportunidad: confirm específico + revert.
    const esGanadaConOportunidad = c.estado === 'GANADA' && !!c.oportunidad_id
    const mensaje = esGanadaConOportunidad
      ? 'Esta cotización está marcada como GANADA. Eliminarla revertirá la oportunidad asociada al estado NEGOCIACION para mantener trazabilidad. ¿Continuar?'
      : '¿Eliminar esta cotización? Se eliminarán también todas las opciones de compañías.'
    if (!confirm(mensaje)) return

    if (esGanadaConOportunidad && c.oportunidad_id) {
      const { error: errOp } = await supabase
        .from('oportunidades')
        .update({
          estado: 'NEGOCIACION',
          motivo_perdida: null,
        })
        .eq('id', c.oportunidad_id)
      if (errOp) { toast.error(`No se pudo revertir la oportunidad: ${errOp.message}`); return }
    }

    // FK cotizacion_companias.cotizacion_id tiene ON DELETE CASCADE.
    const { error: errDel } = await supabase.from('cotizaciones').delete().eq('id', c.id)
    if (errDel) { toast.error(`No se pudo eliminar: ${errDel.message}`); return }
    cargarCotizaciones()
  }

  const limpiarFiltros = () => { setBusqueda(''); setFiltroEstado(''); setFiltroRamo(''); setPagina(0) }
  const hayFiltros = busqueda || filtroEstado || filtroRamo

  function destinatarioLabel(c: Cotizacion) {
    if (c.persona) return { nombre: `${c.persona.apellido}, ${c.persona.nombre ?? ''}`, esLead: false }
    if (c.lead) return { nombre: `${c.lead.apellido}, ${c.lead.nombre}`, esLead: true }
    return { nombre: 'Sin asignar', esLead: false }
  }

  function fechaLabel(c: Cotizacion) {
    if (c.estado === 'GANADA' || c.estado === 'PERDIDA') return c.fecha_cierre ? formatFechaLocalLarga(c.fecha_cierre) : '—'
    if (c.estado === 'ENVIADA' || c.estado === 'EN_PROCESO') return c.fecha_envio ? formatFechaLocalLarga(c.fecha_envio) : formatFechaLocalLarga(c.created_at)
    return formatFechaLocalLarga(c.created_at)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Cotizaciones</h1>
          <p className="text-xs text-slate-500">{total} cotizaciones en total</p>
        </div>
        <button onClick={() => router.push('/crm/comercial/cotizaciones/nueva')} className="btn-primary">
          <Plus className="h-3 w-3"/> Nueva cotización
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-6 gap-2">
        <div className="kpi-card bg-slate-50 border border-slate-200">
          <span className="kpi-label flex items-center gap-1"><FileEdit className="h-3 w-3 text-slate-500"/> Borradores</span>
          <span className="kpi-value text-slate-700">{kpis.borradores}</span>
          <span className="kpi-sub">pendientes de envío</span>
        </div>
        <div className="kpi-card bg-blue-50 border border-blue-200">
          <span className="kpi-label flex items-center gap-1"><Send className="h-3 w-3 text-blue-600"/> Enviadas</span>
          <span className="kpi-value text-blue-700">{kpis.enviadas}</span>
          <span className="kpi-sub">esperando respuesta</span>
        </div>
        <div className="kpi-card bg-amber-50 border border-amber-200">
          <span className="kpi-label flex items-center gap-1"><Clock className="h-3 w-3 text-amber-600"/> En proceso</span>
          <span className="kpi-value text-amber-700">{kpis.enProceso}</span>
          <span className="kpi-sub">en negociación</span>
        </div>
        <div className="kpi-card bg-emerald-50 border border-emerald-200">
          <span className="kpi-label flex items-center gap-1"><CheckCircle className="h-3 w-3 text-emerald-600"/> Ganadas este mes</span>
          <span className="kpi-value text-emerald-700">{kpis.ganadasMes}</span>
          <span className="kpi-sub">cerradas con éxito</span>
        </div>
        <div className="kpi-card bg-red-50 border border-red-200">
          <span className="kpi-label flex items-center gap-1"><XCircle className="h-3 w-3 text-red-600"/> Perdidas este mes</span>
          <span className="kpi-value text-red-700">{kpis.perdidasMes}</span>
          <span className="kpi-sub">no avanzaron</span>
        </div>
        <div className="kpi-card bg-amber-50 border border-amber-200">
          <span className="kpi-label flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-amber-600"/> Vencidas</span>
          <span className="kpi-value text-amber-700">{kpis.vencidas}</span>
          <span className="kpi-sub">requieren renovar</span>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-slate-200 rounded p-2 flex items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400"/>
          <input className="search-input w-full pl-6" placeholder="Buscar por número, cliente, lead o DNI..."
            value={busqueda} onChange={e => setBusqueda(e.target.value)}/>
        </div>
        <select className="form-input" value={filtroEstado} onChange={e => { setFiltroEstado(e.target.value); setPagina(0) }}>
          <option value="">Todos los estados</option>
          <option value="BORRADOR">Borrador</option>
          <option value="ENVIADA">Enviada</option>
          <option value="EN_PROCESO">En proceso</option>
          <option value="GANADA">Ganada</option>
          <option value="PERDIDA">Perdida</option>
          <option value="VENCIDAS">Vencidas</option>
        </select>
        <select className="form-input" value={filtroRamo} onChange={e => { setFiltroRamo(e.target.value); setPagina(0) }}>
          <option value="">Todos los ramos</option>
          {ramos.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </select>
        {hayFiltros && (
          <button onClick={limpiarFiltros} className="btn-secondary flex items-center gap-1">
            <X className="h-3 w-3"/> Limpiar
          </button>
        )}
      </div>

      {/* Banner de error */}
      {errorCarga && (
        <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="flex-1">No se pudieron cargar las cotizaciones: {errorCarga}</span>
          <button onClick={cargarCotizaciones} className="underline hover:no-underline">Reintentar</button>
        </div>
      )}

      {/* Tabla */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Nº Cotización</th>
              <th>Cliente / Lead</th>
              <th>Ramo</th>
              <th>Compañías</th>
              <th>Estado</th>
              <th>Fecha</th>
              <th>Vence</th>
              <th style={{ width: 50 }}>Acc.</th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={8} className="text-center py-10 text-slate-400 text-xs">
                <Loader2 className="h-4 w-4 animate-spin inline mr-2"/>Cargando...
              </td></tr>
            ) : cotizaciones.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12">
                <div className="flex flex-col items-center gap-2">
                  <FileText className="h-8 w-8 text-slate-300"/>
                  <p className="text-xs text-slate-400">
                    {hayFiltros ? 'No hay cotizaciones con esos filtros.' : "No hay cotizaciones. Hacé clic en 'Nueva cotización' para armar tu primera comparativa."}
                  </p>
                </div>
              </td></tr>
            ) : cotizaciones.map(c => {
              const eb = ESTADO_BADGE[c.estado] ?? ESTADO_BADGE.BORRADOR
              const dest = destinatarioLabel(c)
              const cerrada = c.estado === 'GANADA' || c.estado === 'PERDIDA'
              const hoyS = hoyLocal()
              const cotVencida = !!c.fecha_vencimiento && c.fecha_vencimiento < hoyS && (c.estado === 'ENVIADA' || c.estado === 'EN_PROCESO')
              return (
                <tr key={c.id} className={`cursor-pointer hover:bg-slate-50 ${cerrada ? 'opacity-55' : ''}`}
                  onClick={() => router.push(`/crm/comercial/cotizaciones/${c.id}`)}>
                  <td><span className="font-mono text-xs font-semibold text-slate-700">{c.numero_cotizacion}</span></td>
                  <td>
                    <span className="text-xs text-slate-700">{dest.nombre}</span>
                    {dest.esLead && <span className="ml-1 text-2xs bg-cyan-50 text-cyan-700 border border-cyan-200 px-1 rounded">Lead</span>}
                  </td>
                  <td className="text-xs text-slate-600">{c.ramo?.nombre ?? '—'}</td>
                  <td className="text-xs text-slate-600">{c.opciones_count} {c.opciones_count === 1 ? 'opción' : 'opciones'}</td>
                  <td><span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${eb.color}`}>{eb.label}</span></td>
                  <td className="text-xs text-slate-600">{fechaLabel(c)}</td>
                  <td className={`text-xs ${cotVencida ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>
                    {c.fecha_vencimiento ? formatFechaLocalLarga(c.fecha_vencimiento) : '—'}
                  </td>
                  <td>
                    {puedeEliminar(usuario) && (
                    <button onClick={(e) => eliminar(e, c)}
                      className="btn-tabla-accion-danger" title="Eliminar">
                      <Trash2 />
                    </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {Math.ceil(total / POR_PAGINA) > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-500 pb-2">
          <span>Mostrando {pagina * POR_PAGINA + 1}–{Math.min((pagina + 1) * POR_PAGINA, total)} de {total}</span>
          <div className="flex gap-1">
            <button onClick={() => setPagina(p => Math.max(0, p - 1))} disabled={pagina === 0} className="btn-secondary px-3">← Anterior</button>
            <button onClick={() => setPagina(p => Math.min(Math.ceil(total / POR_PAGINA) - 1, p + 1))} disabled={pagina >= Math.ceil(total / POR_PAGINA) - 1} className="btn-secondary px-3">Siguiente →</button>
          </div>
        </div>
      )}
    </div>
  )
}
