'use client'

import { useEffect, useState } from 'react'
import {
  X, RefreshCw, Loader2, AlertTriangle, AlertCircle, Undo2,
} from 'lucide-react'
import { formatFechaLocal } from '@/lib/utils'
import { apiCall } from '@/lib/api-client'

interface Props {
  abierto: boolean
  onCerrar: () => void
  poliza: {
    id: string
    numero_poliza: string
    estado: 'CANCELADA' | 'ANULADA'
    fecha_inicio: string
    fecha_fin: string
    motivo_baja: string | null
    fecha_baja: string | null
    observaciones_baja: string | null
    asegurado_nombre: string
    updated_at?: string | null
  }
  onRehabilitada: () => void
}

interface PreviewData {
  estado_nuevo: 'PROGRAMADA' | 'VIGENTE' | 'NO_VIGENTE'
  advertencias: string[]
}

function descripcionEstado(estado: string): string {
  if (estado === 'VIGENTE') return 'VIGENTE (la póliza sigue en vigencia)'
  if (estado === 'PROGRAMADA') return 'PROGRAMADA (inicio futuro)'
  if (estado === 'NO_VIGENTE') return 'NO_VIGENTE (ya venció)'
  return estado
}

export default function RehabilitarPolizaModal({ abierto, onCerrar, poliza, onRehabilitada }: Props) {
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [cargandoPreview, setCargandoPreview] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [ejecutando, setEjecutando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!abierto) {
      setPreview(null)
      setMotivo('')
      setObservaciones('')
      setError('')
      return
    }
    setCargandoPreview(true)
    apiCall<{ estado_nuevo: 'PROGRAMADA' | 'VIGENTE' | 'NO_VIGENTE'; advertencias?: string[] }>(
      `/api/polizas/${poliza.id}/rehabilitar`,
      { method: 'POST', body: { preview: true } },
      { mostrar_toast_en_error: false },
    )
      .then(r => {
        if (r.ok && r.data) {
          setPreview({ estado_nuevo: r.data.estado_nuevo, advertencias: r.data.advertencias ?? [] })
        } else {
          setError(r.error?.mensaje ?? 'Error al obtener preview')
        }
      })
      .finally(() => setCargandoPreview(false))
  }, [abierto, poliza.id])

  if (!abierto) return null

  async function rehabilitar() {
    setEjecutando(true); setError('')
    const r = await apiCall(`/api/polizas/${poliza.id}/rehabilitar`, {
      method: 'POST',
      body: {
        preview: false,
        motivo: motivo.trim() || 'Rehabilitación manual',
        observaciones: observaciones.trim() || null,
        // Optimistic concurrency (#81): si la póliza cambió mientras el modal
        // estaba abierto, evitamos rehabilitar sobre un estado stale.
        if_match_updated_at: poliza.updated_at ?? undefined,
      },
    }, { mostrar_toast_en_error: false })
    if (!r.ok) {
      if (r.error?.codigo === 'ERR_NEG_004') {
        setError('La póliza cambió mientras este modal estaba abierto. Cerralo y volvé a abrirlo con los datos actualizados.')
      } else {
        setError(r.error?.mensaje ?? 'No se pudo rehabilitar')
      }
      setEjecutando(false)
      return
    }
    onRehabilitada()
    onCerrar()
  }

  const tipoBaja = poliza.estado === 'CANCELADA' ? 'CANCELADA' : 'ANULADA'

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={() => !ejecutando && onCerrar()}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-blue-50">
          <div className="flex items-center gap-2">
            <Undo2 className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-slate-800">Rehabilitar póliza</h2>
          </div>
          <button
            onClick={() => !ejecutando && onCerrar()}
            disabled={ejecutando}
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-white/60 text-slate-400 hover:text-slate-700 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* Sección 1 — Info de la baja */}
          <div className="border border-slate-200 rounded p-3">
            <p className="text-2xs text-slate-500 uppercase font-semibold mb-2">
              Esta póliza fue {tipoBaja.toLowerCase()}
            </p>
            <div className="text-xs text-slate-700 space-y-1">
              <p>
                <span className="text-slate-500">Número: </span>
                <span className="font-mono">{poliza.numero_poliza}</span>
              </p>
              <p>
                <span className="text-slate-500">Asegurado: </span>
                {poliza.asegurado_nombre}
              </p>
              <p>
                <span className="text-slate-500">Fecha de baja: </span>
                {poliza.fecha_baja ? formatFechaLocal(poliza.fecha_baja) : '—'}
              </p>
              {poliza.motivo_baja && (
                <p>
                  <span className="text-slate-500">Motivo: </span>
                  {poliza.motivo_baja}
                </p>
              )}
              {poliza.observaciones_baja && (
                <p className="text-2xs text-slate-500 italic">
                  {poliza.observaciones_baja}
                </p>
              )}
            </div>
          </div>

          {/* Sección 2 — Preview del resultado */}
          {cargandoPreview ? (
            <div className="text-center py-6 text-xs text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1" />
              Calculando qué va a pasar...
            </div>
          ) : preview ? (
            <div className="border border-blue-200 bg-blue-50 rounded p-3">
              <p className="text-2xs text-blue-700 uppercase font-semibold mb-2 flex items-center gap-1">
                <RefreshCw className="h-3 w-3" /> Al rehabilitar
              </p>
              <p className="text-xs text-blue-900 mb-2">
                Estado nuevo: <span className="font-semibold">{descripcionEstado(preview.estado_nuevo)}</span>
              </p>
              <p className="text-2xs text-blue-700">Se van a limpiar:</p>
              <ul className="text-2xs text-blue-700 ml-3 list-disc">
                <li>Motivo de baja</li>
                <li>Fecha de baja</li>
                <li>Observaciones de baja</li>
              </ul>
            </div>
          ) : null}

          {/* Sección 3 — Advertencias */}
          {preview && preview.advertencias.length > 0 && (
            <div className="border border-amber-200 bg-amber-50 rounded p-3">
              <p className="text-2xs text-amber-800 uppercase font-semibold mb-2 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Consideraciones
              </p>
              <ul className="text-xs text-amber-900 space-y-1">
                {preview.advertencias.map((a, i) => (
                  <li key={i} className="flex items-start gap-1">
                    <span className="shrink-0">•</span>
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Sección 4 — Motivo */}
          <div className="flex flex-col gap-1">
            <label className="text-2xs text-slate-500 uppercase font-semibold">
              Motivo de la rehabilitación (opcional)
            </label>
            <input
              type="text"
              className="form-input w-full text-xs"
              placeholder='Ej: "El cliente se arrepintió de la baja", "Cancelación por error"...'
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              disabled={ejecutando}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-2xs text-slate-500 uppercase font-semibold">
              Observaciones (opcional)
            </label>
            <textarea
              className="form-input w-full text-xs resize-none"
              rows={2}
              value={observaciones}
              onChange={e => setObservaciones(e.target.value)}
              disabled={ejecutando}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button onClick={onCerrar} disabled={ejecutando} className="btn-secondary">
            Cancelar
          </button>
          <button
            onClick={rehabilitar}
            disabled={ejecutando || cargandoPreview || !preview}
            className="btn-primary"
          >
            {ejecutando ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Rehabilitando...
              </>
            ) : (
              <>
                <Undo2 className="h-3.5 w-3.5" /> Rehabilitar póliza
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
