'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, Search, X, UserPlus, PhoneCall, UserCheck, UserX,
  Pencil, Trash2, MessageCircle,
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { formatFechaLocalLarga, sanitizarBusquedaNormalizada } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { aplicarFiltroCartera, puedeEliminar } from '@/lib/cartera-filter'
import { EstadoCarga } from '@/components/EstadoCarga'
import { useRealtimeRefresh } from '@/lib/hooks/useRealtimeRefresh'

interface Lead {
  id: string
  nombre: string
  apellido: string
  telefono: string | null
  email: string | null
  empresa: string | null
  cargo: string | null
  fuente: string
  nivel_interes: string
  estado: string
  created_at: string
}

const FUENTE_BADGE: Record<string, string> = {
  REFERIDO:          'bg-emerald-50 text-emerald-700 border-emerald-200',
  WEB:               'bg-blue-50 text-blue-700 border-blue-200',
  REDES_SOCIALES:    'bg-violet-50 text-violet-700 border-violet-200',
  LLAMADA_ENTRANTE:  'bg-orange-50 text-orange-700 border-orange-200',
  EVENTO:            'bg-cyan-50 text-cyan-700 border-cyan-200',
  OTRO:              'bg-slate-100 text-slate-600 border-slate-200',
}

const INTERES_BADGE: Record<string, string> = {
  ALTO:  'bg-red-50 text-red-700 border-red-200',
  MEDIO: 'bg-amber-50 text-amber-700 border-amber-200',
  BAJO:  'bg-slate-100 text-slate-600 border-slate-200',
}

const ESTADO_BADGE: Record<string, { label: string; color: string }> = {
  NUEVO:      { label: 'Nuevo',      color: 'bg-blue-50 text-blue-700 border-blue-200' },
  CONTACTADO: { label: 'Contactado', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  CONVERTIDO: { label: 'Convertido', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  DESCARTADO: { label: 'Descartado', color: 'bg-red-50 text-red-700 border-red-200' },
}

const FUENTE_LABEL: Record<string, string> = {
  REFERIDO: 'Referido', WEB: 'Web', REDES_SOCIALES: 'Redes Sociales',
  LLAMADA_ENTRANTE: 'Llamada', EVENTO: 'Evento', OTRO: 'Otro',
}

function diasDesde(fecha: string): string {
  const diff = Math.floor((Date.now() - new Date(fecha).getTime()) / 86400000)
  if (diff === 0) return 'hoy'
  if (diff === 1) return 'hace 1 día'
  return `hace ${diff} días`
}

export default function LeadsPage() {
  const router    = useRouter()
  const supabase  = getSupabaseClient()
  const searchRef = useRef<NodeJS.Timeout>()
  const { usuario } = useAuth()

  const [leads,    setLeads]    = useState<Lead[]>([])
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<{ codigo?: string; mensaje: string } | null>(null)
  const [total,    setTotal]    = useState(0)
  const [pagina,   setPagina]   = useState(0)
  const POR_PAGINA = 25

  const [busqueda,         setBusqueda]         = useState('')
  const [busquedaDebounce, setBusquedaDebounce] = useState('')
  const [filtroEstado,     setFiltroEstado]     = useState('')
  const [filtroInteres,    setFiltroInteres]    = useState('')
  const [filtroFuente,     setFiltroFuente]     = useState('')

  const [kpis, setKpis] = useState({ nuevos: 0, contactados: 0, convertidosMes: 0, descartados: 0 })

  // Tick que Realtime incrementa para forzar refetch de KPIs (el useEffect
  // los usa como dependencia).
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => { setBusquedaDebounce(busqueda); setPagina(0) }, 350)
  }, [busqueda])

  // KPIs
  useEffect(() => {
    async function cargarKpis() {
      const hoy = new Date()
      const primerDiaMes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`

      const [n, c, cv, d] = await Promise.all([
        aplicarFiltroCartera(supabase.from('leads').select('id', { count: 'exact', head: true }).eq('estado', 'NUEVO'), usuario),
        aplicarFiltroCartera(supabase.from('leads').select('id', { count: 'exact', head: true }).eq('estado', 'CONTACTADO'), usuario),
        aplicarFiltroCartera(supabase.from('leads').select('id', { count: 'exact', head: true }).eq('estado', 'CONVERTIDO').gte('updated_at', primerDiaMes), usuario),
        aplicarFiltroCartera(supabase.from('leads').select('id', { count: 'exact', head: true }).eq('estado', 'DESCARTADO'), usuario),
      ])
      setKpis({
        nuevos: n.count ?? 0,
        contactados: c.count ?? 0,
        convertidosMes: cv.count ?? 0,
        descartados: d.count ?? 0,
      })
    }
    cargarKpis()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, usuario, refreshTick])

  // Cargar leads
  const cargarLeads = useCallback(async () => {
    setCargando(true)
    setErrorCarga(null)

    let query = aplicarFiltroCartera(supabase
      .from('leads')
      .select('id, nombre, apellido, telefono, email, empresa, cargo, fuente, nivel_interes, estado, created_at', { count: 'exact' }), usuario)

    if (filtroEstado)  query = query.eq('estado', filtroEstado)
    else               query = query.neq('estado', 'CONVERTIDO') // Ocultar convertidos por default
    if (filtroInteres) query = query.eq('nivel_interes', filtroInteres)
    if (filtroFuente)  query = query.eq('fuente', filtroFuente)

    if (busquedaDebounce) {
      const safeBusq = sanitizarBusquedaNormalizada(busquedaDebounce)
      if (safeBusq) {
        query = query.or(
          `nombre_norm.ilike.%${safeBusq}%,apellido_norm.ilike.%${safeBusq}%,dni.ilike.%${safeBusq}%,telefono.ilike.%${safeBusq}%,email.ilike.%${safeBusq}%`
        )
      }
    }

    query = query
      .order('created_at', { ascending: false })
      .range(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA - 1)

    const { data, count, error } = await query
    if (error) {
      setErrorCarga({ mensaje: error.message ?? 'No se pudieron cargar los leads.' })
    } else {
      setLeads((data ?? []) as unknown as Lead[])
      setTotal(count ?? 0)
    }
    setCargando(false)
  }, [supabase, filtroEstado, filtroInteres, filtroFuente, busquedaDebounce, pagina, usuario])

  useEffect(() => { cargarLeads() }, [cargarLeads])

  // Realtime: cualquier INSERT/UPDATE/DELETE en leads refresca listado + KPIs.
  useRealtimeRefresh({
    tablas: ['leads'],
    onCambio: () => { cargarLeads(); setRefreshTick(t => t + 1) },
  })

  const eliminar = async (e: React.MouseEvent, lead: Lead) => {
    e.stopPropagation()
    if (!confirm(`¿Estás seguro? Se eliminarán también todas las interacciones del lead.`)) return
    // El FK interacciones.lead_id tiene ON DELETE CASCADE — la DB se
    // encarga de las interacciones automáticamente.
    await supabase.from('leads').delete().eq('id', lead.id)
    cargarLeads()
  }

  const limpiarFiltros = () => { setBusqueda(''); setFiltroEstado(''); setFiltroInteres(''); setFiltroFuente(''); setPagina(0) }
  const hayFiltros = busqueda || filtroEstado || filtroInteres || filtroFuente

  return (
    <div className="flex flex-col gap-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Leads</h1>
          <p className="text-xs text-slate-500">{total.toLocaleString('es-AR')} leads en total</p>
        </div>
        <button onClick={() => router.push('/crm/comercial/leads/nuevo')} className="btn-primary">
          <Plus className="h-3 w-3"/> Nuevo lead
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-2">
        <div className="kpi-card bg-blue-50 border border-blue-200">
          <span className="kpi-label flex items-center gap-1">
            <UserPlus className="h-3 w-3 text-blue-600"/> Leads nuevos
          </span>
          <span className="kpi-value text-blue-700">{kpis.nuevos}</span>
          <span className="kpi-sub">sin contactar (total)</span>
        </div>
        <div className="kpi-card bg-amber-50 border border-amber-200">
          <span className="kpi-label flex items-center gap-1">
            <PhoneCall className="h-3 w-3 text-amber-600"/> Contactados
          </span>
          <span className="kpi-value text-amber-700">{kpis.contactados}</span>
          <span className="kpi-sub">en seguimiento (total)</span>
        </div>
        <div className="kpi-card bg-emerald-50 border border-emerald-200">
          <span className="kpi-label flex items-center gap-1">
            <UserCheck className="h-3 w-3 text-emerald-600"/> Convertidos este mes
          </span>
          <span className="kpi-value text-emerald-700">{kpis.convertidosMes}</span>
          <span className="kpi-sub">pasaron a clientes (total)</span>
        </div>
        <div className="kpi-card bg-red-50 border border-red-200">
          <span className="kpi-label flex items-center gap-1">
            <UserX className="h-3 w-3 text-red-600"/> Descartados
          </span>
          <span className="kpi-value text-red-700">{kpis.descartados}</span>
          <span className="kpi-sub">no avanzaron (total)</span>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-slate-200 rounded p-2 flex items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400"/>
          <input className="search-input w-full pl-6" placeholder="Buscar por nombre, apellido, DNI, teléfono o email..."
            value={busqueda} onChange={e => setBusqueda(e.target.value)}/>
        </div>
        <select className="form-input" value={filtroEstado} onChange={e => { setFiltroEstado(e.target.value); setPagina(0) }}>
          <option value="">Todos los estados</option>
          <option value="NUEVO">Nuevo</option>
          <option value="CONTACTADO">Contactado</option>
          <option value="CONVERTIDO">Convertido</option>
          <option value="DESCARTADO">Descartado</option>
        </select>
        <select className="form-input" value={filtroInteres} onChange={e => { setFiltroInteres(e.target.value); setPagina(0) }}>
          <option value="">Todo nivel de interés</option>
          <option value="ALTO">Alto</option>
          <option value="MEDIO">Medio</option>
          <option value="BAJO">Bajo</option>
        </select>
        <select className="form-input" value={filtroFuente} onChange={e => { setFiltroFuente(e.target.value); setPagina(0) }}>
          <option value="">Todas las fuentes</option>
          <option value="REFERIDO">Referido</option>
          <option value="WEB">Web</option>
          <option value="REDES_SOCIALES">Redes Sociales</option>
          <option value="LLAMADA_ENTRANTE">Llamada Entrante</option>
          <option value="EVENTO">Evento</option>
          <option value="OTRO">Otro</option>
        </select>
        {hayFiltros && (
          <button onClick={limpiarFiltros} className="btn-secondary flex items-center gap-1">
            <X className="h-3 w-3"/> Limpiar
          </button>
        )}
      </div>

      {/* Tabla */}
      <EstadoCarga
        loading={cargando}
        error={errorCarga}
        empty={!cargando && !errorCarga && leads.length === 0}
        emptyMensaje={hayFiltros ? 'No hay leads con esos filtros.' : 'No hay leads registrados.'}
        onReintentar={cargarLeads}
      >
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Contacto</th>
              <th>Fuente</th>
              <th>Interés</th>
              <th>Estado</th>
              <th>Fecha ingreso</th>
              <th style={{ width: 80 }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {leads.map(l => {
              const eb = ESTADO_BADGE[l.estado] ?? ESTADO_BADGE.NUEVO
              const descartado = l.estado === 'DESCARTADO'
              return (
                <tr key={l.id} className={`cursor-pointer hover:bg-slate-50 ${descartado ? 'opacity-55' : ''}`}
                  onClick={() => router.push(`/crm/comercial/leads/${l.id}`)}>
                  <td>
                    <span className={`text-xs font-medium text-slate-700 ${descartado ? 'line-through' : ''}`}>
                      {l.apellido}, {l.nombre}
                    </span>
                    {(l.empresa || l.cargo) && (
                      <p className="text-2xs text-slate-500 mt-0.5">
                        {[l.cargo, l.empresa].filter(Boolean).join(' en ')}
                      </p>
                    )}
                  </td>
                  <td>
                    <div className="flex flex-col gap-0.5">
                      {l.telefono && (
                        <span className="text-xs text-slate-600 font-mono flex items-center gap-1">
                          {l.telefono}
                          <MessageCircle className="h-2.5 w-2.5 text-green-500"/>
                        </span>
                      )}
                      {l.email && <span className="text-2xs text-slate-400 truncate max-w-32">{l.email}</span>}
                      {!l.telefono && !l.email && <span className="text-2xs text-slate-400">Sin contacto</span>}
                    </div>
                  </td>
                  <td>
                    <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${FUENTE_BADGE[l.fuente] ?? FUENTE_BADGE.OTRO}`}>
                      {FUENTE_LABEL[l.fuente] ?? l.fuente}
                    </span>
                  </td>
                  <td>
                    <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${INTERES_BADGE[l.nivel_interes] ?? INTERES_BADGE.MEDIO}`}>
                      {l.nivel_interes}
                    </span>
                  </td>
                  <td>
                    <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${eb.color}`}>
                      {eb.label}
                    </span>
                  </td>
                  <td>
                    <span className="text-xs text-slate-600">{formatFechaLocalLarga(l.created_at)}</span>
                    <p className="text-2xs text-slate-500">{diasDesde(l.created_at)}</p>
                  </td>
                  <td>
                    <div className="flex items-center gap-0.5">
                      <button onClick={(e) => { e.stopPropagation(); router.push(`/crm/comercial/leads/${l.id}/editar`) }}
                        className="btn-tabla-accion" title="Editar">
                        <Pencil />
                      </button>
                      {puedeEliminar(usuario) && (
                      <button onClick={(e) => eliminar(e, l)}
                        className="btn-tabla-accion-danger" title="Eliminar">
                        <Trash2 />
                      </button>
                      )}
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
            <button onClick={() => setPagina(p => Math.min(Math.ceil(total / POR_PAGINA) - 1, p + 1))} disabled={pagina >= Math.ceil(total / POR_PAGINA) - 1} className="btn-secondary px-3">Siguiente →</button>
          </div>
        </div>
      )}
    </div>
  )
}
