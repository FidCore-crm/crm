'use client'

/**
 * Pantalla full que se muestra durante un update en EJECUTANDO.
 *
 * Mejoras vs versión anterior:
 *   - El stepper avanza por el PASO REAL del script (leído de progress.json
 *     via /api/actualizaciones/estado.progreso), no por timer estimado.
 *   - Contador de errores consecutivos: si el polling falla N veces seguidas,
 *     muestra mensaje claro "El sistema está reiniciando — esto es normal,
 *     esperá 1 min y refrescá".
 *   - Botón "Ver detalles" después de N minutos para diagnosticar si tarda
 *     más de lo esperado.
 *   - Cuando el estado pasa a COMPLETADA/FALLIDA, llama onTerminada() para
 *     volver a la pantalla principal con el resultado.
 */

import { useEffect, useState, useRef } from 'react'
import { Loader2, AlertCircle, Database, GitBranch, Package, RefreshCw, CheckCircle2, Wifi, WifiOff } from 'lucide-react'
import { apiCall } from '@/lib/api-client'
import type { ActualizacionRow, ProgressInfo } from './tipos'

interface Props {
  actualizacion: ActualizacionRow
  onTerminada: () => void
}

interface EstadoResp {
  version_actual: string
  actualizacion_activa: ActualizacionRow | null
  ultima_completada: ActualizacionRow | null
  progreso: ProgressInfo | null
}

const PASOS = [
  { key: 'BACKUP',     icon: Database,  label: 'Creando backup' },
  { key: 'FETCH',      icon: GitBranch, label: 'Descargando código nuevo' },
  { key: 'BUILD',      icon: Package,   label: 'Reconstruyendo el sistema' },
  { key: 'MIGRATIONS', icon: Database,  label: 'Aplicando cambios de DB' },
  { key: 'RESTART',    icon: RefreshCw, label: 'Reiniciando' },
]

/** Mapea el `paso` del script al índice del stepper visible. */
function pasoAIndice(paso: string | undefined): number {
  if (!paso) return 0
  if (paso === 'INICIANDO') return 0
  if (paso === 'BACKUP' || paso === 'BACKUP_OK') return 0
  if (paso === 'FETCH' || paso === 'FETCH_OK') return 1
  if (paso === 'BUILD' || paso === 'BUILD_OK') return 2
  if (paso === 'MIGRATIONS' || paso === 'MIGRATIONS_OK') return 3
  if (paso === 'RESTART' || paso === 'HEALTHCHECK') return 4
  if (paso === 'DONE') return 5
  return 0
}

const MAX_ERRORES_ANTES_DE_ALERTA = 3       // 3 fallos consecutivos → mostrar "reiniciando"
const MIN_PARA_DIAGNOSTICO = 8 * 60          // 8 min → mostrar botón ver detalles
const MAX_MIN_ANTES_DE_TIMEOUT_UI = 35       // después de 35 min asumir que el script murió y dar opción de forzar cierre

export function PantallaProgreso({ actualizacion: inicial, onTerminada }: Props) {
  const [actualizacion, setActualizacion] = useState(inicial)
  const [progreso, setProgreso] = useState<ProgressInfo | null>(null)
  const [tiempoTranscurrido, setTiempoTranscurrido] = useState(0)
  const [erroresConsecutivos, setErroresConsecutivos] = useState(0)
  const [mostrarDiagnostico, setMostrarDiagnostico] = useState(false)

  // Polling del estado
  useEffect(() => {
    const interval = setInterval(async () => {
      const r = await apiCall<EstadoResp>(
        '/api/actualizaciones/estado',
        {},
        { mostrar_toast_en_error: false },
      )
      if (r.ok && r.data) {
        setErroresConsecutivos(0)
        const activa = r.data.actualizacion_activa
        if (r.data.progreso) setProgreso(r.data.progreso)

        if (!activa || activa.id !== actualizacion.id) {
          // Salió de la query → terminó
          onTerminada()
          return
        }
        setActualizacion(activa)
        if (activa.estado === 'COMPLETADA' || activa.estado === 'FALLIDA' || activa.estado === 'CANCELADA') {
          onTerminada()
        }
      } else {
        // Polling falló (server cayéndose por el restart, network glitch, etc.)
        setErroresConsecutivos(prev => prev + 1)
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

  // Mostrar botón "Ver detalles" si tarda mucho
  useEffect(() => {
    if (tiempoTranscurrido > MIN_PARA_DIAGNOSTICO) setMostrarDiagnostico(true)
  }, [tiempoTranscurrido])

  // Stepper: usa progress real si está disponible; fallback a estimación por tiempo
  const pasoActualIdx = progreso
    ? pasoAIndice(progreso.paso)
    : (() => {
        if (tiempoTranscurrido < 30) return 0
        if (tiempoTranscurrido < 60) return 1
        if (tiempoTranscurrido < 180) return 2
        if (tiempoTranscurrido < 210) return 3
        return 4
      })()

  const mm = Math.floor(tiempoTranscurrido / 60)
  const ss = tiempoTranscurrido % 60
  const enReinicio = erroresConsecutivos >= MAX_ERRORES_ANTES_DE_ALERTA
  const minutos = mm
  const timeoutSospechoso = minutos >= MAX_MIN_ANTES_DE_TIMEOUT_UI

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        {/* Spinner / banner de reinicio */}
        <div className="flex justify-center mb-6">
          <div className="relative">
            {enReinicio ? (
              <>
                <div className="absolute inset-0 bg-amber-500/20 rounded-full animate-pulse" />
                <WifiOff className="h-16 w-16 text-amber-600 relative" />
              </>
            ) : (
              <>
                <div className="absolute inset-0 bg-blue-500/20 rounded-full animate-pulse" />
                <Loader2 className="h-16 w-16 text-blue-600 animate-spin relative" />
              </>
            )}
          </div>
        </div>

        {/* Título */}
        <h2 className="text-lg font-semibold text-center text-slate-800 mb-1">
          {enReinicio
            ? 'El sistema se está reiniciando'
            : `Actualizando Pulzar a v${actualizacion.version_nueva}`
          }
        </h2>

        {/* Subtítulo / mensaje del paso actual */}
        {enReinicio ? (
          <p className="text-xs text-center text-amber-700 mb-6 px-4">
            Esto es normal durante el reinicio del CRM. Esperá 1 minuto y
            refrescá la página. Si no carga después de varios minutos, andá
            al historial de actualizaciones para ver el resultado.
          </p>
        ) : (
          <p className="text-xs text-center text-slate-500 mb-6">
            {progreso?.mensaje ?? 'Preparando...'}
            <br />
            <span className="text-2xs">
              Tiempo transcurrido: <span className="font-mono">{String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}</span>
            </span>
          </p>
        )}

        {/* Stepper */}
        {!enReinicio && (
          <div className="bg-white border border-slate-200 rounded p-4 mb-4">
            <ol className="space-y-3">
              {PASOS.map((paso, idx) => {
                const Icon = paso.icon
                const completado = idx < pasoActualIdx
                const enCurso = idx === pasoActualIdx
                return (
                  <li key={paso.key} className="flex items-center gap-3">
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
            {progreso?.porcentaje != null && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-500"
                    style={{ width: `${Math.max(5, progreso.porcentaje)}%` }}
                  />
                </div>
                <p className="text-2xs text-slate-400 text-right mt-1 font-mono">
                  {progreso.porcentaje}%
                </p>
              </div>
            )}
          </div>
        )}

        {/* Advertencia */}
        <div className="bg-amber-50 border border-amber-200 rounded p-3 flex items-start gap-2 mb-3">
          <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-900 leading-relaxed">
            <strong>No cierres esta pestaña</strong> hasta que termine. El CRM
            estará inaccesible por unos minutos. Si recibís un error de conexión,
            esperá 1 minuto y refrescá la página.
          </div>
        </div>

        {/* Diagnóstico */}
        {mostrarDiagnostico && !timeoutSospechoso && (
          <div className="bg-slate-50 border border-slate-200 rounded p-3 text-xs text-slate-600">
            <p className="flex items-center gap-1">
              <Wifi className="h-3.5 w-3.5" />
              <strong>Está tardando más de lo habitual.</strong>
            </p>
            <p className="mt-1 leading-relaxed">
              Builds grandes pueden llevar hasta 8 minutos. Si pasaron más de 30
              minutos, andá al historial de actualizaciones y marcala como
              fallida desde el detalle.
            </p>
          </div>
        )}

        {timeoutSospechoso && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-800">
            <p className="flex items-center gap-1 font-semibold">
              <AlertCircle className="h-3.5 w-3.5" />
              La actualización está tomando mucho más tiempo del esperado.
            </p>
            <p className="mt-1 leading-relaxed">
              El script puede haberse colgado. Ir a "Historial" arriba de esta
              pantalla, abrir el detalle de esta actualización y usar "Marcar
              como fallida" para desbloquear el sistema.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
