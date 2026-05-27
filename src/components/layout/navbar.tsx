'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Search, Bell, ChevronDown, User, LogOut, Settings, Users, FileText,
  AlertTriangle, Loader2, FileX, ClipboardX, FileQuestion, Target,
  CalendarClock, CalendarX,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { getSupabaseClient } from '@/lib/supabase/client'
import { getPolizaBadgeColor, getLabelEstado, sanitizarBusquedaNormalizada } from '@/lib/utils'
import { getEstadoBadge } from '@/lib/siniestros-config'
import { useAuth } from '@/contexts/AuthContext'
import { tieneAccesoTotal, obtenerIdsPersonas } from '@/lib/cartera-filter'
import { apiCall } from '@/lib/api-client'
import { emitirBroadcastNotificaciones, useBroadcastNotificaciones } from '@/lib/broadcast-notificaciones'
import { PresenciaNavbar } from './PresenciaNavbar'

// ── Tipos búsqueda global ──
interface PersonaResult { id: string; nombre: string | null; apellido: string; dni_cuil: string; telefono: string | null; estado: string }
interface PolizaResult { id: string; numero_poliza: string; estado: string; asegurado: { nombre: string | null; apellido: string } | null; compania: { nombre: string } | null }
interface SiniestroResult { id: string; numero_caso: string; numero_siniestro: string | null; estado: string; persona: { nombre: string | null; apellido: string } | null }

interface LeadResult { id: string; nombre: string; apellido: string; estado: string; fuente: string }
interface OportunidadResult { id: string; tipo: string; estado: string; persona: { nombre: string | null; apellido: string } | null }
interface CotizacionResult { id: string; numero_cotizacion: string; estado: string; persona: { nombre: string | null; apellido: string } | null; lead: { nombre: string; apellido: string } | null }

interface Resultados {
  personas: PersonaResult[]
  polizas: PolizaResult[]
  siniestros: SiniestroResult[]
  leads: LeadResult[]
  oportunidades: OportunidadResult[]
  cotizaciones: CotizacionResult[]
}

function getPersonaBadgeColor(estado: string): string {
  const mapa: Record<string, string> = {
    ACTIVO:    'bg-emerald-50 text-emerald-700 border-emerald-200',
    PROSPECTO: 'bg-blue-50 text-blue-700 border-blue-200',
    INACTIVO:  'bg-slate-100 text-slate-600 border-slate-200',
    BLOQUEADO: 'bg-red-50 text-red-700 border-red-200',
  }
  return mapa[estado] ?? 'bg-slate-100 text-slate-600 border-slate-200'
}

// ── Tipos notificaciones ──
interface Notificacion {
  id: string
  tipo: string
  prioridad: string
  titulo: string
  mensaje: string
  entidad_tipo: string | null
  entidad_id: string | null
  url: string | null
  leida: boolean
  created_at: string
}

interface NotifContadores {
  total_no_leidas: number
  criticas: number
  advertencias: number
  informativas: number
}

function tiempoRelativo(fechaStr: string): string {
  const ahora = Date.now()
  const fecha = new Date(fechaStr).getTime()
  const diff = ahora - fecha
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `Hace ${mins < 1 ? 1 : mins} min`
  const horas = Math.floor(mins / 60)
  if (horas < 24) return `Hace ${horas}h`
  const dias = Math.floor(horas / 24)
  if (dias < 7) return `Hace ${dias}d`
  const [y, m, d] = fechaStr.split('T')[0].split('-')
  return `${d}/${m}/${y}`
}

function iconoNotificacion(tipo: string) {
  switch (tipo) {
    case 'POLIZA_VENCIDA': return FileX
    case 'TAREA_VENCIDA': return ClipboardX
    case 'SINIESTRO_30_DIAS':
    case 'SINIESTRO_60_DIAS': return AlertTriangle
    case 'COTIZACION_SIN_RESPUESTA':
    case 'COTIZACION_SIN_SEGUIMIENTO': return FileQuestion
    case 'COTIZACION_VENCIENDO_PRONTO': return CalendarClock
    case 'COTIZACION_VENCIDA': return CalendarX
    case 'OPORTUNIDAD_ESTANCADA': return Target
    default: return Bell
  }
}

function colorPrioridad(prioridad: string): string {
  switch (prioridad) {
    case 'CRITICA': return 'text-red-500'
    case 'ADVERTENCIA': return 'text-amber-500'
    case 'INFORMATIVA': return 'text-blue-500'
    default: return 'text-slate-400'
  }
}

export function Navbar() {
  const router = useRouter()
  const supabase = getSupabaseClient()
  const { usuario, isAdmin, logout } = useAuth()

  // ── Estado búsqueda global ──
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<Resultados | null>(null)
  const [cargando, setCargando] = useState(false)
  const [mostrarDropdown, setMostrarDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Estado notificaciones ──
  const [contadores, setContadores] = useState<NotifContadores>({ total_no_leidas: 0, criticas: 0, advertencias: 0, informativas: 0 })
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([])
  const [mostrarPanel, setMostrarPanel] = useState(false)
  const [cargandoNotif, setCargandoNotif] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // ── Cache de IDs de personas para filtrado de cartera ──
  const idsPersonasRef = useRef<string[] | null>(null)
  const accesoTotalRef = useRef<boolean>(true)

  useEffect(() => {
    if (!usuario) return
    const esTotal = tieneAccesoTotal(usuario)
    accesoTotalRef.current = esTotal
    if (!esTotal) {
      const supabaseLocal = getSupabaseClient()
      obtenerIdsPersonas(supabaseLocal, usuario).then(ids => {
        idsPersonasRef.current = ids
      })
    } else {
      idsPersonasRef.current = null
    }
  }, [usuario])

  // ── Cerrar dropdowns al hacer click fuera ──
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMostrarDropdown(false)
      }
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setMostrarPanel(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // ── Cerrar con Escape ──
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMostrarDropdown(false)
        setMostrarPanel(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // ── Cargar contadores de notificaciones ──
  // El scope se aplica en el backend a partir de la sesión autenticada,
  // no se pasa usuario_id por query string (era ignorado por la API).
  const cargarContadores = useCallback(async () => {
    try {
      const res = await fetch('/api/notificaciones?leida=false&limite=1')
      const json = await res.json()
      if (json.ok && json.resumen) {
        setContadores(json.resumen)
      }
    } catch (err) {
      console.warn('[navbar] cargarContadores falló:', err)
    }
  }, [])

  // ── Cargar notificaciones del panel ──
  const cargarNotificaciones = useCallback(async () => {
    setCargandoNotif(true)
    try {
      const res = await fetch('/api/notificaciones?limite=15')
      const json = await res.json()
      if (json.ok) {
        setNotificaciones(json.data ?? [])
        if (json.resumen) setContadores(json.resumen)
      }
    } catch (err) {
      console.warn('[navbar] cargarNotificaciones falló:', err)
    }
    setCargandoNotif(false)
  }, [])

  // ── Ref con el estado actual del panel (para no recrear la suscripción
  //    de Realtime cada vez que se abre/cierra) ──
  const mostrarPanelRef = useRef(false)
  useEffect(() => { mostrarPanelRef.current = mostrarPanel }, [mostrarPanel])

  // ── Realtime + carga inicial + revalidación al focus ──
  //
  // Antes había `setInterval(cargarContadores, 5 min)`. Reemplazado por:
  //  1. Suscripción Realtime a `notificaciones` filtrada por usuario_id
  //     (canal del usuario + canal global con usuario_id IS NULL).
  //  2. Revalidación on-focus para cubrir casos de reconexión / volver de
  //     una pestaña inactiva mucho tiempo.
  //
  // Realtime maneja reconexión automática internamente, así que no hace
  // falta polling de fallback. Si el ws se cae, el cliente JS reintenta.
  useEffect(() => {
    if (!usuario) return

    // Carga inicial
    cargarContadores()

    // Cuando el usuario vuelve a la pestaña, resync defensivo.
    const onFocus = () => cargarContadores()
    window.addEventListener('focus', onFocus)

    // Handler común: refetch contadores; si el panel está abierto, también
    // refetch la lista (los `created_at` y orden los provee el backend).
    const handler = () => {
      cargarContadores()
      if (mostrarPanelRef.current) cargarNotificaciones()
    }

    // Realtime filtra una sola condición por canal — no soporta OR — así
    // que abrimos dos canales (uno por usuario_id puntual, otro globales).
    const canalUsuario = supabase
      .channel(`notif-user-${usuario.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notificaciones',
          filter: `usuario_id=eq.${usuario.id}`,
        },
        handler,
      )
      .subscribe()

    const canalGlobal = supabase
      .channel('notif-global')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notificaciones',
          filter: 'usuario_id=is.null',
        },
        handler,
      )
      .subscribe()

    return () => {
      window.removeEventListener('focus', onFocus)
      supabase.removeChannel(canalUsuario)
      supabase.removeChannel(canalGlobal)
    }
  }, [usuario, cargarContadores, cargarNotificaciones, supabase])

  // ── Toggle panel de notificaciones ──
  const togglePanel = () => {
    const abriendo = !mostrarPanel
    setMostrarPanel(abriendo)
    if (abriendo) cargarNotificaciones()
  }

  // ── Marcar todas como leídas ──
  const marcarTodasLeidas = async () => {
    await apiCall('/api/notificaciones', { method: 'PATCH', body: { todas: true } }, { mostrar_toast_en_error: false })
    cargarNotificaciones()
    cargarContadores()
    emitirBroadcastNotificaciones({ tipo: 'todas-leidas' })
  }

  // ── Click en una notificación ──
  const clickNotificacion = async (n: Notificacion) => {
    if (!n.leida) {
      await apiCall('/api/notificaciones', { method: 'PATCH', body: { ids: [n.id] } }, { mostrar_toast_en_error: false })
      emitirBroadcastNotificaciones({ tipo: 'marcada-leida', id: n.id })
    }
    setMostrarPanel(false)
    cargarContadores()
    if (n.url) router.push(n.url)
  }

  // ── Sincronización cross-tab: refrescar UI cuando otra tab cambia algo ──
  // (complementa Realtime, que sí cubre cross-device pero con ~100ms de lag).
  useBroadcastNotificaciones(useCallback(() => {
    cargarContadores()
    if (mostrarPanel) cargarNotificaciones()
  }, [cargarContadores, cargarNotificaciones, mostrarPanel]))

  // ── Búsqueda global ──
  const buscar = useCallback(async (texto: string) => {
    if (texto.length < 2) {
      setResultados(null)
      setMostrarDropdown(false)
      return
    }

    setCargando(true)
    setMostrarDropdown(true)

    // Sanitizar y normalizar (lower + sin acentos) para matchear las
    // columnas `*_norm` de personas/leads.
    const safeTexto = sanitizarBusquedaNormalizada(texto)
    if (!safeTexto) {
      setResultados(null)
      setMostrarDropdown(false)
      setCargando(false)
      return
    }
    const patron = `%${safeTexto}%`
    const filtrar = !accesoTotalRef.current
    const ids = idsPersonasRef.current

    let qPersonas = supabase
      .from('personas')
      .select('id, nombre, apellido, dni_cuil, telefono, estado')
      .is('deleted_at', null)
      .or(`nombre_norm.ilike.${patron},apellido_norm.ilike.${patron},dni_cuil.ilike.${patron},telefono.ilike.${patron},email.ilike.${patron}`)
      .order('apellido', { ascending: true })
      .limit(5)
    if (filtrar && usuario) {
      qPersonas = qPersonas.eq("usuario_id", usuario.id)
    }

    let qPolizas = supabase
      .from('polizas')
      .select('id, numero_poliza, estado, asegurado:personas!asegurado_id(nombre, apellido), compania:catalogos!compania_id(nombre)')
      .ilike('numero_poliza', patron)
      .order('created_at', { ascending: false })
      .limit(5)
    if (filtrar && ids !== null) {
      qPolizas = ids.length === 0
        ? qPolizas.in('asegurado_id', ['00000000-0000-0000-0000-000000000000'])
        : qPolizas.in('asegurado_id', ids)
    }

    let qSiniestros = supabase
      .from('siniestros')
      .select('id, numero_caso, numero_siniestro, estado, persona:personas!persona_id(nombre, apellido)')
      .is('deleted_at', null)
      .or(`numero_caso.ilike.${patron},numero_siniestro.ilike.${patron}`)
      .order('created_at', { ascending: false })
      .limit(5)
    if (filtrar && ids !== null) {
      qSiniestros = ids.length === 0
        ? qSiniestros.in('persona_id', ['00000000-0000-0000-0000-000000000000'])
        : qSiniestros.in('persona_id', ids)
    }

    // Commercial entities
    let qLeads = supabase
      .from('leads')
      .select('id, nombre, apellido, estado, fuente')
      .or(`nombre_norm.ilike.${patron},apellido_norm.ilike.${patron},dni.ilike.${patron},telefono.ilike.${patron},email.ilike.${patron}`)
      .order('created_at', { ascending: false })
      .limit(5)
    if (filtrar && usuario) {
      qLeads = qLeads.eq("usuario_id", usuario.id)
    }

    let qCotizaciones = supabase
      .from('cotizaciones')
      .select('id, numero_cotizacion, estado, persona:personas!persona_id(nombre, apellido), lead:leads!lead_id(nombre, apellido)')
      .ilike('numero_cotizacion', patron)
      .order('created_at', { ascending: false })
      .limit(5)
    if (filtrar && usuario) {
      qCotizaciones = qCotizaciones.eq("usuario_id", usuario.id)
    }

    const [resPersonas, resPolizas, resSiniestros, resLeads, resCotizaciones] = await Promise.all([
      qPersonas, qPolizas, qSiniestros, qLeads, qCotizaciones,
    ])

    setResultados({
      personas: (resPersonas.data ?? []) as unknown as PersonaResult[],
      polizas: (resPolizas.data ?? []) as unknown as PolizaResult[],
      siniestros: (resSiniestros.data ?? []) as unknown as SiniestroResult[],
      leads: (resLeads.data ?? []) as unknown as LeadResult[],
      oportunidades: [],
      cotizaciones: (resCotizaciones.data ?? []) as unknown as CotizacionResult[],
    })
    setCargando(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario])

  useEffect(() => {
    const timer = setTimeout(() => buscar(busqueda.trim()), 350)
    return () => clearTimeout(timer)
  }, [busqueda, buscar])

  const navegar = (ruta: string) => {
    setMostrarDropdown(false)
    setBusqueda('')
    setResultados(null)
    router.push(ruta)
  }

  const hayResultados = resultados && (resultados.personas.length > 0 || resultados.polizas.length > 0 || resultados.siniestros.length > 0 || resultados.leads.length > 0 || resultados.cotizaciones.length > 0)

  return (
    <header
      className="crm-navbar fixed top-0 right-0 left-0 z-20 flex items-center gap-3 px-4 bg-white border-b border-slate-200"
      style={{
        height: 'var(--navbar-height)',
      }}
    >
      {/* Buscador global */}
      <div className="flex-1 max-w-sm relative" ref={dropdownRef}>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onFocus={() => { if (resultados && busqueda.trim().length >= 2) setMostrarDropdown(true) }}
            placeholder="Buscar personas, polizas, siniestros, leads..."
            className="w-full h-7 pl-7 pr-3 text-xs bg-slate-50 border border-slate-200 rounded
                       placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500
                       focus:border-blue-500 focus:bg-white transition-all"
          />
        </div>

        {/* Dropdown de resultados de búsqueda */}
        {mostrarDropdown && (
          <div className="absolute top-full left-0 mt-1 w-[420px] bg-white border border-slate-200 rounded-lg shadow-lg z-50 max-h-[400px] overflow-y-auto">
            {cargando ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Buscando...
              </div>
            ) : !hayResultados ? (
              <div className="py-6 text-center text-xs text-slate-400">
                No se encontraron resultados para &ldquo;{busqueda.trim()}&rdquo;
              </div>
            ) : (
              <>
                {resultados!.personas.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border-b border-slate-100">
                      <Users className="h-3.5 w-3.5 text-slate-500" />
                      <span className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">Personas</span>
                      <span className="text-2xs text-slate-400">({resultados!.personas.length})</span>
                    </div>
                    {resultados!.personas.map(p => (
                      <button key={p.id} onClick={() => navegar(`/crm/personas/${p.id}`)}
                        className="flex items-center justify-between w-full px-3 py-2 text-left hover:bg-slate-50 transition-colors">
                        <div>
                          <div className="text-xs font-medium text-slate-700">{p.apellido}{p.nombre ? `, ${p.nombre}` : ''}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-2xs text-slate-400 font-mono">{p.dni_cuil}</span>
                          </div>
                        </div>
                        <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${getPersonaBadgeColor(p.estado)}`}>
                          {getLabelEstado(p.estado)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {resultados!.polizas.length > 0 && (
                  <div className={resultados!.personas.length > 0 ? 'border-t border-slate-100' : ''}>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border-b border-slate-100">
                      <FileText className="h-3.5 w-3.5 text-slate-500" />
                      <span className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">Pólizas</span>
                      <span className="text-2xs text-slate-400">({resultados!.polizas.length})</span>
                    </div>
                    {resultados!.polizas.map(p => (
                      <button key={p.id} onClick={() => navegar(`/crm/polizas/${p.id}`)}
                        className="flex items-center justify-between w-full px-3 py-2 text-left hover:bg-slate-50 transition-colors">
                        <div>
                          <div className="text-xs font-medium text-slate-700 font-mono">{p.numero_poliza}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-2xs text-slate-400">
                              {p.asegurado ? `${p.asegurado.apellido}${p.asegurado.nombre ? `, ${p.asegurado.nombre}` : ''}` : '—'}
                            </span>
                            {p.compania && (
                              <>
                                <span className="text-slate-300">·</span>
                                <span className="text-2xs text-slate-400">{p.compania.nombre}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${getPolizaBadgeColor(p.estado)}`}>
                          {getLabelEstado(p.estado)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {resultados!.siniestros.length > 0 && (
                  <div className={(resultados!.personas.length > 0 || resultados!.polizas.length > 0) ? 'border-t border-slate-100' : ''}>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border-b border-slate-100">
                      <AlertTriangle className="h-3.5 w-3.5 text-slate-500" />
                      <span className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">Siniestros</span>
                      <span className="text-2xs text-slate-400">({resultados!.siniestros.length})</span>
                    </div>
                    {resultados!.siniestros.map(s => {
                      const badge = getEstadoBadge(s.estado)
                      return (
                        <button key={s.id} onClick={() => navegar(`/crm/siniestros/${s.id}`)}
                          className="flex items-center justify-between w-full px-3 py-2 text-left hover:bg-slate-50 transition-colors">
                          <div>
                            <div className="text-xs font-medium text-slate-700 font-mono">{s.numero_caso}</div>
                            <div className="mt-0.5">
                              <span className="text-2xs text-slate-400">
                                {s.persona ? `${s.persona.apellido}${s.persona.nombre ? `, ${s.persona.nombre}` : ''}` : '—'}
                              </span>
                            </div>
                          </div>
                          <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${badge.color}`}>
                            {badge.label}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
                {resultados!.leads.length > 0 && (
                  <div className="border-t border-slate-100">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border-b border-slate-100">
                      <Target className="h-3.5 w-3.5 text-slate-500" />
                      <span className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">Leads</span>
                      <span className="text-2xs text-slate-400">({resultados!.leads.length})</span>
                    </div>
                    {resultados!.leads.map(l => {
                      const leadBadge: Record<string, string> = {
                        NUEVO: 'bg-blue-50 text-blue-700 border-blue-200',
                        CONTACTADO: 'bg-amber-50 text-amber-700 border-amber-200',
                        CONVERTIDO: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                        DESCARTADO: 'bg-red-50 text-red-700 border-red-200',
                      }
                      return (
                        <button key={l.id} onClick={() => navegar(`/crm/comercial/leads/${l.id}`)}
                          className="flex items-center justify-between w-full px-3 py-2 text-left hover:bg-slate-50 transition-colors">
                          <div>
                            <div className="text-xs font-medium text-slate-700">{l.apellido}, {l.nombre}</div>
                            <div className="text-2xs text-slate-400 mt-0.5">{l.fuente.replace(/_/g, ' ')}</div>
                          </div>
                          <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${leadBadge[l.estado] ?? ''}`}>
                            {l.estado}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
                {resultados!.cotizaciones.length > 0 && (
                  <div className="border-t border-slate-100">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border-b border-slate-100">
                      <FileText className="h-3.5 w-3.5 text-slate-500" />
                      <span className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">Cotizaciones</span>
                      <span className="text-2xs text-slate-400">({resultados!.cotizaciones.length})</span>
                    </div>
                    {resultados!.cotizaciones.map(c => {
                      const cotBadge: Record<string, string> = {
                        BORRADOR: 'bg-slate-100 text-slate-600 border-slate-200',
                        ENVIADA: 'bg-blue-50 text-blue-700 border-blue-200',
                        EN_PROCESO: 'bg-amber-50 text-amber-700 border-amber-200',
                        GANADA: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                        PERDIDA: 'bg-red-50 text-red-700 border-red-200',
                      }
                      const dest = c.persona ? `${c.persona.apellido}${c.persona.nombre ? `, ${c.persona.nombre}` : ''}` :
                                   c.lead ? `${c.lead.apellido}, ${c.lead.nombre}` : '—'
                      return (
                        <button key={c.id} onClick={() => navegar(`/crm/comercial/cotizaciones/${c.id}`)}
                          className="flex items-center justify-between w-full px-3 py-2 text-left hover:bg-slate-50 transition-colors">
                          <div>
                            <div className="text-xs font-medium text-slate-700 font-mono">{c.numero_cotizacion}</div>
                            <div className="text-2xs text-slate-400 mt-0.5">{dest}</div>
                          </div>
                          <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${cotBadge[c.estado] ?? ''}`}>
                            {c.estado}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Presencia: usuarios conectados (solo admin) */}
        <PresenciaNavbar />

        {/* Notificaciones */}
        <div className="relative" ref={panelRef}>
          <button
            onClick={togglePanel}
            className="relative flex h-7 w-7 items-center justify-center rounded
                       text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <Bell className="h-4 w-4" />
            {contadores.total_no_leidas > 0 && (
              <span className={`absolute -top-0.5 -right-0.5 flex items-center justify-center h-3.5 min-w-3.5 px-0.5 rounded-full
                bg-red-500 text-white text-2xs font-bold leading-none
                ${contadores.criticas > 0 ? 'animate-pulse' : ''}`}>
                {contadores.total_no_leidas > 99 ? '99+' : contadores.total_no_leidas}
              </span>
            )}
          </button>

          {/* Panel de notificaciones */}
          {mostrarPanel && (
            <div className="absolute right-0 top-full mt-1 w-[400px] bg-white border border-slate-200 rounded-lg shadow-lg z-50 flex flex-col max-h-[500px]">
              {/* Header */}
              <div className="px-3 py-2 border-b border-slate-100">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">Notificaciones</span>
                  {contadores.total_no_leidas > 0 && (
                    <button onClick={marcarTodasLeidas} className="text-2xs text-blue-600 hover:text-blue-800 transition-colors">
                      Marcar todas como leídas
                    </button>
                  )}
                </div>
                {contadores.total_no_leidas > 0 && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {contadores.criticas > 0 && (
                      <span className="text-2xs font-medium px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">
                        {contadores.criticas} {contadores.criticas === 1 ? 'crítica' : 'críticas'}
                      </span>
                    )}
                    {contadores.advertencias > 0 && (
                      <span className="text-2xs font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200">
                        {contadores.advertencias} {contadores.advertencias === 1 ? 'advertencia' : 'advertencias'}
                      </span>
                    )}
                    {contadores.informativas > 0 && (
                      <span className="text-2xs font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200">
                        {contadores.informativas} {contadores.informativas === 1 ? 'informativa' : 'informativas'}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Lista */}
              <div className="flex-1 overflow-y-auto">
                {cargandoNotif ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Cargando...
                  </div>
                ) : notificaciones.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-xs text-slate-400">
                    <Bell className="h-5 w-5 mb-1.5 text-slate-300" />
                    No hay notificaciones
                  </div>
                ) : (
                  notificaciones.map(n => {
                    const Icono = iconoNotificacion(n.tipo)
                    const bgRow = !n.leida
                      ? n.prioridad === 'CRITICA' ? 'bg-red-50/50' : 'bg-blue-50/40'
                      : ''
                    return (
                      <button
                        key={n.id}
                        onClick={() => clickNotificacion(n)}
                        className={`flex items-start gap-2 w-full px-3 py-2 text-left hover:bg-slate-50 transition-colors border-b border-slate-50 ${bgRow}`}
                      >
                        {/* Indicador no leída */}
                        <div className="flex-shrink-0 mt-1 w-2">
                          {!n.leida && <span className="block h-1.5 w-1.5 rounded-full bg-blue-500" />}
                        </div>
                        {/* Ícono */}
                        <Icono className={`h-4 w-4 mt-0.5 flex-shrink-0 ${colorPrioridad(n.prioridad)}`} />
                        {/* Contenido */}
                        <div className="flex-1 min-w-0">
                          <div className={`text-xs text-slate-700 ${!n.leida ? 'font-semibold' : ''} truncate`}>
                            {n.titulo}
                          </div>
                          <div className="text-2xs text-slate-500 truncate mt-0.5">
                            {n.mensaje}
                          </div>
                          <div className="text-2xs text-slate-400 mt-0.5">
                            {tiempoRelativo(n.created_at)}
                          </div>
                        </div>
                      </button>
                    )
                  })
                )}
              </div>

              {/* Footer */}
              <div className="border-t border-slate-100 px-3 py-2">
                <button
                  onClick={() => { setMostrarPanel(false); router.push('/crm/notificaciones') }}
                  className="text-2xs text-blue-600 hover:text-blue-800 transition-colors"
                >
                  Ver todas las notificaciones &rarr;
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Separador */}
        <div className="h-4 w-px bg-slate-200" />

        {/* Perfil de usuario */}
        <div className="group relative">
          <button className="flex items-center gap-1.5 h-7 px-2 rounded
                             text-slate-600 hover:bg-slate-100 transition-colors">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white">
              <User className="h-3.5 w-3.5" />
            </div>
            <span className="text-xs font-medium">
              {usuario ? `${usuario.nombre} ${usuario.apellido}` : 'Usuario'}
            </span>
            {usuario && (
              <span className={`text-2xs font-medium px-1 py-0.5 rounded ${
                isAdmin ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
              }`}>
                {usuario.rol}
              </span>
            )}
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          </button>

          {/* Dropdown */}
          <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-slate-200
                          rounded shadow-lg opacity-0 invisible group-hover:opacity-100
                          group-hover:visible transition-all duration-100 z-50">
            <div className="px-3 py-2 border-b border-slate-100">
              <p className="text-xs font-medium text-slate-700 truncate">
                {usuario ? `${usuario.nombre} ${usuario.apellido}` : ''}
              </p>
              <p className="text-2xs text-slate-400 truncate">{usuario?.email}</p>
            </div>
            <div className="p-1">
              {isAdmin && (
                <button onClick={() => router.push('/crm/configuracion')}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-slate-600
                                    hover:bg-slate-50 rounded transition-colors">
                  <Settings className="h-3.5 w-3.5" />
                  Configuración
                </button>
              )}
              <button onClick={logout}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-red-600
                                  hover:bg-red-50 rounded transition-colors">
                <LogOut className="h-3.5 w-3.5" />
                Cerrar sesión
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
