'use client'

/**
 * Pantalla full que se muestra durante un update en EJECUTANDO.
 *
 * Hace polling cada 5s del estado. Muestra:
 *   - Banner grande "Actualizando Pulzar..." con animación
 *   - Stepper con los pasos
 *   - Tiempo transcurrido
 *   - Advertencia: NO cerrar esta pestaña, NO usar el CRM
 *
 * Cuando el estado pasa a COMPLETADA/FALLIDA, llama onTerminada() que
 * recarga el estado en la page padre y muestra el resultado.
 */

import { useEffect, useState } from 'react'
import { Loader2, AlertCircle, Database, GitBranch, Package, RefreshCw, CheckCircle2 } from 'lucide-react'
import { apiCall } from '@/lib/api-client'
import type { ActualizacionRow } from './tipos'

interface Props {
  actualizacion: ActualizacionRow
  onTerminada: () => void
}

const PASOS = [
  { icon: Database, label: 'Creando backup' },
  { icon: GitBranch, label: 'Descargando código nuevo' },
  { icon: Package, label: 'Reconstruyendo el sistema' },
  { icon: RefreshCw, label: 'Reiniciando' },
]

export function PantallaProgreso({ actualizacion: inicial, onTerminada }: Props) {
  const [actualizacion, setActualizacion] = useState(inicial)
  const [pasoActual, setPasoActual] = useState(0)
  const [tiempoTranscurrido, setTiempoTranscurrido] = useState(0)

  // Polling del estado
  useEffect(() => {
    const interval = setInterval(async () => {
      const r = await apiCall<{ actualizacion_activa: ActualizacionRow | null }>(
        '/api/actualizaciones/estado',
        {},
        { mostrar_toast_en_error: false },
      )
      if (r.ok && r.data) {
        const activa = r.data.actualizacion_activa
        if (!activa || activa.id !== actualizacion.id) {
          // Ya terminó (el update se completó/falló y salió de la query)
          onTerminada()
          return
        }
        setActualizacion(activa)
        if (activa.estado === 'COMPLETADA' || activa.estado === 'FALLIDA') {
          onTerminada()
        }
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [actualizacion.id, onTerminada])

  // Tiempo transcurrido visual
  useEffect(() => {
    const inicio = actualizacion.fecha_inicio_ejecucion
      ? new Date(actualizacion.fecha_inicio_ejecucion).getTime()
      : Date.now()
    const interval = setInterval(() => {
      setTiempoTranscurrido(Math.floor((Date.now() - inicio) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [actualizacion.fecha_inicio_ejecucion])

  // Avance del stepper estimado por tiempo
  useEffect(() => {
    // Estimación: backup 30s, fetch 30s, build 120s, restart 30s
    if (tiempoTranscurrido < 30) setPasoActual(0)
    else if (tiempoTranscurrido < 60) setPasoActual(1)
    else if (tiempoTranscurrido < 180) setPasoActual(2)
    else setPasoActual(3)
  }, [tiempoTranscurrido])

  const mm = Math.floor(tiempoTranscurrido / 60)
  const ss = tiempoTranscurrido % 60

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        {/* Spinner grande */}
        <div className="flex justify-center mb-6">
          <div className="relative">
            <div className="absolute inset-0 bg-blue-500/20 rounded-full animate-pulse" />
            <Loader2 className="h-16 w-16 text-blue-600 animate-spin relative" />
          </div>
        </div>

        {/* Título */}
        <h2 className="text-lg font-semibold text-center text-slate-800 mb-1">
          Actualizando Pulzar a v{actualizacion.version_nueva}
        </h2>
        <p className="text-xs text-center text-slate-500 mb-6">
          Tiempo transcurrido: <span className="font-mono">{String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}</span>
        </p>

        {/* Stepper */}
        <div className="bg-white border border-slate-200 rounded p-4 mb-4">
          <ol className="space-y-3">
            {PASOS.map((paso, idx) => {
              const Icon = paso.icon
              const completado = idx < pasoActual
              const enCurso = idx === pasoActual
              return (
                <li key={idx} className="flex items-center gap-3">
                  <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
                    completado ? 'bg-emerald-100 text-emerald-700' :
                    enCurso ? 'bg-blue-100 text-blue-700' :
                    'bg-slate-100 text-slate-400'
                  }`}>
                    {completado ? <CheckCircle2 className="h-4 w-4" /> :
                     enCurso ? <Loader2 className="h-4 w-4 animate-spin" /> :
                     <Icon className="h-3.5 w-3.5" />}
                  </div>
                  <span className={`text-sm ${
                    completado ? 'text-slate-600' :
                    enCurso ? 'text-slate-900 font-medium' :
                    'text-slate-400'
                  }`}>
                    {paso.label}
                  </span>
                </li>
              )
            })}
          </ol>
        </div>

        {/* Advertencia */}
        <div className="bg-amber-50 border border-amber-200 rounded p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-900 leading-relaxed">
            <strong>No cierres esta pestaña</strong> hasta que termine. El CRM
            estará inaccesible por unos minutos. Si recibís un error de conexión,
            esperá 1 minuto y refrescá la página.
          </div>
        </div>
      </div>
    </div>
  )
}
