'use client'

/**
 * Modal para programar una actualización a una fecha/hora específica.
 *
 * Validaciones:
 *   - La fecha + hora debe ser futura (mínimo +5 min)
 *   - No más de 30 días a futuro (para no dejar updates "olvidadas")
 *
 * Sugerencias de horarios típicos para no interrumpir el día laboral:
 *   - Esta noche 22:00
 *   - Mañana 02:00
 *   - Mañana 06:00
 *   - El domingo a la noche
 */

import { useState } from 'react'
import { X, Calendar, Clock, Loader2 } from 'lucide-react'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import type { ReleaseGitHub } from './tipos'

interface Props {
  release: ReleaseGitHub
  onCerrar: () => void
  onProgramada: () => void
}

/** Devuelve un Date sumando N días/horas a hoy. */
function sumar(date: Date, opts: { dias?: number; horas?: number }): Date {
  const d = new Date(date)
  if (opts.dias) d.setDate(d.getDate() + opts.dias)
  if (opts.horas) d.setHours(d.getHours() + opts.horas)
  return d
}

/** Formato para el input datetime-local: YYYY-MM-DDTHH:mm en tz local. */
function aInputDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function ModalProgramar({ release, onCerrar, onProgramada }: Props) {
  // Default: esta noche 22:00
  const defaultDate = (() => {
    const d = new Date()
    d.setHours(22, 0, 0, 0)
    if (d.getTime() < Date.now() + 5 * 60_000) {
      // Si ya pasaron las 22, el default es mañana 22:00
      d.setDate(d.getDate() + 1)
    }
    return d
  })()

  const [fechaHora, setFechaHora] = useState(aInputDateTime(defaultDate))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  // Sugerencias rápidas
  const sugerencias = [
    { label: 'Esta noche, 22:00', date: (() => { const d = new Date(); d.setHours(22, 0, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1); return d })() },
    { label: 'Hoy, 23:30',        date: (() => { const d = new Date(); d.setHours(23, 30, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1); return d })() },
    { label: 'Mañana, 02:00',     date: (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(2, 0, 0, 0); return d })() },
    { label: 'Mañana, 06:00',     date: (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(6, 0, 0, 0); return d })() },
  ]

  const programar = async () => {
    setError('')
    const fecha = new Date(fechaHora)
    if (isNaN(fecha.getTime())) {
      setError('Fecha inválida.')
      return
    }
    if (fecha.getTime() < Date.now() + 5 * 60_000) {
      setError('La fecha debe ser al menos 5 minutos en el futuro.')
      return
    }
    if (fecha.getTime() > Date.now() + 30 * 24 * 60 * 60_000) {
      setError('No se puede programar a más de 30 días.')
      return
    }

    setGuardando(true)
    const r = await apiCall('/api/actualizaciones/programar', {
      method: 'POST',
      body: {
        version_nueva: release.version,
        changelog: release.changelog,
        programada_para: fecha.toISOString(),
      },
    })
    setGuardando(false)

    if (r.ok) {
      toast.exito(`Actualización programada para el ${fecha.toLocaleString('es-AR', { dateStyle: 'long', timeStyle: 'short' })}`)
      onProgramada()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-blue-600" />
            Programar actualización a v{release.version}
          </h3>
          <button onClick={onCerrar} className="text-slate-500 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-600">
            Elegí cuándo querés que se aplique. El CRM estará inaccesible
            durante 2-5 minutos. Te recomendamos un horario fuera de tu
            jornada laboral.
          </p>

          {/* Sugerencias rápidas */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Sugerencias
            </label>
            <div className="grid grid-cols-2 gap-2">
              {sugerencias.map(s => (
                <button
                  key={s.label}
                  onClick={() => setFechaHora(aInputDateTime(s.date))}
                  className="text-xs px-2 py-1.5 border border-slate-200 rounded hover:bg-slate-50 text-slate-700 text-left"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Selector manual */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5 flex items-center gap-1">
              <Clock className="h-3 w-3" /> Fecha y hora exacta
            </label>
            <input
              type="datetime-local"
              value={fechaHora}
              onChange={e => setFechaHora(e.target.value)}
              min={aInputDateTime(sumar(new Date(), { horas: 0 }))}
              max={aInputDateTime(sumar(new Date(), { dias: 30 }))}
              className="form-input w-full"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded px-2 py-1.5">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200">
          <button onClick={onCerrar} disabled={guardando} className="btn-secondary">
            Cancelar
          </button>
          <button onClick={programar} disabled={guardando} className="btn-primary flex items-center gap-1">
            {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Programar
          </button>
        </div>
      </div>
    </div>
  )
}
