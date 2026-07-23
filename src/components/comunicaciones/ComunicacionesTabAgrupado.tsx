'use client'

/**
 * Vista agrupada del historial de comunicaciones (solo en /crm/comunicaciones).
 *
 * Cada fila representa una campaña/envío masivo con sus métricas, o un envío
 * individual (MANUAL, AUTOMATICO_*, etc.) como fila propia. Las campañas se
 * pueden expandir para ver los N destinatarios individuales.
 *
 * En las fichas de persona/póliza se usa `ComunicacionesTab` (plano) porque
 * ahí lo importante es "qué mails recibió este cliente" — no tiene sentido
 * agrupar por campaña. Este componente es exclusivo del historial global.
 */

import { useState, useEffect, useCallback, Fragment } from 'react'
import {
  Send, Eye, MousePointerClick, ChevronDown, ChevronRight,
  Users, User, CheckCircle2, XCircle, Clock, AlertTriangle,
  Search, ChevronLeft, RefreshCw,
} from 'lucide-react'
import { apiCall } from '@/lib/api-client'

function formatearFechaHora(iso: string): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yy = String(d.getFullYear()).slice(2)
    const hh = String(d.getHours()).padStart(2, '0')
    const mi = String(d.getMinutes()).padStart(2, '0')
    return `${dd}/${mm}/${yy} ${hh}:${mi}`
  } catch {
    return iso
  }
}

interface FilaAgrupada {
  es_grupo: boolean
  id: string
  tipo: string
  titulo: string
  asunto?: string
  estado_grupo?: string
  total: number
  enviados: number
  fallidos: number
  excluidos: number
  fecha: string
  fecha_fin?: string | null
  destinatario_email?: string
  destinatario_nombre?: string | null
  cantidad_aperturas?: number
  cantidad_clicks?: number
  persona_id?: string | null
  poliza_id?: string | null
}

interface Destinatario {
  id: string
  destinatario_email: string
  destinatario_nombre: string | null
  asunto: string
  estado: string
  error_mensaje: string | null
  fecha_creacion: string
  fecha_envio: string | null
  cantidad_aperturas: number
  cantidad_clicks: number
  persona_id: string | null
  poliza_id: string | null
}

interface RespuestaAgrupados {
  ok: boolean
  filas: FilaAgrupada[]
  total: number
  page: number
  page_size: number
  total_paginas: number
}

const PAGE_SIZE = 25

function labelTipo(tipo: string): { label: string; color: string } {
  switch (tipo) {
    case 'campana':
      return { label: 'Campaña', color: 'bg-violet-100 text-violet-800 border-violet-200' }
    case 'MASIVO':
      return { label: 'Masivo', color: 'bg-blue-100 text-blue-800 border-blue-200' }
    case 'MANUAL':
      return { label: 'Manual', color: 'bg-slate-100 text-slate-800 border-slate-200' }
    case 'AUTOMATICO_BIENVENIDA':
      return { label: 'Auto — bienvenida', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' }
    case 'AUTOMATICO_RENOVACION':
      return { label: 'Auto — renovación', color: 'bg-amber-100 text-amber-800 border-amber-200' }
    case 'AUTOMATICO_PORTAL_CLIENTE':
      return { label: 'Auto — portal', color: 'bg-sky-100 text-sky-800 border-sky-200' }
    case 'NOTIFICACION_INTERNA':
      return { label: 'Notif interna', color: 'bg-slate-100 text-slate-700 border-slate-200' }
    default:
      if (tipo.startsWith('SISTEMA_')) return { label: 'Sistema', color: 'bg-slate-100 text-slate-700 border-slate-200' }
      if (tipo.startsWith('AUTH_')) return { label: 'Auth', color: 'bg-indigo-100 text-indigo-800 border-indigo-200' }
      return { label: tipo, color: 'bg-slate-100 text-slate-800 border-slate-200' }
  }
}

function estadoBadge(estado: string): { label: string; color: string } {
  switch (estado) {
    case 'ENVIADO': return { label: 'Enviado', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' }
    case 'FALLIDO': return { label: 'Fallido', color: 'text-red-700 bg-red-50 border-red-200' }
    case 'ENCOLADO': return { label: 'En cola', color: 'text-amber-700 bg-amber-50 border-amber-200' }
    case 'ENVIANDO': return { label: 'Enviando', color: 'text-blue-700 bg-blue-50 border-blue-200' }
    case 'EXCLUIDO_BAJA': return { label: 'Baja', color: 'text-slate-600 bg-slate-50 border-slate-200' }
    case 'EXCLUIDO_NO_MARKETING': return { label: 'Opt-out', color: 'text-slate-600 bg-slate-50 border-slate-200' }
    case 'COMPLETADA': return { label: 'Completada', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' }
    case 'EJECUTANDO': return { label: 'Ejecutando', color: 'text-blue-700 bg-blue-50 border-blue-200' }
    case 'PROGRAMADA': return { label: 'Programada', color: 'text-amber-700 bg-amber-50 border-amber-200' }
    case 'BORRADOR': return { label: 'Borrador', color: 'text-slate-600 bg-slate-50 border-slate-200' }
    case 'PAUSADA': return { label: 'Pausada', color: 'text-amber-700 bg-amber-50 border-amber-200' }
    case 'CANCELADA': return { label: 'Cancelada', color: 'text-slate-600 bg-slate-50 border-slate-200' }
    default: return { label: estado, color: 'text-slate-600 bg-slate-50 border-slate-200' }
  }
}

export default function ComunicacionesTabAgrupado() {
  const [tipoGrupo, setTipoGrupo] = useState<'todos' | 'campana' | 'individual'>('todos')
  const [busqueda, setBusqueda] = useState('')
  const [busquedaAplicada, setBusquedaAplicada] = useState('')
  const [page, setPage] = useState(1)
  const [datos, setDatos] = useState<RespuestaAgrupados | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandido, setExpandido] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    const params = new URLSearchParams()
    params.set('tipo_grupo', tipoGrupo)
    params.set('page', String(page))
    params.set('page_size', String(PAGE_SIZE))
    if (busquedaAplicada) params.set('busqueda', busquedaAplicada)
    const r = await apiCall<RespuestaAgrupados>(`/api/comunicaciones/agrupados?${params.toString()}`, undefined, { mostrar_toast_en_error: false })
    if (r.ok && r.data) {
      setDatos(r.data)
    } else {
      setError(r.error?.mensaje || 'No se pudieron cargar las comunicaciones')
    }
    setCargando(false)
  }, [tipoGrupo, page, busquedaAplicada])

  useEffect(() => { cargar() }, [cargar])

  // Debounce búsqueda
  useEffect(() => {
    const t = setTimeout(() => {
      setBusquedaAplicada(busqueda.trim())
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [busqueda])

  const filas = datos?.filas ?? []

  return (
    <div className="flex flex-col gap-3">
      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por nombre, asunto o destinatario..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="search-input pl-8 w-full"
          />
        </div>
        <select
          value={tipoGrupo}
          onChange={e => { setTipoGrupo(e.target.value as any); setPage(1) }}
          className="form-input text-xs h-8 w-auto"
        >
          <option value="todos">Todos los envíos</option>
          <option value="campana">Solo campañas / masivos</option>
          <option value="individual">Solo envíos individuales</option>
        </select>
        <button onClick={cargar} className="btn-secondary flex items-center gap-1 text-xs" title="Actualizar">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Info */}
      <div className="text-xs text-slate-600">
        {cargando ? 'Cargando...' : datos ? (
          <>
            {datos.total.toLocaleString('es-AR')} {datos.total === 1 ? 'envío' : 'envíos'} — página {datos.page} de {datos.total_paginas || 1}
            <span className="ml-2 text-slate-500">
              (envíos masivos aparecen como <strong>1 fila expandible</strong> con sus N destinatarios adentro)
            </span>
          </>
        ) : null}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-800 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Tabla */}
      <div className="crm-table rounded border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600 border-b border-slate-200">
            <tr>
              <th className="w-6"></th>
              <th className="px-3 py-2 text-left font-medium">Fecha</th>
              <th className="px-3 py-2 text-left font-medium">Tipo</th>
              <th className="px-3 py-2 text-left font-medium">Título / Destinatario</th>
              <th className="px-3 py-2 text-left font-medium">Asunto</th>
              <th className="px-3 py-2 text-center font-medium">Total</th>
              <th className="px-3 py-2 text-center font-medium">Estado</th>
              <th className="px-3 py-2 text-center font-medium">Métricas</th>
            </tr>
          </thead>
          <tbody>
            {cargando && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-xs text-slate-500">Cargando...</td></tr>
            )}
            {!cargando && filas.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-xs text-slate-500">Sin envíos en este período.</td></tr>
            )}
            {!cargando && filas.map((f) => {
              const t = labelTipo(f.tipo)
              const est = f.estado_grupo ? estadoBadge(f.estado_grupo) : null
              const abierto = f.es_grupo && expandido === f.id
              return (
                <Fragment key={f.id}>
                  <tr className={`border-b border-slate-100 hover:bg-slate-50 ${abierto ? 'bg-slate-50' : ''}`}>
                    <td className="w-6 text-center">
                      {f.es_grupo ? (
                        <button
                          onClick={() => setExpandido(abierto ? null : f.id)}
                          className="p-1 hover:bg-slate-200 rounded"
                          title={abierto ? 'Cerrar' : 'Ver destinatarios'}
                        >
                          {abierto ? <ChevronDown className="h-3.5 w-3.5 text-slate-600" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-600" />}
                        </button>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-700">
                      {formatearFechaHora(f.fecha)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-2xs font-medium ${t.color}`}>
                        {f.es_grupo ? <Users className="h-3 w-3" /> : <User className="h-3 w-3" />}
                        {t.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-800">
                      <div className="font-medium">{f.titulo}</div>
                      {!f.es_grupo && f.destinatario_email && (
                        <div className="text-slate-500">{f.destinatario_email}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600 max-w-[300px] truncate" title={f.asunto ?? ''}>
                      {f.asunto || '—'}
                    </td>
                    <td className="px-3 py-2 text-center text-xs font-mono">
                      {f.total.toLocaleString('es-AR')}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {est && (
                        <span className={`inline-block rounded border px-2 py-0.5 text-2xs font-medium ${est.color}`}>
                          {est.label}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center text-xs">
                      <div className="flex items-center justify-center gap-2 text-slate-600">
                        {f.enviados > 0 && (
                          <span className="inline-flex items-center gap-0.5" title="Enviados">
                            <CheckCircle2 className="h-3 w-3 text-emerald-500" /> {f.enviados}
                          </span>
                        )}
                        {f.fallidos > 0 && (
                          <span className="inline-flex items-center gap-0.5" title="Fallidos">
                            <XCircle className="h-3 w-3 text-red-500" /> {f.fallidos}
                          </span>
                        )}
                        {!f.es_grupo && (f.cantidad_aperturas ?? 0) > 0 && (
                          <span className="inline-flex items-center gap-0.5" title="Aperturas">
                            <Eye className="h-3 w-3 text-blue-500" /> {f.cantidad_aperturas}
                          </span>
                        )}
                        {!f.es_grupo && (f.cantidad_clicks ?? 0) > 0 && (
                          <span className="inline-flex items-center gap-0.5" title="Clicks">
                            <MousePointerClick className="h-3 w-3 text-violet-500" /> {f.cantidad_clicks}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                  {abierto && (
                    <tr>
                      <td colSpan={8} className="bg-slate-50 border-b border-slate-200 p-0">
                        <PanelDestinatarios campanaId={f.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      {datos && datos.total_paginas > 1 && (
        <div className="flex items-center justify-between text-xs">
          <div className="text-slate-600">
            Página {page} de {datos.total_paginas}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="btn-secondary flex items-center gap-1 disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Anterior
            </button>
            <button
              onClick={() => setPage(p => Math.min(datos.total_paginas, p + 1))}
              disabled={page >= datos.total_paginas}
              className="btn-secondary flex items-center gap-1 disabled:opacity-40"
            >
              Siguiente <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------
// Panel de destinatarios (lazy) — se muestra al expandir una campaña
// -----------------------------------------------------------------------------

function PanelDestinatarios({ campanaId }: { campanaId: string }) {
  const [destinatarios, setDestinatarios] = useState<Destinatario[] | null>(null)
  const [cargando, setCargando] = useState(true)
  const [filtroEstado, setFiltroEstado] = useState<string>('')
  const [busq, setBusq] = useState('')
  const [busqAplicada, setBusqAplicada] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPaginas, setTotalPaginas] = useState(1)

  const cargar = useCallback(async () => {
    setCargando(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('page_size', '25')
    if (filtroEstado) params.set('estado', filtroEstado)
    if (busqAplicada) params.set('busqueda', busqAplicada)
    const r = await apiCall<{ destinatarios: Destinatario[]; total: number; total_paginas: number }>(
      `/api/comunicaciones/agrupados/${campanaId}/destinatarios?${params.toString()}`,
      undefined,
      { mostrar_toast_en_error: false },
    )
    if (r.ok && r.data) {
      setDestinatarios(r.data.destinatarios)
      setTotal(r.data.total)
      setTotalPaginas(r.data.total_paginas)
    }
    setCargando(false)
  }, [campanaId, page, filtroEstado, busqAplicada])

  useEffect(() => { cargar() }, [cargar])

  useEffect(() => {
    const t = setTimeout(() => { setBusqAplicada(busq.trim()); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [busq])

  return (
    <div className="p-3">
      <div className="flex items-center gap-2 mb-2">
        <div className="text-2xs uppercase font-semibold text-slate-500 tracking-wide">
          Destinatarios ({total.toLocaleString('es-AR')})
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            placeholder="Buscar email o nombre..."
            value={busq}
            onChange={e => setBusq(e.target.value)}
            className="search-input h-7 text-xs w-44"
          />
          <select
            value={filtroEstado}
            onChange={e => { setFiltroEstado(e.target.value); setPage(1) }}
            className="form-input h-7 text-xs w-auto"
          >
            <option value="">Todos los estados</option>
            <option value="ENVIADO">Enviados</option>
            <option value="FALLIDO">Fallidos</option>
            <option value="EXCLUIDO_BAJA">Excluidos por baja</option>
            <option value="EXCLUIDO_NO_MARKETING">Opt-out marketing</option>
          </select>
        </div>
      </div>

      {cargando && <div className="text-xs text-slate-500 py-3 text-center">Cargando destinatarios...</div>}

      {!cargando && destinatarios && destinatarios.length === 0 && (
        <div className="text-xs text-slate-500 py-3 text-center">Sin destinatarios que coincidan con el filtro.</div>
      )}

      {!cargando && destinatarios && destinatarios.length > 0 && (
        <>
          <div className="border border-slate-200 rounded overflow-hidden bg-white">
            <table className="w-full text-xs">
              <thead className="bg-white text-2xs uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">Destinatario</th>
                  <th className="px-3 py-1.5 text-left font-medium">Estado</th>
                  <th className="px-3 py-1.5 text-center font-medium">Envío</th>
                  <th className="px-3 py-1.5 text-center font-medium">Aperturas</th>
                  <th className="px-3 py-1.5 text-center font-medium">Clicks</th>
                  <th className="px-3 py-1.5 text-left font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {destinatarios.map(d => {
                  const est = estadoBadge(d.estado)
                  return (
                    <tr key={d.id} className="border-b border-slate-100">
                      <td className="px-3 py-1.5">
                        <div className="text-slate-800">{d.destinatario_nombre || d.destinatario_email}</div>
                        {d.destinatario_nombre && (
                          <div className="text-2xs text-slate-500">{d.destinatario_email}</div>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <span className={`inline-block rounded border px-1.5 py-0.5 text-2xs font-medium ${est.color}`}>
                          {est.label}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-center text-slate-600 whitespace-nowrap text-2xs">
                        {d.fecha_envio ? formatearFechaHora(d.fecha_envio) : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        {d.cantidad_aperturas > 0 ? (
                          <span className="inline-flex items-center gap-0.5 text-blue-700">
                            <Eye className="h-3 w-3" /> {d.cantidad_aperturas}
                          </span>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        {d.cantidad_clicks > 0 ? (
                          <span className="inline-flex items-center gap-0.5 text-violet-700">
                            <MousePointerClick className="h-3 w-3" /> {d.cantidad_clicks}
                          </span>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-1.5 text-slate-600 max-w-[280px] truncate" title={d.error_mensaje ?? ''}>
                        {d.error_mensaje || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {totalPaginas > 1 && (
            <div className="flex items-center justify-between text-2xs mt-2 text-slate-600">
              <div>Página {page} de {totalPaginas}</div>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="btn-secondary text-xs disabled:opacity-40">Anterior</button>
                <button onClick={() => setPage(p => Math.min(totalPaginas, p + 1))} disabled={page >= totalPaginas} className="btn-secondary text-xs disabled:opacity-40">Siguiente</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
