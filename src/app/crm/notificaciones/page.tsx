'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bell, BellRing, AlertOctagon, AlertTriangle,
  Check, ExternalLink, Trash2, CheckCheck, X, Loader2,
} from 'lucide-react'

import { useAuth } from '@/contexts/AuthContext'
import { tieneAccesoTotal } from '@/lib/cartera-filter'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import { emitirBroadcastNotificaciones, useBroadcastNotificaciones } from '@/lib/broadcast-notificaciones'
import { useRealtimeRefresh } from '@/lib/hooks/useRealtimeRefresh'

// ── Tipos ──
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
  usuario_id: string | null
}

interface Resumen {
  total_no_leidas: number
  criticas: number
  advertencias: number
  informativas: number
}

// ── Mapas de labels y colores ──
const TIPO_LABELS: Record<string, { label: string; color: string }> = {
  POLIZA_VENCIDA:               { label: 'Póliza vencida',     color: 'bg-red-50 text-red-700 border-red-200' },
  TAREA_VENCIDA:                { label: 'Tarea vencida',      color: 'bg-orange-50 text-orange-700 border-orange-200' },
  SINIESTRO_30_DIAS:            { label: 'Siniestro +30d',     color: 'bg-amber-50 text-amber-700 border-amber-200' },
  SINIESTRO_60_DIAS:            { label: 'Siniestro +60d',     color: 'bg-red-50 text-red-700 border-red-200' },
  COTIZACION_SIN_RESPUESTA:     { label: 'Cotización',         color: 'bg-blue-50 text-blue-700 border-blue-200' },
  COTIZACION_SIN_SEGUIMIENTO:   { label: 'Cotización',         color: 'bg-blue-50 text-blue-700 border-blue-200' },
  COTIZACION_VENCIENDO_PRONTO:  { label: 'Cotización por vencer', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  COTIZACION_VENCIDA:           { label: 'Cotización vencida', color: 'bg-red-50 text-red-700 border-red-200' },
  OPORTUNIDAD_ESTANCADA:        { label: 'Oportunidad',        color: 'bg-violet-50 text-violet-700 border-violet-200' },
}

const PRIORIDAD_COLORS: Record<string, string> = {
  CRITICA:     'bg-red-50 text-red-700 border-red-200',
  ADVERTENCIA: 'bg-amber-50 text-amber-700 border-amber-200',
  INFORMATIVA: 'bg-blue-50 text-blue-700 border-blue-200',
}

const PRIORIDAD_LABELS: Record<string, string> = {
  CRITICA: 'Crítica',
  ADVERTENCIA: 'Advertencia',
  INFORMATIVA: 'Informativa',
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

function fechaCompleta(fechaStr: string): string {
  const [y, m, d] = fechaStr.split('T')[0].split('-')
  return `${d}/${m}/${y}`
}

const POR_PAGINA = 25

export default function NotificacionesPage() {
  const router = useRouter()
  const { usuario } = useAuth()

  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([])
  const [resumen, setResumen] = useState<Resumen>({ total_no_leidas: 0, criticas: 0, advertencias: 0, informativas: 0 })
  const [totalHistorico, setTotalHistorico] = useState(0)
  const [cargando, setCargando] = useState(true)

  // Filtros
  const [filtroLeida, setFiltroLeida] = useState('')
  const [filtroPrioridad, setFiltroPrioridad] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')

  // Paginación
  const [pagina, setPagina] = useState(0)
  const [totalFiltrado, setTotalFiltrado] = useState(0)

  // Modal limpiar
  const [mostrarModalLimpiar, setMostrarModalLimpiar] = useState(false)

  // ── Cargar datos ──
  const cargarDatos = useCallback(async (silencioso: boolean = false) => {
    if (!silencioso) setCargando(true)

    // Construir query params
    const params = new URLSearchParams()
    params.set('limite', '500') // traer todo para paginar client-side con filtros
    if (filtroLeida) params.set('leida', filtroLeida)
    if (filtroPrioridad) params.set('prioridad', filtroPrioridad)
    if (filtroTipo) params.set('tipo', filtroTipo)

    const r = await apiCall<{ data: Notificacion[]; resumen?: Resumen }>(`/api/notificaciones?${params}`, {}, { mostrar_toast_en_error: false })

    if (r.ok && r.data) {
      const payload = r.data as { data?: Notificacion[]; resumen?: Resumen }
      // Filtrar por usuario si no tiene acceso total
      const filtrarCartera = (lista: Notificacion[]) => {
        if (!usuario || tieneAccesoTotal(usuario)) return lista
        return lista.filter(n => n.usuario_id === usuario.id || n.usuario_id === null)
      }
      const filtradas = filtrarCartera(payload.data ?? [])
      setNotificaciones(filtradas)
      setTotalFiltrado(filtradas.length)
      if (payload.resumen) {
        // Recalcular resumen si se filtró
        if (usuario && !tieneAccesoTotal(usuario)) {
          const noLeidas = filtradas.filter(n => !n.leida)
          setResumen({
            total_no_leidas: noLeidas.length,
            criticas: noLeidas.filter(n => n.prioridad === 'CRITICA').length,
            advertencias: noLeidas.filter(n => n.prioridad === 'ADVERTENCIA').length,
            informativas: noLeidas.filter(n => n.prioridad === 'INFORMATIVA').length,
          })
        } else {
          setResumen(payload.resumen)
        }
      }
    }

    // Contar total real: no leidas + leidas
    const r3 = await apiCall<{ data: Notificacion[] }>('/api/notificaciones?limite=500', {}, { mostrar_toast_en_error: false })
    if (r3.ok && r3.data) {
      const payload3 = r3.data as { data?: Notificacion[] }
      let totalData = (payload3.data ?? []) as Notificacion[]
      if (usuario && !tieneAccesoTotal(usuario)) {
        totalData = totalData.filter(n => n.usuario_id === usuario.id || n.usuario_id === null)
      }
      setTotalHistorico(totalData.length)
    }

    setCargando(false)
  }, [filtroLeida, filtroPrioridad, filtroTipo, usuario])

  useEffect(() => {
    cargarDatos()
  }, [cargarDatos])

  // Realtime: la campana del navbar ya escucha, pero esta pantalla también:
  // el usuario puede tener la página abierta mientras trabaja en otra tab y
  // volver a esta esperando ver los últimos avisos sin refrescar.
  useRealtimeRefresh({
    tablas: ['notificaciones'],
    onCambio: () => cargarDatos(true),
  })

  useEffect(() => {
    setPagina(0)
  }, [filtroLeida, filtroPrioridad, filtroTipo])

  // ── Acciones ──
  const marcarLeida = async (id: string) => {
    await apiCall('/api/notificaciones', { method: 'PATCH', body: { ids: [id] } })
    cargarDatos()
    emitirBroadcastNotificaciones({ tipo: 'marcada-leida', id })
  }

  const marcarTodasLeidas = async () => {
    const r = await apiCall('/api/notificaciones', { method: 'PATCH', body: { todas: true } })
    if (r.ok) toast.exito('Todas las notificaciones marcadas como leídas')
    cargarDatos()
    emitirBroadcastNotificaciones({ tipo: 'todas-leidas' })
  }

  const eliminar = async (id: string) => {
    await apiCall('/api/notificaciones', { method: 'DELETE', body: { ids: [id] } })
    cargarDatos()
    emitirBroadcastNotificaciones({ tipo: 'eliminada', id })
  }

  const limpiarAntiguas = async () => {
    const r = await apiCall('/api/notificaciones', { method: 'DELETE', body: { leidas_antiguas: true, dias: 30 } })
    if (r.ok) toast.exito('Notificaciones antiguas eliminadas')
    setMostrarModalLimpiar(false)
    cargarDatos()
    emitirBroadcastNotificaciones({ tipo: 'eliminadas-antiguas' })
  }

  // ── Sincronización cross-tab ──
  useBroadcastNotificaciones(useCallback(() => { cargarDatos() }, [cargarDatos]))

  const irANotificacion = async (n: Notificacion) => {
    if (!n.leida) {
      await apiCall('/api/notificaciones', { method: 'PATCH', body: { ids: [n.id] } })
    }
    if (n.url) router.push(n.url)
  }

  // Paginación
  const notifPagina = notificaciones.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA)
  const totalPaginas = Math.ceil(totalFiltrado / POR_PAGINA)
  const hayFiltros = filtroLeida || filtroPrioridad || filtroTipo

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-slate-800">Notificaciones</h1>
          <p className="text-xs text-slate-500 mt-0.5">Alertas y avisos del sistema</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-2">
        <div className="kpi-card bg-blue-50 border border-blue-200">
          <span className="kpi-label flex items-center gap-1">
            <BellRing className="h-3.5 w-3.5 text-blue-500" /> No leídas
          </span>
          <span className="kpi-value text-blue-700">{resumen.total_no_leidas}</span>
        </div>
        <div className="kpi-card bg-red-50 border border-red-200">
          <span className="kpi-label flex items-center gap-1">
            <AlertOctagon className="h-3.5 w-3.5 text-red-500" /> Críticas
          </span>
          <span className="kpi-value text-red-700">{resumen.criticas}</span>
        </div>
        <div className="kpi-card bg-amber-50 border border-amber-200">
          <span className="kpi-label flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Advertencias
          </span>
          <span className="kpi-value text-amber-700">{resumen.advertencias}</span>
        </div>
        <div className="kpi-card bg-slate-50 border border-slate-200">
          <span className="kpi-label flex items-center gap-1">
            <Bell className="h-3.5 w-3.5 text-slate-400" /> Total histórico
          </span>
          <span className="kpi-value text-slate-600">{totalHistorico}</span>
          <span className="text-2xs text-slate-500">todas las notificaciones</span>
        </div>
      </div>

      {/* Filtros + Acciones */}
      <div className="flex items-center gap-2 flex-wrap">
        <select value={filtroLeida} onChange={e => setFiltroLeida(e.target.value)} className="form-input h-7 text-xs w-32">
          <option value="">Todas</option>
          <option value="false">No leídas</option>
          <option value="true">Leídas</option>
        </select>
        <select value={filtroPrioridad} onChange={e => setFiltroPrioridad(e.target.value)} className="form-input h-7 text-xs w-36">
          <option value="">Todas las prioridades</option>
          <option value="CRITICA">Crítica</option>
          <option value="ADVERTENCIA">Advertencia</option>
          <option value="INFORMATIVA">Informativa</option>
        </select>
        <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} className="form-input h-7 text-xs w-48">
          <option value="">Todos los tipos</option>
          <option value="POLIZA_VENCIDA">Póliza vencida</option>
          <option value="TAREA_VENCIDA">Tarea vencida</option>
          <option value="SINIESTRO_30_DIAS">Siniestro +30 días</option>
          <option value="SINIESTRO_60_DIAS">Siniestro +60 días</option>
          <option value="COTIZACION_SIN_RESPUESTA">Cotización sin respuesta</option>
          <option value="COTIZACION_SIN_SEGUIMIENTO">Cotización sin seguimiento</option>
          <option value="COTIZACION_VENCIENDO_PRONTO">Cotización por vencer</option>
          <option value="COTIZACION_VENCIDA">Cotización vencida</option>
          <option value="OPORTUNIDAD_ESTANCADA">Oportunidad estancada</option>
        </select>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={marcarTodasLeidas} className="btn-secondary h-7 text-xs flex items-center gap-1 px-2.5">
            <CheckCheck className="h-3.5 w-3.5" /> Marcar todas como leídas
          </button>
          <button onClick={() => setMostrarModalLimpiar(true)} className="h-7 text-xs flex items-center gap-1 px-2.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
            <Trash2 className="h-3.5 w-3.5" /> Limpiar leídas antiguas
          </button>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="crm-table">
          <thead>
            <tr>
              <th className="w-8"></th>
              <th className="w-24">Prioridad</th>
              <th className="w-32">Tipo</th>
              <th>Título y mensaje</th>
              <th className="w-28">Fecha</th>
              <th className="w-28">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr>
                <td colSpan={6} className="text-center py-8">
                  <Loader2 className="h-4 w-4 animate-spin inline-block text-slate-400" />
                </td>
              </tr>
            ) : notifPagina.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-8">
                  <div className="flex flex-col items-center gap-1.5 text-slate-400">
                    <Bell className="h-5 w-5" />
                    <span className="text-xs">
                      {hayFiltros ? 'No hay notificaciones que coincidan con los filtros.' : 'No hay notificaciones'}
                    </span>
                  </div>
                </td>
              </tr>
            ) : notifPagina.map(n => {
              const tipoInfo = TIPO_LABELS[n.tipo] ?? { label: n.tipo, color: 'bg-slate-100 text-slate-600 border-slate-200' }
              const prioColor = PRIORIDAD_COLORS[n.prioridad] ?? ''
              const bgRow = !n.leida
                ? n.prioridad === 'CRITICA' ? 'bg-red-50/50' : 'bg-blue-50/40'
                : ''
              return (
                <tr
                  key={n.id}
                  className={`${bgRow} hover:bg-slate-50 cursor-pointer transition-colors`}
                  onClick={() => irANotificacion(n)}
                >
                  <td className="text-center">
                    {!n.leida && <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />}
                  </td>
                  <td>
                    <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${prioColor}`}>
                      {PRIORIDAD_LABELS[n.prioridad] ?? n.prioridad}
                    </span>
                  </td>
                  <td>
                    <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${tipoInfo.color}`}>
                      {tipoInfo.label}
                    </span>
                  </td>
                  <td className="min-w-0 max-w-2xl">
                    <div className={`text-xs text-slate-700 ${!n.leida ? 'font-semibold' : ''} break-words`}>
                      {n.titulo}
                    </div>
                    <div className="text-2xs text-slate-500 break-words leading-relaxed mt-0.5">
                      {n.mensaje}
                    </div>
                  </td>
                  <td title={fechaCompleta(n.created_at)}>
                    <span className="text-2xs text-slate-500">{tiempoRelativo(n.created_at)}</span>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      {!n.leida && (
                        <button
                          onClick={() => marcarLeida(n.id)}
                          className="btn-tabla-accion-success"
                          title="Marcar como leída"
                        >
                          <Check />
                        </button>
                      )}
                      <button
                        onClick={() => irANotificacion(n)}
                        className="btn-tabla-accion"
                        title="Ir a"
                      >
                        <ExternalLink />
                      </button>
                      <button
                        onClick={() => eliminar(n.id)}
                        className="btn-tabla-accion-danger"
                        title="Eliminar"
                      >
                        <Trash2 />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      {totalPaginas > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Mostrando {pagina * POR_PAGINA + 1}–{Math.min((pagina + 1) * POR_PAGINA, totalFiltrado)} de {totalFiltrado}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPagina(p => p - 1)}
              disabled={pagina === 0}
              className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Anterior
            </button>
            <span className="px-2">Página {pagina + 1} de {totalPaginas}</span>
            <button
              onClick={() => setPagina(p => p + 1)}
              disabled={pagina >= totalPaginas - 1}
              className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}

      {/* Modal limpiar antiguas */}
      {mostrarModalLimpiar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-800">Limpiar notificaciones antiguas</h3>
              <button onClick={() => setMostrarModalLimpiar(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-slate-600 mb-4">
              Se eliminarán todas las notificaciones leídas con más de 30 días de antigüedad. Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setMostrarModalLimpiar(false)} className="btn-secondary h-7 text-xs px-3">
                Cancelar
              </button>
              <button onClick={limpiarAntiguas} className="btn-danger h-7 text-xs px-3">
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
