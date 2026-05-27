'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, Search, RefreshCw, X, Edit, Trash2, MessageCircle,
  CheckCircle, Clock, AlertTriangle, ClipboardList,
  Phone, Calendar, Repeat, Send, Users,
  Briefcase, Loader2
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { formatFechaLocal, hoyLocal, calcularSiguienteFechaRecurrencia, sanitizarBusquedaNormalizada } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { obtenerIdsPersonas, filtrarPorPersonas, puedeEliminar } from '@/lib/cartera-filter'
import { EstadoCarga } from '@/components/EstadoCarga'
import { toast } from '@/lib/toast'
import { construirUrlWhatsapp } from '@/lib/whatsapp-templates'

// ── Tipos ────────────────────────────────────────────────────
interface Tarea {
  id: string
  titulo: string
  tipo: string
  descripcion: string | null
  persona_id: string
  poliza_id: string | null
  siniestro_id: string | null
  fecha_vencimiento: string
  hora_vencimiento: string | null
  prioridad: string
  estado: string
  recurrencia: string
  nota_cierre: string | null
  created_at: string
  persona: { id: string; apellido: string; nombre: string | null; razon_social: string | null; whatsapp: string | null; telefono: string | null }
  poliza: { id: string; numero_poliza: string } | null
}

// ── Constantes ───────────────────────────────────────────────
const TIPOS_TAREA: Record<string, { label: string; icon: React.ReactNode }> = {
  LLAMADA_SEGUIMIENTO:    { label: 'Llamada de seguimiento',  icon: <Phone className="h-3 w-3 text-blue-500" /> },
  GESTION_RENOVACION:     { label: 'Gestión de renovación',   icon: <Repeat className="h-3 w-3 text-emerald-500" /> },
  TRAMITE_SINIESTRO:      { label: 'Trámite de siniestro',    icon: <AlertTriangle className="h-3 w-3 text-amber-500" /> },
  GESTION_COBRANZA:       { label: 'Gestión de cobranza',     icon: <Briefcase className="h-3 w-3 text-violet-500" /> },
  ENVIO_DOCUMENTACION:    { label: 'Envío de documentación',  icon: <Send className="h-3 w-3 text-cyan-500" /> },
  REUNION_CLIENTE:        { label: 'Reunión con cliente',     icon: <Users className="h-3 w-3 text-indigo-500" /> },
  ALERTA_VENCIMIENTO:     { label: 'Alerta de vencimiento',   icon: <Clock className="h-3 w-3 text-orange-500" /> },
  TAREA_GENERAL:          { label: 'Tarea general',           icon: <ClipboardList className="h-3 w-3 text-slate-400" /> },
}

function prioridadBadge(p: string) {
  const map: Record<string, { label: string; color: string }> = {
    CRITICA: { label: 'Crítica', color: 'bg-red-50 text-red-700 border-red-200' },
    ALTA:    { label: 'Alta',    color: 'bg-orange-50 text-orange-700 border-orange-200' },
    MEDIA:   { label: 'Media',   color: 'bg-amber-50 text-amber-700 border-amber-200' },
    BAJA:    { label: 'Baja',    color: 'bg-slate-100 text-slate-600 border-slate-200' },
  }
  return map[p] ?? map.BAJA
}

function estadoBadge(e: string) {
  const map: Record<string, { label: string; color: string }> = {
    PENDIENTE:  { label: 'Pendiente',  color: 'bg-blue-50 text-blue-700 border-blue-200' },
    EN_PROCESO: { label: 'En proceso', color: 'bg-amber-50 text-amber-700 border-amber-200' },
    COMPLETADA: { label: 'Completada', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    CANCELADA:  { label: 'Cancelada',  color: 'bg-slate-100 text-slate-600 border-slate-200' },
  }
  return map[e] ?? map.PENDIENTE
}

function formatHora(h: string | null) {
  if (!h) return ''
  return h.substring(0, 5)
}

function nombrePersona(t: Tarea) {
  return [t.persona?.apellido, t.persona?.nombre].filter(Boolean).join(', ') || t.persona?.razon_social || '—'
}

// ── Página ───────────────────────────────────────────────────
export default function TareasPage() {
  const router   = useRouter()
  const supabase = getSupabaseClient()
  const searchRef = useRef<NodeJS.Timeout>()
  const { usuario } = useAuth()

  const [tareas,    setTareas]    = useState<Tarea[]>([])
  const [cargando,  setCargando]  = useState(true)
  const [errorCarga, setErrorCarga] = useState<{ codigo?: string; mensaje: string } | null>(null)
  const [total,     setTotal]     = useState(0)
  const [pagina,    setPagina]    = useState(0)
  const POR_PAGINA = 25

  const [busqueda,         setBusqueda]         = useState('')
  const [busquedaDebounce, setBusquedaDebounce] = useState('')
  const [filtroTipo,       setFiltroTipo]       = useState('')
  const [filtroPrioridad,  setFiltroPrioridad]  = useState('')
  const [filtroEstado,     setFiltroEstado]     = useState('')
  const [filtroPeriodo,    setFiltroPeriodo]    = useState('')

  const [kpis, setKpis] = useState({ vencidas: 0, hoy: 0, semana: 0, pendientes: 0 })
  const [kpiActivo, setKpiActivo] = useState<string | null>(null)

  // IDs de personas accesibles (excluye papelera). null = acceso total.
  const [idsPersonas, setIdsPersonas] = useState<string[] | null>(null)
  const [idsPersonasCargados, setIdsPersonasCargados] = useState(false)

  // Modal completar
  const [modalTarea,  setModalTarea]  = useState<Tarea | null>(null)
  const [notaCierre,  setNotaCierre]  = useState('')
  const [completando, setCompletando] = useState(false)

  useEffect(() => {
    if (!usuario) return
    obtenerIdsPersonas(supabase, usuario).then(ids => {
      setIdsPersonas(ids)
      setIdsPersonasCargados(true)
    })
  }, [supabase, usuario])

  // ── KPIs ───────────────────────────────────────────────
  const cargarKpis = useCallback(async () => {
    if (!idsPersonasCargados) return
    const hoy     = hoyLocal()
    const en7     = new Date(); en7.setDate(en7.getDate() + 7)
    const en7str  = `${en7.getFullYear()}-${String(en7.getMonth() + 1).padStart(2, '0')}-${String(en7.getDate()).padStart(2, '0')}`

    let qV = supabase.from('tareas').select('id', { count: 'exact', head: true }).lte('fecha_vencimiento', hoy).in('estado', ['PENDIENTE', 'EN_PROCESO'])
    let qH = supabase.from('tareas').select('id', { count: 'exact', head: true }).eq('fecha_vencimiento', hoy).in('estado', ['PENDIENTE', 'EN_PROCESO'])
    let qS = supabase.from('tareas').select('id', { count: 'exact', head: true }).gte('fecha_vencimiento', hoy).lte('fecha_vencimiento', en7str).in('estado', ['PENDIENTE', 'EN_PROCESO'])
    let qP = supabase.from('tareas').select('id', { count: 'exact', head: true }).in('estado', ['PENDIENTE', 'EN_PROCESO'])

    // Filtrar por persona — esto excluye automáticamente papelera (idsPersonas
    // ya viene depurado por obtenerIdsPersonas).
    qV = filtrarPorPersonas(qV, idsPersonas, 'persona_id')
    qH = filtrarPorPersonas(qH, idsPersonas, 'persona_id')
    qS = filtrarPorPersonas(qS, idsPersonas, 'persona_id')
    qP = filtrarPorPersonas(qP, idsPersonas, 'persona_id')

    const [v, h, s, p] = await Promise.all([qV, qH, qS, qP])
    setKpis({ vencidas: v.count ?? 0, hoy: h.count ?? 0, semana: s.count ?? 0, pendientes: p.count ?? 0 })
  }, [supabase, idsPersonas, idsPersonasCargados])

  useEffect(() => { cargarKpis() }, [cargarKpis])

  // ── Debounce ───────────────────────────────────────────
  useEffect(() => {
    clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => { setBusquedaDebounce(busqueda); setPagina(0) }, 350)
  }, [busqueda])

  // ── Cargar tareas ──────────────────────────────────────
  const cargar = useCallback(async () => {
    if (!idsPersonasCargados) return
    setCargando(true)
    setErrorCarga(null)

    let personaIds: string[] = []
    const safeBusq = sanitizarBusquedaNormalizada(busquedaDebounce)
    if (safeBusq) {
      const { data: pers } = await supabase
        .from('personas')
        .select('id')
        .is('deleted_at', null)
        .or(`apellido_norm.ilike.%${safeBusq}%,nombre_norm.ilike.%${safeBusq}%`)
      personaIds = (pers ?? []).map((p: any) => p.id)
    }

    let query = supabase
      .from('tareas')
      .select(`
        id, titulo, tipo, descripcion, persona_id, poliza_id, siniestro_id,
        fecha_vencimiento, hora_vencimiento, prioridad, estado, recurrencia,
        nota_cierre, created_at,
        persona:personas!tareas_persona_id_fkey (id, apellido, nombre, razon_social, whatsapp, telefono),
        poliza:polizas!tareas_poliza_id_fkey (id, numero_poliza)
      `, { count: 'exact' })

    query = filtrarPorPersonas(query, idsPersonas, 'persona_id')

    if (filtroTipo)      query = query.eq('tipo', filtroTipo)
    if (filtroPrioridad) query = query.eq('prioridad', filtroPrioridad)
    if (filtroEstado)    query = query.eq('estado', filtroEstado)

    const hoy = hoyLocal()
    if (filtroPeriodo === 'hoy')      query = query.eq('fecha_vencimiento', hoy)
    if (filtroPeriodo === 'semana') {
      const en7 = new Date(); en7.setDate(en7.getDate() + 7)
      query = query.gte('fecha_vencimiento', hoy).lte('fecha_vencimiento', `${en7.getFullYear()}-${String(en7.getMonth() + 1).padStart(2, '0')}-${String(en7.getDate()).padStart(2, '0')}`)
    }
    if (filtroPeriodo === 'mes') {
      const en30 = new Date(); en30.setDate(en30.getDate() + 30)
      query = query.gte('fecha_vencimiento', hoy).lte('fecha_vencimiento', `${en30.getFullYear()}-${String(en30.getMonth() + 1).padStart(2, '0')}-${String(en30.getDate()).padStart(2, '0')}`)
    }
    if (filtroPeriodo === 'vencidas') {
      query = query.lte('fecha_vencimiento', hoy).in('estado', ['PENDIENTE', 'EN_PROCESO'])
    }

    if (safeBusq) {
      if (personaIds.length > 0) {
        query = query.or(`titulo.ilike.%${safeBusq}%,persona_id.in.(${personaIds.join(',')})`)
      } else {
        query = query.ilike('titulo', `%${safeBusq}%`)
      }
    }

    query = query
      .order('fecha_vencimiento', { ascending: true })
      .range(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA - 1)

    const { data, count, error } = await query
    if (error) {
      setErrorCarga({ mensaje: error.message ?? 'No se pudieron cargar las tareas.' })
    } else if (data) {
      setTareas(data as unknown as Tarea[])
      setTotal(count ?? 0)
    }
    setCargando(false)
  }, [supabase, idsPersonas, idsPersonasCargados, filtroTipo, filtroPrioridad, filtroEstado, filtroPeriodo, busquedaDebounce, pagina])

  useEffect(() => { cargar() }, [cargar])

  // ── Completar tarea ────────────────────────────────────
  const completarTarea = async () => {
    if (!modalTarea) return
    setCompletando(true)
    try {
      const { error } = await supabase.from('tareas').update({
        estado: 'COMPLETADA',
        nota_cierre: notaCierre.trim() || null,
      }).eq('id', modalTarea.id)
      if (error) throw error

      // Si es recurrente, crear siguiente instancia
      if (modalTarea.recurrencia !== 'NINGUNA') {
        const nuevaFecha = calcularSiguienteFechaRecurrencia(modalTarea.fecha_vencimiento, modalTarea.recurrencia)
        await supabase.from('tareas').insert({
          titulo:            modalTarea.titulo,
          tipo:              modalTarea.tipo,
          descripcion:       modalTarea.descripcion,
          persona_id:        modalTarea.persona_id,
          poliza_id:         modalTarea.poliza_id,
          siniestro_id:      modalTarea.siniestro_id,
          fecha_vencimiento: nuevaFecha,
          hora_vencimiento:  modalTarea.hora_vencimiento,
          prioridad:         modalTarea.prioridad,
          estado:            'PENDIENTE',
          recurrencia:       modalTarea.recurrencia,
        })
      }

      setModalTarea(null)
      setNotaCierre('')
      cargar()
      cargarKpis()
    } catch (err: any) {
      toast.error(err?.message ?? 'No se pudo completar la tarea')
    } finally {
      setCompletando(false)
    }
  }

  // ── Eliminar tarea ─────────────────────────────────────
  const eliminarTarea = async (id: string) => {
    if (!confirm('¿Eliminar esta tarea?')) return
    const { error } = await supabase.from('tareas').delete().eq('id', id)
    if (error) { toast.error(error.message ?? 'No se pudo eliminar'); return }
    toast.exito('Tarea eliminada')
    cargar(); cargarKpis()
  }

  const limpiar = () => { setBusqueda(''); setFiltroTipo(''); setFiltroPrioridad(''); setFiltroEstado(''); setFiltroPeriodo(''); setKpiActivo(null); setPagina(0) }
  const hayFiltros = busqueda || filtroTipo || filtroPrioridad || filtroEstado || filtroPeriodo

  return (
    <div className="flex flex-col gap-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Tareas</h1>
          <p className="text-xs text-slate-500">{total.toLocaleString('es-AR')} tareas en total</p>
        </div>
        <button onClick={() => router.push('/crm/tareas/nueva')} className="btn-primary">
          <Plus className="h-3.5 w-3.5" /> Nueva Tarea
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-2">
        <div className={`kpi-card bg-red-50 border border-red-200 cursor-pointer hover:opacity-80 transition-all ${kpiActivo === 'vencidas' ? 'ring-2 ring-red-400' : ''}`}
          onClick={() => { if (kpiActivo === 'vencidas') { setKpiActivo(null); setFiltroPeriodo('') } else { setKpiActivo('vencidas'); setFiltroEstado(''); setFiltroPeriodo('vencidas') } setPagina(0) }}>
          <span className="kpi-label flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5 text-red-600" /> Vencidas
          </span>
          <span className="kpi-value text-red-700">{kpis.vencidas.toLocaleString('es-AR')}</span>
          <span className="kpi-sub">requieren atención</span>
        </div>
        <div className={`kpi-card bg-amber-50 border border-amber-200 cursor-pointer hover:opacity-80 transition-all ${kpiActivo === 'hoy' ? 'ring-2 ring-amber-400' : ''}`}
          onClick={() => { if (kpiActivo === 'hoy') { setKpiActivo(null); setFiltroPeriodo('') } else { setKpiActivo('hoy'); setFiltroEstado(''); setFiltroPeriodo('hoy') } setPagina(0) }}>
          <span className="kpi-label flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-amber-600" /> Para hoy
          </span>
          <span className="kpi-value text-amber-700">{kpis.hoy.toLocaleString('es-AR')}</span>
          <span className="kpi-sub">vencen hoy</span>
        </div>
        <div className={`kpi-card bg-blue-50 border border-blue-200 cursor-pointer hover:opacity-80 transition-all ${kpiActivo === 'semana' ? 'ring-2 ring-blue-400' : ''}`}
          onClick={() => { if (kpiActivo === 'semana') { setKpiActivo(null); setFiltroPeriodo('') } else { setKpiActivo('semana'); setFiltroEstado(''); setFiltroPeriodo('semana') } setPagina(0) }}>
          <span className="kpi-label flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5 text-blue-600" /> Próximos 7 días
          </span>
          <span className="kpi-value text-blue-700">{kpis.semana.toLocaleString('es-AR')}</span>
          <span className="kpi-sub">esta semana</span>
        </div>
        <div className={`kpi-card bg-slate-50 border border-slate-200 cursor-pointer hover:opacity-80 transition-all ${kpiActivo === 'pendientes' ? 'ring-2 ring-slate-400' : ''}`}
          onClick={() => { if (kpiActivo === 'pendientes') { setKpiActivo(null) } else { setKpiActivo('pendientes'); setFiltroEstado(''); setFiltroPeriodo(''); setFiltroPrioridad(''); setFiltroTipo('') } setPagina(0) }}>
          <span className="kpi-label flex items-center gap-1">
            <ClipboardList className="h-3.5 w-3.5 text-slate-600" /> Total pendientes
          </span>
          <span className="kpi-value text-slate-700">{kpis.pendientes.toLocaleString('es-AR')}</span>
          <span className="kpi-sub">sin completar</span>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-slate-200 rounded p-2 flex items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input className="search-input w-full pl-6" placeholder="Buscar por título o cliente..."
            value={busqueda} onChange={e => setBusqueda(e.target.value)} />
        </div>
        <select className="form-input" value={filtroTipo} onChange={e => { setFiltroTipo(e.target.value); setKpiActivo(null); setPagina(0) }}>
          <option value="">Todos los tipos</option>
          {Object.entries(TIPOS_TAREA).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="form-input" value={filtroPrioridad} onChange={e => { setFiltroPrioridad(e.target.value); setKpiActivo(null); setPagina(0) }}>
          <option value="">Todas las prioridades</option>
          <option value="CRITICA">Crítica</option>
          <option value="ALTA">Alta</option>
          <option value="MEDIA">Media</option>
          <option value="BAJA">Baja</option>
        </select>
        <select className="form-input" value={filtroEstado} onChange={e => { setFiltroEstado(e.target.value); setKpiActivo(null); setPagina(0) }}>
          <option value="">Todos los estados</option>
          <option value="PENDIENTE">Pendiente</option>
          <option value="EN_PROCESO">En proceso</option>
          <option value="COMPLETADA">Completada</option>
          <option value="CANCELADA">Cancelada</option>
        </select>
        <select className="form-input" value={filtroPeriodo} onChange={e => { setFiltroPeriodo(e.target.value); setKpiActivo(null); setPagina(0) }}>
          <option value="">Todos los períodos</option>
          <option value="hoy">Hoy</option>
          <option value="semana">Esta semana</option>
          <option value="mes">Este mes</option>
          <option value="vencidas">Vencidas</option>
        </select>
        {hayFiltros && (
          <button onClick={limpiar} className="btn-secondary flex items-center gap-1">
            <X className="h-3.5 w-3.5" /> Limpiar
          </button>
        )}
        <button onClick={cargar} className="btn-secondary h-7 w-7 p-0 flex items-center justify-center ml-auto" title="Actualizar">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Tabla */}
      <EstadoCarga
        loading={cargando}
        error={errorCarga}
        empty={!cargando && !errorCarga && tareas.length === 0}
        emptyMensaje={hayFiltros ? 'No hay tareas con esos filtros.' : 'No hay tareas cargadas todavía.'}
        onReintentar={cargar}
      >
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <table className="crm-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>Pri.</th>
              <th>Título</th>
              <th>Tipo</th>
              <th>Cliente</th>
              <th>Póliza</th>
              <th>Vencimiento</th>
              <th>Estado</th>
              <th style={{ width: 120 }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {tareas.map(t => {
              const hoy     = hoyLocal()
              const vencida = t.fecha_vencimiento <= hoy && ['PENDIENTE', 'EN_PROCESO'].includes(t.estado)
              const pBadge  = prioridadBadge(t.prioridad)
              const eBadge  = estadoBadge(t.estado)
              const tipo    = TIPOS_TAREA[t.tipo] ?? TIPOS_TAREA.TAREA_GENERAL

              return (
                <tr key={t.id}
                  className={`cursor-pointer ${vencida ? 'bg-red-50/30' : ''}`}
                  onClick={() => router.push(`/crm/tareas/${t.id}`)}>
                  <td>
                    <div className="flex items-center justify-center">
                      {t.prioridad === 'CRITICA' ? (
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                        </span>
                      ) : (
                        <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${pBadge.color}`}>
                          {pBadge.label}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className="text-xs font-medium text-slate-800">{t.titulo}</span>
                    {t.recurrencia !== 'NINGUNA' && (
                      <Repeat className="inline h-2.5 w-2.5 text-slate-400 ml-1" />
                    )}
                  </td>
                  <td>
                    <div className="flex items-center gap-1 text-xs text-slate-600">
                      {tipo.icon} {tipo.label}
                    </div>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <button onClick={() => router.push(`/crm/personas/${t.persona?.id}`)}
                      className="text-blue-600 hover:underline text-xs font-medium text-left">
                      {nombrePersona(t)}
                    </button>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    {t.poliza ? (
                      <button onClick={() => router.push(`/crm/polizas/${t.poliza!.id}`)}
                        className="font-mono text-xs text-blue-600 hover:underline text-left">
                        {t.poliza.numero_poliza}
                      </button>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className={`text-xs whitespace-nowrap ${vencida ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>
                    {formatFechaLocal(t.fecha_vencimiento)}
                    {t.hora_vencimiento && <span className="text-slate-500 ml-1">{formatHora(t.hora_vencimiento)}</span>}
                  </td>
                  <td>
                    <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${eBadge.color}`}>
                      {eBadge.label}
                    </span>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-0.5">
                      {['PENDIENTE', 'EN_PROCESO'].includes(t.estado) && (
                        <button onClick={() => { setModalTarea(t); setNotaCierre('') }}
                          className="btn-tabla-accion-success" title="Completar">
                          <CheckCircle />
                        </button>
                      )}
                      <button onClick={() => router.push(`/crm/tareas/${t.id}/editar`)}
                        className="btn-tabla-accion" title="Editar">
                        <Edit />
                      </button>
                      <button onClick={async () => {
                          const tel = t.persona?.whatsapp ?? t.persona?.telefono ?? ''
                          if (!tel) return
                          const url = await construirUrlWhatsapp('gestion_tarea', tel, {
                            nombre: t.persona?.nombre || nombrePersona(t),
                            titulo_tarea: t.titulo,
                          })
                          window.open(url, '_blank')
                        }}
                        className="btn-tabla-accion-whatsapp" title="WhatsApp">
                        <MessageCircle />
                      </button>
                      {puedeEliminar(usuario) && (
                      <button onClick={() => eliminarTarea(t.id)}
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
            <button onClick={() => setPagina(p => p + 1)} disabled={pagina >= Math.ceil(total / POR_PAGINA) - 1} className="btn-secondary px-3">Siguiente →</button>
          </div>
        </div>
      )}

      {/* Modal completar */}
      {modalTarea && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setModalTarea(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 rounded-t-lg border-b border-slate-200 bg-emerald-50">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-600" />
                <h3 className="text-sm font-semibold text-emerald-800">Completar tarea</h3>
              </div>
              <button onClick={() => setModalTarea(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <p className="text-xs text-slate-600">
                <span className="font-medium">{modalTarea.titulo}</span>
              </p>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">¿Qué pasó? (opcional)</label>
                <textarea className="form-input w-full resize-none text-xs" rows={3}
                  value={notaCierre} onChange={e => setNotaCierre(e.target.value)}
                  placeholder="Dejá una nota sobre cómo se resolvió..." />
              </div>
              {modalTarea.recurrencia !== 'NINGUNA' && (
                <div className="flex items-center gap-1.5 rounded border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs text-blue-700">
                  <Repeat className="h-3 w-3" />
                  Se creará automáticamente la siguiente tarea ({modalTarea.recurrencia.toLowerCase()})
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50 rounded-b-lg">
              <button onClick={() => setModalTarea(null)} className="btn-secondary">Cancelar</button>
              <button onClick={completarTarea} disabled={completando}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-50">
                {completando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                {completando ? 'Guardando...' : 'Completar'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
