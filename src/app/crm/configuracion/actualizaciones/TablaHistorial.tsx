'use client'

/**
 * Tabla con el historial de actualizaciones aplicadas.
 *
 * Mejoras:
 *   - Click en fila abre ModalDetalle con changelog + log_completo.
 *   - Detecta filas EJECUTANDO stuck (sin avance >15 min) y las marca
 *     visualmente en ámbar.
 *   - Pagination 20/página.
 */

import { useState, useEffect, useCallback } from 'react'
import { CheckCircle2, XCircle, Clock, AlertCircle, ArrowLeft, Loader2, Eye } from 'lucide-react'
import { apiCall } from '@/lib/api-client'
import type { ActualizacionRow } from './tipos'
import { ModalDetalle } from './ModalDetalle'

interface Props {
  onCerrar: () => void
}

interface HistorialResp {
  data: ActualizacionRow[]
  total: number
  pagina: number
  tamanio: number
}

const ESTADO_BADGE: Record<string, { label: string; color: string; icon: any }> = {
  PROGRAMADA:  { label: 'Programada',  color: 'bg-amber-50 text-amber-700 border-amber-200',   icon: Clock },
  EJECUTANDO:  { label: 'En curso',    color: 'bg-blue-50 text-blue-700 border-blue-200',      icon: Loader2 },
  COMPLETADA:  { label: 'Completada',  color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  FALLIDA:     { label: 'Fallida',     color: 'bg-red-50 text-red-700 border-red-200',         icon: XCircle },
  CANCELADA:   { label: 'Cancelada',   color: 'bg-slate-100 text-slate-600 border-slate-200',  icon: AlertCircle },
}

function calcularDuracion(inicio: string | null, fin: string | null): string {
  if (!inicio || !fin) return '—'
  const ms = new Date(fin).getTime() - new Date(inicio).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

/** Detecta si una actualización EJECUTANDO está stuck (no avanza hace mucho). */
function esStuck(a: ActualizacionRow): boolean {
  if (a.estado !== 'EJECUTANDO') return false
  if (!a.fecha_inicio_ejecucion) return false
  const minutos = (Date.now() - new Date(a.fecha_inicio_ejecucion).getTime()) / 60000
  return minutos > 15
}

export function TablaHistorial({ onCerrar }: Props) {
  const [pagina, setPagina] = useState(0)
  const [data, setData] = useState<HistorialResp | null>(null)
  const [cargando, setCargando] = useState(true)
  const [detalleAbierto, setDetalleAbierto] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await apiCall<HistorialResp>(`/api/actualizaciones/historial?pagina=${pagina}`)
    if (r.ok) setData(r.data!)
    setCargando(false)
  }, [pagina])

  useEffect(() => { cargar() }, [cargar])

  const totalPaginas = data ? Math.ceil(data.total / data.tamanio) : 0

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button onClick={onCerrar} className="text-xs text-slate-600 hover:text-slate-900 flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> Volver
        </button>
        <span className="text-xs text-slate-500">
          {data?.total ?? 0} actualizaciones en total
        </span>
      </div>

      {cargando ? (
        <div className="flex items-center justify-center py-10 text-slate-400 text-sm gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
        </div>
      ) : !data || data.data.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded p-8 text-center text-sm text-slate-500">
          No hay actualizaciones registradas todavía.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Versión</th>
                <th>Estado</th>
                <th>Duración</th>
                <th>Detalle</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.data.map(a => {
                const eb = ESTADO_BADGE[a.estado] ?? ESTADO_BADGE.COMPLETADA
                const Icon = eb.icon
                const stuck = esStuck(a)
                return (
                  <tr
                    key={a.id}
                    className={`cursor-pointer hover:bg-slate-50 ${stuck ? 'bg-amber-50/40' : ''}`}
                    onClick={() => setDetalleAbierto(a.id)}
                  >
                    <td className="text-xs text-slate-600">
                      {new Date(a.created_at).toLocaleString('es-AR', {
                        dateStyle: 'short', timeStyle: 'short',
                      })}
                    </td>
                    <td className="text-xs">
                      <span className="font-mono text-slate-500">v{a.version_anterior}</span>
                      <span className="mx-1 text-slate-400">→</span>
                      <span className="font-mono font-semibold text-slate-700">v{a.version_nueva}</span>
                    </td>
                    <td>
                      <span className={`inline-flex items-center gap-1 text-2xs font-semibold px-1.5 py-0.5 rounded border ${eb.color}`}>
                        <Icon className={`h-3 w-3 ${a.estado === 'EJECUTANDO' ? 'animate-spin' : ''}`} />
                        {eb.label}
                      </span>
                      {stuck && (
                        <span className="ml-1.5 inline-flex items-center gap-1 text-2xs font-semibold px-1.5 py-0.5 rounded border bg-amber-100 text-amber-800 border-amber-300">
                          stuck
                        </span>
                      )}
                    </td>
                    <td className="text-xs text-slate-600 font-mono">
                      {calcularDuracion(a.fecha_inicio_ejecucion, a.fecha_fin_ejecucion)}
                    </td>
                    <td className="text-xs text-slate-600 max-w-xs truncate" title={a.error_mensaje ?? ''}>
                      {a.error_mensaje ?? (a.estado === 'COMPLETADA' ? 'OK' : '—')}
                    </td>
                    <td className="text-right">
                      <button
                        className="btn-tabla-accion"
                        title="Ver detalle"
                        onClick={(e) => { e.stopPropagation(); setDetalleAbierto(a.id) }}
                      >
                        <Eye />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPaginas > 1 && (
        <div className="flex items-center justify-between mt-3 text-xs text-slate-500">
          <span>Página {pagina + 1} de {totalPaginas}</span>
          <div className="flex gap-1">
            <button
              onClick={() => setPagina(p => Math.max(0, p - 1))}
              disabled={pagina === 0}
              className="btn-secondary px-3"
            >
              ← Anterior
            </button>
            <button
              onClick={() => setPagina(p => Math.min(totalPaginas - 1, p + 1))}
              disabled={pagina >= totalPaginas - 1}
              className="btn-secondary px-3"
            >
              Siguiente →
            </button>
          </div>
        </div>
      )}

      {detalleAbierto && (
        <ModalDetalle
          id={detalleAbierto}
          onCerrar={() => setDetalleAbierto(null)}
          onCambioEstado={cargar}
        />
      )}
    </div>
  )
}
