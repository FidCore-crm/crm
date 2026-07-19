'use client'

/**
 * Modal con el detalle completo de una actualización del historial.
 *
 * Muestra:
 *   - Versión anterior → nueva
 *   - Estado + fechas (solicitud, inicio, fin, duración)
 *   - Changelog renderizado (markdown ligero)
 *   - Error si falló
 *   - Log completo del script (técnico, colapsable)
 *   - Botón "Marcar como fallida" si está stuck en EJECUTANDO/PROGRAMADA
 */

import { useState, useEffect } from 'react'
import {
  X, Loader2, CheckCircle2, XCircle, Clock, AlertCircle,
  Terminal, FileText, Calendar, Activity, ShieldAlert, Download,
} from 'lucide-react'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import { ChangelogViewer } from './ChangelogViewer'
import type { ActualizacionRow, EstadoActualizacion } from './tipos'

interface Props {
  id: string
  onCerrar: () => void
  onCambioEstado?: () => void
}

const ESTADO_META: Record<EstadoActualizacion, { label: string; color: string; icon: any }> = {
  PROGRAMADA:  { label: 'Programada',  color: 'text-amber-700 bg-amber-50 border-amber-200', icon: Clock },
  EJECUTANDO:  { label: 'En curso',    color: 'text-blue-700 bg-blue-50 border-blue-200',    icon: Loader2 },
  COMPLETADA:  { label: 'Completada',  color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: CheckCircle2 },
  FALLIDA:     { label: 'Fallida',     color: 'text-red-700 bg-red-50 border-red-200',       icon: XCircle },
  CANCELADA:   { label: 'Cancelada',   color: 'text-slate-600 bg-slate-50 border-slate-200', icon: AlertCircle },
}

function formatFecha(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'medium' })
}

function calcularDuracion(inicio: string | null, fin: string | null): string {
  if (!inicio || !fin) return '—'
  const ms = new Date(fin).getTime() - new Date(inicio).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

export function ModalDetalle({ id, onCerrar, onCambioEstado }: Props) {
  const [data, setData] = useState<ActualizacionRow | null>(null)
  const [cargando, setCargando] = useState(true)
  const [mostrarLog, setMostrarLog] = useState(false)
  const [forzando, setForzando] = useState(false)

  useEffect(() => {
    let cancelado = false
    const cargar = async () => {
      const r = await apiCall<ActualizacionRow>(`/api/actualizaciones/${id}`, {}, {
        mostrar_toast_en_error: false,
      })
      if (cancelado) return
      if (r.ok) setData(r.data!)
      setCargando(false)
    }
    cargar()
    return () => { cancelado = true }
  }, [id])

  const forzarCierre = async () => {
    if (!confirm('¿Marcar como fallida? Solo hacelo si la actualización está stuck y NO hay ningún proceso corriendo en el servidor. Esta acción libera la fila para que puedas reintentar.')) {
      return
    }
    setForzando(true)
    const r = await apiCall(`/api/actualizaciones/${id}/forzar-cierre`, { method: 'POST' })
    setForzando(false)
    if (r.ok) {
      toast.exito('Actualización marcada como fallida')
      onCambioEstado?.()
      onCerrar()
    }
  }

  if (cargando || !data) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-lg shadow-xl p-10 flex items-center gap-3 text-sm text-slate-600">
          <Loader2 className="h-5 w-5 animate-spin" /> Cargando detalle...
        </div>
      </div>
    )
  }

  const meta = ESTADO_META[data.estado] ?? ESTADO_META.COMPLETADA
  const IconEstado = meta.icon
  const esStuck = data.estado === 'EJECUTANDO' || data.estado === 'PROGRAMADA'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-600" />
            Detalle de actualización
          </h3>
          <button onClick={onCerrar} className="text-slate-500 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body scroll */}
        <div className="overflow-y-auto px-5 py-4 space-y-4 flex-1">
          {/* Versión + estado */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm">
              <span className="font-mono text-slate-600">v{data.version_anterior}</span>
              <span className="mx-2 text-slate-500">→</span>
              <span className="font-mono font-semibold text-slate-800">v{data.version_nueva}</span>
            </div>
            <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded border ${meta.color}`}>
              <IconEstado className={`h-3.5 w-3.5 ${data.estado === 'EJECUTANDO' ? 'animate-spin' : ''}`} />
              {meta.label}
            </span>
          </div>

          {/* Grid de fechas/duración */}
          <div className="grid grid-cols-2 gap-3 bg-slate-50 border border-slate-200 rounded p-3 text-xs">
            <div>
              <p className="text-slate-600 mb-0.5 flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Solicitada
              </p>
              <p className="text-slate-800 font-mono">{formatFecha(data.fecha_solicitud)}</p>
            </div>
            {data.programada_para && (
              <div>
                <p className="text-slate-600 mb-0.5">Programada para</p>
                <p className="text-slate-800 font-mono">{formatFecha(data.programada_para)}</p>
              </div>
            )}
            <div>
              <p className="text-slate-600 mb-0.5">Inicio ejecución</p>
              <p className="text-slate-800 font-mono">{formatFecha(data.fecha_inicio_ejecucion)}</p>
            </div>
            <div>
              <p className="text-slate-600 mb-0.5">Fin ejecución</p>
              <p className="text-slate-800 font-mono">{formatFecha(data.fecha_fin_ejecucion)}</p>
            </div>
            <div>
              <p className="text-slate-600 mb-0.5 flex items-center gap-1">
                <Activity className="h-3 w-3" /> Duración
              </p>
              <p className="text-slate-800 font-mono">
                {calcularDuracion(data.fecha_inicio_ejecucion, data.fecha_fin_ejecucion)}
              </p>
            </div>
          </div>

          {/* Error */}
          {data.error_mensaje && (
            <div className="bg-red-50 border border-red-200 rounded p-3">
              <p className="text-xs font-semibold text-red-900 mb-1 flex items-center gap-1">
                <XCircle className="h-3.5 w-3.5" /> Error
              </p>
              <p className="text-xs text-red-800 whitespace-pre-wrap">{data.error_mensaje}</p>
            </div>
          )}

          {/* Changelog */}
          <div>
            <p className="text-xs font-semibold text-slate-600 mb-2">Qué trajo esta versión:</p>
            <div className="bg-white border border-slate-200 rounded p-3 max-h-72 overflow-y-auto">
              <ChangelogViewer texto={data.changelog ?? ''} />
            </div>
          </div>

          {/* Log técnico */}
          {data.log_completo && (
            <div>
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setMostrarLog(!mostrarLog)}
                  className="text-xs font-semibold text-slate-600 hover:text-slate-800 flex items-center gap-1"
                >
                  <Terminal className="h-3.5 w-3.5" />
                  Log técnico {mostrarLog ? '▲' : '▼'}
                </button>
                <button
                  onClick={() => {
                    const blob = new Blob([data.log_completo ?? ''], { type: 'text/plain' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `fidcore-update-${data.version_anterior}-to-${data.version_nueva}-${data.id.slice(0, 8)}.log`
                    document.body.appendChild(a)
                    a.click()
                    document.body.removeChild(a)
                    URL.revokeObjectURL(url)
                  }}
                  className="text-2xs text-slate-600 hover:text-slate-700 flex items-center gap-1"
                  title="Descargar log completo (.log)"
                >
                  <Download className="h-3 w-3" />
                  Descargar
                </button>
              </div>
              {mostrarLog && (
                <pre className="mt-2 bg-slate-900 text-slate-100 text-2xs font-mono rounded p-3 max-h-80 overflow-auto whitespace-pre-wrap leading-relaxed">
                  {data.log_completo}
                </pre>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-slate-200 shrink-0">
          {esStuck ? (
            <button
              onClick={forzarCierre}
              disabled={forzando}
              className="btn-danger flex items-center gap-1 text-xs"
              title="Solo usar si la actualización quedó stuck sin terminar"
            >
              {forzando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldAlert className="h-3.5 w-3.5" />}
              Marcar como fallida
            </button>
          ) : <span />}
          <button onClick={onCerrar} className="btn-secondary">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
