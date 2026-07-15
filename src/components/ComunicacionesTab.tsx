'use client'

/**
 * Tab "Comunicaciones" reutilizable. Funciona en 3 modos:
 *   - persona_id : historial filtrado por una persona (tab en ficha de persona)
 *   - poliza_id  : historial filtrado por una póliza (tab en ficha de póliza)
 *   - global     : ambos undefined → historial de toda la cartera (pantalla
 *                  central /crm/comunicaciones)
 *
 * En modo global agrega columna "Destinatario" y caja de búsqueda.
 *
 * Lista los emails enviados/encolados/fallidos con filtros básicos, modal de
 * detalle y botón "Reenviar" (que crea un nuevo envío encolado, no reintenta
 * el viejo).
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  Mail, CheckCircle, XCircle, Clock, Eye, MousePointerClick, RefreshCw,
  AlertTriangle, ExternalLink, X, Loader2, Archive, RotateCw, Search,
  ChevronDown, ChevronUp,
} from 'lucide-react'
import { apiCall } from '@/lib/api-client'
import { getSupabaseClient } from '@/lib/supabase/client'

interface Props {
  persona_id?: string
  poliza_id?: string
  refreshKey?: number
  /** Modo global: omite el filtro de entidad y agrega columna "Destinatario". */
  global?: boolean
  /** Si true, el header hace de toggle y el body se colapsa. Default: false. */
  colapsable?: boolean
  /** Estado inicial cuando es colapsable. Default: true (abierto). */
  defaultAbierto?: boolean
}

interface EnvioRow {
  id: string
  plantilla_codigo: string
  destinatario_email: string
  destinatario_nombre: string | null
  asunto: string
  tipo_envio: string
  estado: string
  error_mensaje: string | null
  fecha_creacion: string
  fecha_envio: string | null
  fecha_apertura: string | null
  cantidad_aperturas: number
  cantidad_clicks: number
  fecha_primer_click: string | null
  archivado: boolean
  archivos_adjuntos: Array<{ filename: string; size?: number }> | null
}

function fmtFecha(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) +
    ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

function labelTipo(t: string): string {
  const map: Record<string, string> = {
    // Al asegurado (automáticos del sistema disparados por eventos)
    AUTOMATICO_BIENVENIDA: 'Bienvenida',
    AUTOMATICO_RENOVACION: 'Renovación',
    AUTOMATICO_PORTAL_CLIENTE: 'Portal',
    // Manuales del PAS
    MANUAL: 'Manual',
    MASIVO: 'Masivo',
    NOTIFICACION_INTERNA: 'Interna',
    // Notificaciones al admin (sistema)
    SISTEMA_BACKUP_COMPLETADO: 'Backup OK',
    SISTEMA_BACKUP_FALLIDO: 'Backup falló',
    SISTEMA_BACKUP_SYNC_FALLIDO: 'Backup sync falló',
    SISTEMA_RESTAURACION_INICIADA: 'Restauración iniciada',
    SISTEMA_RESTAURACION_COMPLETADA: 'Restauración OK',
    SISTEMA_RESTAURACION_FALLIDA: 'Restauración falló',
    SISTEMA_PDF_PROCESADO: 'PDF procesado',
    SISTEMA_PDF_FALLIDO: 'PDF falló',
    SISTEMA_EMAIL_AUTOMATICO_FALLIDO: 'Email cliente falló',
    SISTEMA_ERROR_CRITICO: 'Error crítico',
    SISTEMA_SUGERENCIA_CORRECCION_PORTAL: 'Sugerencia del cliente',
    SISTEMA_SOLICITUD_BLANQUEO_PASSWORD: 'Pedido blanqueo password',
    SISTEMA_BLANQUEO_ADMIN_CONFIRMACION: 'Confirmación blanqueo',
    // Autenticación / acceso
    AUTH_RECUPERAR_PASSWORD: 'Reset password',
    AUTH_INVITACION_USUARIO: 'Invitación usuario',
    AUTH_CONFIRMACION_EMAIL: 'Confirmar email',
  }
  return map[t] || t
}

function EstadoBadge({ estado }: { estado: string }) {
  const comun = 'text-2xs font-medium px-1.5 py-0.5 rounded border inline-flex items-center gap-1'
  if (estado === 'ENVIADO') return <span className={`${comun} bg-green-50 text-green-700 border-green-200`}><CheckCircle className="h-2.5 w-2.5" /> Enviado</span>
  if (estado === 'FALLIDO') return <span className={`${comun} bg-red-50 text-red-700 border-red-200`}><XCircle className="h-2.5 w-2.5" /> Fallido</span>
  if (estado === 'ENCOLADO') return <span className={`${comun} bg-amber-50 text-amber-700 border-amber-200`}><Clock className="h-2.5 w-2.5" /> Encolado</span>
  if (estado === 'ENVIANDO') return <span className={`${comun} bg-blue-50 text-blue-700 border-blue-200`}><Loader2 className="h-2.5 w-2.5 animate-spin" /> Enviando</span>
  if (estado === 'EXCLUIDO_BAJA') return <span className={`${comun} bg-slate-100 text-slate-600 border-slate-200`}>Baja</span>
  if (estado === 'EXCLUIDO_NO_MARKETING') return <span className={`${comun} bg-slate-100 text-slate-600 border-slate-200`}>Opt-out</span>
  return <span className={`${comun} bg-slate-100 text-slate-600 border-slate-200`}>{estado}</span>
}

export default function ComunicacionesTab({ persona_id, poliza_id, refreshKey, global = false, colapsable = false, defaultAbierto = true }: Props) {
  const [abierto, setAbierto] = useState(defaultAbierto)
  const [envios, setEnvios] = useState<EnvioRow[]>([])
  const [cargando, setCargando] = useState(true)
  const [incluirArchivados, setIncluirArchivados] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<string>('')
  const [filtroTipo, setFiltroTipo] = useState<string>('')
  const [busqueda, setBusqueda] = useState('')
  const [busquedaDebounce, setBusquedaDebounce] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPaginas, setTotalPaginas] = useState(1)
  const [detalleId, setDetalleId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [reintentando, setReintentando] = useState(false)
  const [reintentarMsg, setReintentarMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)

  // Debounce de la búsqueda libre (solo en modo global)
  useEffect(() => {
    const t = setTimeout(() => setBusquedaDebounce(busqueda), 350)
    return () => clearTimeout(t)
  }, [busqueda])

  const cargar = useCallback(async () => {
    setCargando(true)
    setError('')
    const sp = new URLSearchParams()
    if (poliza_id) sp.set('poliza_id', poliza_id)
    else if (persona_id) sp.set('persona_id', persona_id)
    if (filtroEstado) sp.set('estado', filtroEstado)
    if (filtroTipo) sp.set('tipo', filtroTipo)
    if (incluirArchivados) sp.set('incluir_archivados', 'true')
    if (global && busquedaDebounce) sp.set('busqueda', busquedaDebounce)
    sp.set('page', String(page))
    sp.set('page_size', '25')
    const r = await apiCall<{ envios: EnvioRow[]; total: number; total_paginas: number }>(`/api/comunicaciones/historial?${sp.toString()}`, {}, { mostrar_toast_en_error: false })
    if (r.ok && r.data) {
      setEnvios(r.data.envios || [])
      setTotal(r.data.total || 0)
      setTotalPaginas(r.data.total_paginas || 1)
    } else {
      setError(r.error?.mensaje || 'Error cargando historial')
    }
    setCargando(false)
  }, [persona_id, poliza_id, filtroEstado, filtroTipo, incluirArchivados, page, global, busquedaDebounce])

  useEffect(() => { cargar() }, [cargar])

  useEffect(() => {
    if (refreshKey !== undefined) cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  // Realtime: cuando el cron procesa la cola (ENCOLADO → ENVIANDO → ENVIADO/FALLIDO)
  // o se encola un nuevo email, refrescamos el historial al instante. Stable ref
  // sobre `cargar` para no resuscribir cada vez que cambian filtros/página.
  const cargarRef = useRef(cargar)
  useEffect(() => { cargarRef.current = cargar }, [cargar])

  useEffect(() => {
    if (!global && !persona_id && !poliza_id) return
    const supabase = getSupabaseClient()
    const filtro = poliza_id
      ? `poliza_id=eq.${poliza_id}`
      : persona_id
      ? `persona_id=eq.${persona_id}`
      : undefined
    const claveCanal = poliza_id
      ? `comunicaciones-poliza-${poliza_id}`
      : persona_id
      ? `comunicaciones-persona-${persona_id}`
      : 'comunicaciones-global'

    const canal = supabase
      .channel(claveCanal)
      .on(
        'postgres_changes',
        filtro
          ? { event: '*', schema: 'public', table: 'email_envios', filter: filtro }
          : { event: '*', schema: 'public', table: 'email_envios' },
        () => cargarRef.current(),
      )
      .subscribe()

    return () => { supabase.removeChannel(canal) }
  }, [persona_id, poliza_id, global])

  const envioDetalle = envios.find((e) => e.id === detalleId)

  async function reintentarEnvio(envioId: string) {
    if (!confirm('¿Querés volver a intentar enviar este email? Se va a crear un nuevo envío con los mismos datos.')) return
    setReintentando(true)
    setReintentarMsg(null)
    const r = await apiCall(`/api/comunicaciones/historial/${envioId}/reintentar`, { method: 'POST' }, { mostrar_toast_en_error: false })
    if (r.ok) {
      setReintentarMsg({ tipo: 'ok', texto: 'Email encolado para reenvío' })
      setDetalleId(null)
      await cargar()
    } else {
      setReintentarMsg({ tipo: 'error', texto: r.error?.mensaje || 'No se pudo reencolar el email' })
    }
    setReintentando(false)
    setTimeout(() => setReintentarMsg(null), 4000)
  }

  return (
    <div className="bg-white border border-slate-200 rounded overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 bg-slate-50">
        <button
          type="button"
          onClick={colapsable ? () => setAbierto(v => !v) : undefined}
          className={`flex items-center gap-3 ${colapsable ? 'cursor-pointer' : 'cursor-default'}`}
          disabled={!colapsable}
        >
          <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5" /> Historial de comunicaciones
          </span>
          <span className="text-2xs text-slate-400 normal-case tracking-normal">{total} {total === 1 ? 'email' : 'emails'}</span>
        </button>
        {(!colapsable || abierto) && (<>
        {global && (
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
            <input
              type="text"
              value={busqueda}
              onChange={e => { setPage(1); setBusqueda(e.target.value) }}
              placeholder="Buscar por destinatario o asunto..."
              className="search-input w-full pl-6 text-2xs h-6"
            />
          </div>
        )}
        <div className="flex items-center gap-2">
          <select
            value={filtroEstado}
            onChange={(e) => { setPage(1); setFiltroEstado(e.target.value) }}
            className="form-input text-2xs h-6 px-1.5 py-0"
          >
            <option value="">Todos los estados</option>
            <option value="ENVIADO">Enviado</option>
            <option value="ENCOLADO">Encolado</option>
            <option value="FALLIDO">Fallido</option>
            <option value="EXCLUIDO_BAJA">Excluido (baja)</option>
            <option value="EXCLUIDO_NO_MARKETING">Excluido (opt-out)</option>
          </select>
          <select
            value={filtroTipo}
            onChange={(e) => { setPage(1); setFiltroTipo(e.target.value) }}
            className="form-input text-2xs h-6 px-1.5 py-0"
          >
            <option value="">Todos los tipos</option>
            <optgroup label="Al asegurado (automáticos)">
              <option value="AUTOMATICO_BIENVENIDA">Bienvenida</option>
              <option value="AUTOMATICO_RENOVACION">Renovación</option>
              <option value="AUTOMATICO_PORTAL_CLIENTE">Portal cliente</option>
            </optgroup>
            <optgroup label="Del PAS (manuales)">
              <option value="MANUAL">Manual desde ficha</option>
              <option value="MASIVO">Masivo / campaña</option>
            </optgroup>
            <optgroup label="Al admin (sistema)">
              <option value="SISTEMA_BACKUP_COMPLETADO">Backup OK</option>
              <option value="SISTEMA_BACKUP_FALLIDO">Backup falló</option>
              <option value="SISTEMA_BACKUP_SYNC_FALLIDO">Backup sync falló</option>
              <option value="SISTEMA_RESTAURACION_INICIADA">Restauración iniciada</option>
              <option value="SISTEMA_RESTAURACION_COMPLETADA">Restauración OK</option>
              <option value="SISTEMA_RESTAURACION_FALLIDA">Restauración falló</option>
              <option value="SISTEMA_PDF_PROCESADO">PDF procesado</option>
              <option value="SISTEMA_PDF_FALLIDO">PDF falló</option>
              <option value="SISTEMA_EMAIL_AUTOMATICO_FALLIDO">Email al cliente falló</option>
              <option value="SISTEMA_ERROR_CRITICO">Error crítico</option>
              <option value="SISTEMA_SUGERENCIA_CORRECCION_PORTAL">Sugerencia del cliente</option>
            </optgroup>
            <optgroup label="Autenticación">
              <option value="AUTH_RECUPERAR_PASSWORD">Reset password</option>
              <option value="AUTH_INVITACION_USUARIO">Invitación usuario</option>
              <option value="AUTH_CONFIRMACION_EMAIL">Confirmar email</option>
            </optgroup>
          </select>
          <label className="flex items-center gap-1 text-2xs text-slate-500 cursor-pointer">
            <input type="checkbox" checked={incluirArchivados} onChange={(e) => { setPage(1); setIncluirArchivados(e.target.checked) }} />
            Incluir archivados
          </label>
          <button onClick={cargar} className="p-1 rounded hover:bg-slate-200 text-slate-500" title="Refrescar">
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
        </>)}
        {colapsable && (
          <button
            type="button"
            onClick={() => setAbierto(v => !v)}
            className="ml-auto p-1 rounded hover:bg-slate-200 text-slate-400"
            title={abierto ? 'Contraer' : 'Expandir'}
          >
            {abierto ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      {(!colapsable || abierto) && (<>
      {error && (
        <div className="px-3 py-2 text-xs text-red-600 bg-red-50 border-b border-red-200 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5" /> {error}
        </div>
      )}

      {reintentarMsg && (
        <div className={`px-3 py-2 text-xs border-b flex items-center gap-2 ${
          reintentarMsg.tipo === 'ok'
            ? 'text-green-700 bg-green-50 border-green-200'
            : 'text-red-600 bg-red-50 border-red-200'
        }`}>
          {reintentarMsg.tipo === 'ok' ? <CheckCircle className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          {reintentarMsg.texto}
        </div>
      )}

      {cargando ? (
        <div className="py-8 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400 mx-auto" />
        </div>
      ) : envios.length === 0 ? (
        <div className="py-8 text-center">
          <Mail className="h-8 w-8 text-slate-300 mx-auto mb-2" />
          <p className="text-xs text-slate-500">Sin emails {filtroEstado || filtroTipo ? 'con estos filtros' : 'todavía'}.</p>
        </div>
      ) : (
        <table className="crm-table">
          <thead>
            <tr>
              <th className="text-2xs">Fecha</th>
              {global && <th className="text-2xs">Destinatario</th>}
              <th className="text-2xs">Asunto</th>
              <th className="text-2xs">Tipo</th>
              <th className="text-2xs">Estado</th>
              <th className="text-2xs">Tracking</th>
              <th className="text-2xs text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {envios.map((e) => (
              <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="text-xs text-slate-700 font-mono">
                  {fmtFecha(e.fecha_envio || e.fecha_creacion)}
                  {e.archivado && <Archive className="inline h-3 w-3 ml-1 text-slate-400" />}
                </td>
                {global && (
                  <td className="text-xs text-slate-700 truncate max-w-[180px]" title={`${e.destinatario_nombre ?? ''} <${e.destinatario_email}>`}>
                    <div className="font-medium">{e.destinatario_nombre || '—'}</div>
                    <div className="text-2xs text-slate-500 truncate">{e.destinatario_email}</div>
                  </td>
                )}
                <td className="text-xs text-slate-700 truncate max-w-xs" title={e.asunto}>
                  {e.asunto || <span className="italic text-slate-400">(sin asunto)</span>}
                </td>
                <td className="text-xs text-slate-600">{labelTipo(e.tipo_envio)}</td>
                <td><EstadoBadge estado={e.estado} /></td>
                <td className="text-2xs text-slate-600">
                  {e.cantidad_aperturas > 0 && (
                    <span className="inline-flex items-center gap-1 mr-2" title={`Abierto ${e.cantidad_aperturas}x`}>
                      <Eye className="h-3 w-3" /> {e.cantidad_aperturas}
                    </span>
                  )}
                  {e.cantidad_clicks > 0 && (
                    <span className="inline-flex items-center gap-1" title={`${e.cantidad_clicks} clicks`}>
                      <MousePointerClick className="h-3 w-3" /> {e.cantidad_clicks}
                    </span>
                  )}
                  {e.cantidad_aperturas === 0 && e.cantidad_clicks === 0 && '—'}
                </td>
                <td className="text-right">
                  <button
                    onClick={() => setDetalleId(e.id)}
                    className="text-2xs text-blue-600 hover:underline inline-flex items-center gap-0.5"
                  >
                    <ExternalLink className="h-3 w-3" /> Ver detalle
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {totalPaginas > 1 && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 text-2xs">
          <span className="text-slate-500">Página {page} de {totalPaginas}</span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="btn-secondary px-2 py-0.5 disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              onClick={() => setPage(Math.min(totalPaginas, page + 1))}
              disabled={page === totalPaginas}
              className="btn-secondary px-2 py-0.5 disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
      </>)}

      {/* Modal detalle */}
      {envioDetalle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetalleId(null)}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-800">Detalle del email</h2>
              <button onClick={() => setDetalleId(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3 text-xs">
              <div>
                <p className="text-2xs text-slate-500 uppercase font-medium">Destinatario</p>
                <p className="text-slate-800">{envioDetalle.destinatario_nombre || '—'} &lt;{envioDetalle.destinatario_email}&gt;</p>
              </div>
              <div>
                <p className="text-2xs text-slate-500 uppercase font-medium">Asunto</p>
                <p className="text-slate-800">{envioDetalle.asunto || '(sin asunto)'}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-2xs text-slate-500 uppercase font-medium">Tipo</p>
                  <p className="text-slate-800">{labelTipo(envioDetalle.tipo_envio)}</p>
                </div>
                <div>
                  <p className="text-2xs text-slate-500 uppercase font-medium">Estado</p>
                  <EstadoBadge estado={envioDetalle.estado} />
                </div>
              </div>
              <div className="border-t border-slate-200 pt-3">
                <p className="text-2xs text-slate-500 uppercase font-medium mb-1">Timeline</p>
                <ul className="space-y-1 text-slate-700">
                  <li>Encolado: {fmtFecha(envioDetalle.fecha_creacion)}</li>
                  {envioDetalle.fecha_envio && <li>Enviado: {fmtFecha(envioDetalle.fecha_envio)}</li>}
                  {envioDetalle.fecha_apertura && (
                    <li>Primera apertura: {fmtFecha(envioDetalle.fecha_apertura)} ({envioDetalle.cantidad_aperturas}x)</li>
                  )}
                  {envioDetalle.fecha_primer_click && (
                    <li>Primer click: {fmtFecha(envioDetalle.fecha_primer_click)} ({envioDetalle.cantidad_clicks} clicks)</li>
                  )}
                  {envioDetalle.error_mensaje && (
                    <li className="text-red-600">Error: {envioDetalle.error_mensaje}</li>
                  )}
                </ul>
              </div>
              {envioDetalle.archivos_adjuntos && envioDetalle.archivos_adjuntos.length > 0 && (
                <div className="border-t border-slate-200 pt-3">
                  <p className="text-2xs text-slate-500 uppercase font-medium mb-1">Adjuntos enviados</p>
                  <ul className="list-disc pl-5 text-slate-700">
                    {envioDetalle.archivos_adjuntos.map((a, i) => (
                      <li key={i}>{a.filename}</li>
                    ))}
                  </ul>
                </div>
              )}
              {envioDetalle.archivado && (
                <div className="border-t border-slate-200 pt-3 text-slate-500 italic">
                  Este email fue archivado por política de retención. Solo quedó la metadata.
                </div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 bg-slate-50">
              <div className="text-2xs text-slate-500">
                {envioDetalle.estado === 'FALLIDO' && 'Podés reintentar el envío creando un nuevo registro.'}
              </div>
              <div className="flex items-center gap-2">
                {envioDetalle.estado === 'FALLIDO' && (
                  <button
                    onClick={() => reintentarEnvio(envioDetalle.id)}
                    disabled={reintentando}
                    className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {reintentando ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
                    Reintentar envío
                  </button>
                )}
                <button onClick={() => setDetalleId(null)} className="btn-secondary text-xs px-3 py-1.5">
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
