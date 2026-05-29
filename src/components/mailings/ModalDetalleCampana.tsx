'use client'

/**
 * Modal de detalle de una campaña.
 *
 * Muestra:
 *   - Info general (nombre, descripción, estado, fechas)
 *   - Métricas en vivo (total / enviados / fallidos / excluidos + barra de progreso)
 *   - Audiencia y plantilla usadas (con links a esos catálogos)
 *   - Último error si lo hay
 *
 * Auto-refresh cada 5s mientras está EJECUTANDO.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  X, Loader2, Megaphone, CheckCircle2, AlertCircle, Calendar,
  Users, FileText, Edit2, Pause, Ban, Send, Activity, Clock,
} from 'lucide-react'
import { apiCall } from '@/lib/api-client'
import type { MailingCampana } from './TabMailingCampanas'

interface Props {
  campanaId: string
  onCerrar: () => void
}

const ESTADO_META: Record<string, { label: string; color: string; icon: any }> = {
  BORRADOR:   { label: 'Borrador',     color: 'text-slate-700 bg-slate-100 border-slate-200', icon: Edit2 },
  PROGRAMADA: { label: 'Programada',   color: 'text-amber-800 bg-amber-50 border-amber-200', icon: Calendar },
  EJECUTANDO: { label: 'Ejecutando',   color: 'text-blue-700 bg-blue-50 border-blue-200',    icon: Loader2 },
  COMPLETADA: { label: 'Completada',   color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: CheckCircle2 },
  PAUSADA:    { label: 'Pausada',      color: 'text-violet-700 bg-violet-50 border-violet-200', icon: Pause },
  CANCELADA:  { label: 'Cancelada',    color: 'text-slate-500 bg-slate-100 border-slate-200', icon: Ban },
}

function fmtFecha(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'medium' })
}

function fmtDuracion(inicio: string | null, fin: string | null): string {
  if (!inicio) return '—'
  const ms = (fin ? new Date(fin).getTime() : Date.now()) - new Date(inicio).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export default function ModalDetalleCampana({ campanaId, onCerrar }: Props) {
  const [data, setData] = useState<MailingCampana | null>(null)
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    const r = await apiCall<{ campana: MailingCampana }>(
      `/api/comunicaciones/campanas/${campanaId}`, {}, { mostrar_toast_en_error: false },
    )
    if (r.ok && r.data) setData(r.data.campana)
    setCargando(false)
  }, [campanaId])

  useEffect(() => { cargar() }, [cargar])

  // Auto-refresh cada 5s si está EJECUTANDO
  useEffect(() => {
    if (!data || data.estado !== 'EJECUTANDO') return
    const t = setInterval(cargar, 5000)
    return () => clearInterval(t)
  }, [data, cargar])

  if (cargando || !data) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-lg shadow-xl p-10 flex items-center gap-3 text-sm text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Cargando...
        </div>
      </div>
    )
  }

  const meta = ESTADO_META[data.estado] ?? ESTADO_META.BORRADOR
  const IconEstado = meta.icon
  const totalDest = data.total_destinatarios || 0
  const procesados = data.enviados + data.fallidos + data.excluidos
  const progresoPct = totalDest > 0 ? Math.round((procesados / totalDest) * 100) : 0
  const tasaApertura = data.enviados > 0 ? 0 : 0  // (Sprint 3 — necesita query a email_envios.fecha_primera_apertura)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-blue-600" />
            {data.nombre}
          </h3>
          <button onClick={onCerrar} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 flex-1 space-y-4">
          {/* Estado + descripción */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded border ${meta.color}`}>
              <IconEstado className={`h-3.5 w-3.5 ${data.estado === 'EJECUTANDO' ? 'animate-spin' : ''}`} />
              {meta.label}
            </span>
            {data.descripcion && (
              <span className="text-xs text-slate-500 flex-1 text-right">{data.descripcion}</span>
            )}
          </div>

          {/* Progreso */}
          {(data.estado === 'EJECUTANDO' || data.estado === 'COMPLETADA' || data.estado === 'PAUSADA') && totalDest > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-2xs font-semibold text-slate-700 uppercase">Progreso</p>
                <span className="text-xs font-mono text-slate-700">
                  {procesados} / {totalDest} ({progresoPct}%)
                </span>
              </div>
              <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    data.estado === 'COMPLETADA' ? 'bg-emerald-500' :
                    data.estado === 'PAUSADA' ? 'bg-violet-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${Math.max(3, progresoPct)}%` }}
                />
              </div>
            </div>
          )}

          {/* Métricas */}
          <div className="grid grid-cols-4 gap-2">
            <MetricaCard label="Total" valor={totalDest || '—'} color="slate" icon={Users} />
            <MetricaCard label="Enviados" valor={data.enviados} color="emerald" icon={Send} />
            <MetricaCard label="Excluidos" valor={data.excluidos} color="amber" icon={AlertCircle} />
            <MetricaCard label="Fallidos" valor={data.fallidos} color={data.fallidos > 0 ? 'red' : 'slate'} icon={Ban} />
          </div>

          {/* Info temporal */}
          <div className="bg-slate-50 border border-slate-200 rounded p-3 grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-slate-500 mb-0.5 flex items-center gap-1"><Calendar className="h-3 w-3" /> Creada</p>
              <p className="text-slate-800 font-mono">{fmtFecha(data.created_at)}</p>
            </div>
            {data.programada_para && (
              <div>
                <p className="text-slate-500 mb-0.5 flex items-center gap-1"><Clock className="h-3 w-3" /> Programada para</p>
                <p className="text-slate-800 font-mono">{fmtFecha(data.programada_para)}</p>
              </div>
            )}
            {data.fecha_inicio_ejecucion && (
              <div>
                <p className="text-slate-500 mb-0.5 flex items-center gap-1"><Activity className="h-3 w-3" /> Inicio ejecución</p>
                <p className="text-slate-800 font-mono">{fmtFecha(data.fecha_inicio_ejecucion)}</p>
              </div>
            )}
            {data.fecha_fin_ejecucion && (
              <div>
                <p className="text-slate-500 mb-0.5">Fin ejecución</p>
                <p className="text-slate-800 font-mono">{fmtFecha(data.fecha_fin_ejecucion)}</p>
              </div>
            )}
            {data.fecha_inicio_ejecucion && (
              <div className="col-span-2">
                <p className="text-slate-500 mb-0.5">Duración</p>
                <p className="text-slate-800 font-mono">{fmtDuracion(data.fecha_inicio_ejecucion, data.fecha_fin_ejecucion)}</p>
              </div>
            )}
          </div>

          {/* Último error */}
          {data.ultimo_error && (
            <div className="bg-red-50 border border-red-200 rounded p-3">
              <p className="text-2xs font-semibold text-red-900 uppercase mb-1 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> Último error
              </p>
              <p className="text-xs text-red-800 whitespace-pre-wrap">{data.ultimo_error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 px-5 py-3 flex items-center justify-between shrink-0">
          <p className="text-2xs text-slate-400">
            Actualizado {fmtFecha(data.updated_at)}
            {data.estado === 'EJECUTANDO' && <span className="ml-2 text-blue-600">· refresh automático cada 5s</span>}
          </p>
          <button onClick={onCerrar} className="btn-secondary">Cerrar</button>
        </div>
      </div>
    </div>
  )
}

function MetricaCard({ label, valor, color, icon: Icon }: {
  label: string; valor: number | string; color: 'slate' | 'emerald' | 'amber' | 'red' | 'blue'; icon: any
}) {
  const cls = {
    slate:   'bg-slate-50 text-slate-700 border-slate-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber:   'bg-amber-50 text-amber-700 border-amber-200',
    red:     'bg-red-50 text-red-700 border-red-200',
    blue:    'bg-blue-50 text-blue-700 border-blue-200',
  }[color]
  return (
    <div className={`border rounded p-2 ${cls}`}>
      <div className="text-2xs font-medium flex items-center gap-1 opacity-80">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="text-lg font-bold font-mono mt-1">{valor}</div>
    </div>
  )
}
