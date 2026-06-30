'use client'

/**
 * Pantalla de gestión de actualizaciones del CRM.
 *
 * Estados que muestra:
 *   - No hay update disponible: muestra versión actual + card "qué trae" + botón "Verificar"
 *   - Update disponible (sin acción): banner + botones [Actualizar ahora] [Programar]
 *   - Update programado: tarjeta con countdown + botón [Cancelar]
 *   - Update en ejecución: pantalla full con stepper + log en vivo
 *   - Update terminado RECIENTE (<10 min): banner verde "Acabás de actualizar a vX.Y.Z" con changelog
 *
 * Polling: cada 5s cuando hay una actualización ACTIVA (PROGRAMADA o EJECUTANDO).
 * Cuando no hay activa, hace una sola consulta al montar.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Download, CheckCircle2, AlertCircle, Loader2, Calendar, X,
  Sparkles, ArrowRight, RefreshCw, History, Clock, PartyPopper,
} from 'lucide-react'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import type { ReleaseGitHub, ActualizacionRow, ProgressInfo } from './tipos'
import { ModalProgramar } from './ModalProgramar'
import { PantallaProgreso } from './PantallaProgreso'
import { TablaHistorial } from './TablaHistorial'
import { ChangelogViewer } from './ChangelogViewer'

interface EstadoData {
  version_actual: string
  actualizacion_activa: ActualizacionRow | null
  ultima_completada: ActualizacionRow | null
  progreso: ProgressInfo | null
}

interface DisponibleData {
  version_actual: string
  hay_actualizacion: boolean
  ultimo_release?: ReleaseGitHub
  error?: string
}

/** Una update "reciente" es < 10 min — mostramos banner celebratorio. */
const MIN_PARA_BANNER_RECIENTE = 10

export default function ActualizacionesPage() {
  const router = useRouter()
  const { isAdmin } = useAuth()

  const [estado, setEstado] = useState<EstadoData | null>(null)
  const [disponible, setDisponible] = useState<DisponibleData | null>(null)
  const [cargando, setCargando] = useState(true)
  const [verificando, setVerificando] = useState(false)
  const [modalProgramarAbierto, setModalProgramarAbierto] = useState(false)
  const [tabHistorial, setTabHistorial] = useState(false)
  const [mostrarNovedades, setMostrarNovedades] = useState(false)
  const [bannerDescartado, setBannerDescartado] = useState(false)

  // ─── Carga inicial + polling ────────────────────────────

  const cargarEstado = useCallback(async () => {
    const r = await apiCall<EstadoData>('/api/actualizaciones/estado', {}, {
      mostrar_toast_en_error: false,
    })
    if (r.ok && r.data) setEstado(r.data)
  }, [])

  const cargarDisponible = useCallback(async (forzar = false) => {
    const url = forzar
      ? '/api/actualizaciones/disponible?forzar=1'
      : '/api/actualizaciones/disponible'
    const r = await apiCall<DisponibleData>(url, {}, {
      mostrar_toast_en_error: false,
    })
    if (r.ok && r.data) setDisponible(r.data)
  }, [])

  useEffect(() => {
    if (!isAdmin) {
      router.replace('/crm/configuracion')
      return
    }
    Promise.all([cargarEstado(), cargarDisponible()]).finally(() => setCargando(false))
  }, [isAdmin, cargarEstado, cargarDisponible, router])

  // Detectar desincronización entre bundle del browser y server.
  // Si el usuario abre la página con código cacheado mientras el server tiene
  // versión nueva, recargamos para evitar errores de queries contra schema nuevo.
  useEffect(() => {
    const versionBundle = process.env.NEXT_PUBLIC_APP_VERSION
    if (
      versionBundle &&
      estado?.version_actual &&
      versionBundle !== estado.version_actual &&
      typeof window !== 'undefined'
    ) {
      // Marca para no recargar en loop si versión del bundle siempre difiere
      if (!sessionStorage.getItem('fidcore-version-mismatch-reloaded')) {
        sessionStorage.setItem('fidcore-version-mismatch-reloaded', '1')
        window.location.reload()
      }
    }
  }, [estado?.version_actual])

  // Polling cada 5s si hay update activo
  useEffect(() => {
    const activa = estado?.actualizacion_activa
    if (!activa || activa.estado === 'COMPLETADA' || activa.estado === 'FALLIDA' || activa.estado === 'CANCELADA') {
      return
    }
    const interval = setInterval(cargarEstado, 5000)
    return () => clearInterval(interval)
  }, [estado, cargarEstado])

  // ─── Acciones ────────────────────────────────────────────

  const verificarManual = async () => {
    setVerificando(true)
    await cargarDisponible(true)
    setVerificando(false)
    // Re-leer disponible directamente (el setState es async)
    const r = await apiCall<DisponibleData>('/api/actualizaciones/disponible', {}, {
      mostrar_toast_en_error: false,
    })
    if (r.ok && r.data) {
      if (r.data.hay_actualizacion) {
        toast.info(`Nueva versión disponible: v${r.data.ultimo_release?.version}`)
      } else if (!r.data.error) {
        toast.exito('Ya estás en la última versión')
      }
    }
  }

  const actualizarAhora = async () => {
    if (!disponible?.ultimo_release) return
    if (!confirm(`¿Actualizar ahora a FidCore v${disponible.ultimo_release.version}?\n\nEl CRM va a estar inaccesible durante 2-5 minutos.`)) return

    const r = await apiCall<ActualizacionRow>('/api/actualizaciones/programar', {
      method: 'POST',
      body: {
        version_nueva: disponible.ultimo_release.version,
        changelog: disponible.ultimo_release.changelog,
        programada_para: null, // null = ahora
      },
    })

    if (r.ok) {
      toast.exito('Actualización iniciada. El proceso tarda unos minutos.')
      await cargarEstado()
    }
  }

  const cancelarProgramada = async (id: string) => {
    if (!confirm('¿Cancelar la actualización programada?')) return
    const r = await apiCall('/api/actualizaciones/cancelar', {
      method: 'POST',
      body: { id },
    })
    if (r.ok) {
      toast.exito('Actualización cancelada')
      await cargarEstado()
    }
  }

  // ─── Render ──────────────────────────────────────────────

  if (cargando) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400 text-sm gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
      </div>
    )
  }

  const activa = estado?.actualizacion_activa
  const enEjecucion = activa?.estado === 'EJECUTANDO'
  const ultimaCompletada = estado?.ultima_completada

  // ¿Hay banner celebratorio?
  let bannerReciente = false
  if (ultimaCompletada && !bannerDescartado && ultimaCompletada.fecha_fin_ejecucion) {
    const minutosDesdeFin = (Date.now() - new Date(ultimaCompletada.fecha_fin_ejecucion).getTime()) / 60000
    bannerReciente = minutosDesdeFin <= MIN_PARA_BANNER_RECIENTE
  }

  // Si hay un update EJECUTANDO, pantalla full de progreso
  if (enEjecucion) {
    return <PantallaProgreso actualizacion={activa!} onTerminada={cargarEstado} />
  }

  return (
    <div className="max-w-4xl mx-auto pb-20">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Actualizaciones</h1>
          <p className="text-xs text-slate-500">
            Versión actual: <span className="font-mono text-slate-700">v{estado?.version_actual}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTabHistorial(!tabHistorial)}
            className="btn-secondary flex items-center gap-1"
            title="Ver historial"
          >
            <History className="h-3.5 w-3.5" />
            Historial
          </button>
          <button
            onClick={verificarManual}
            disabled={verificando}
            className="btn-secondary flex items-center gap-1"
          >
            {verificando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Verificar
          </button>
        </div>
      </div>

      {tabHistorial ? (
        <TablaHistorial onCerrar={() => setTabHistorial(false)} />
      ) : (
        <>
          {/* Banner celebratorio post-update */}
          {bannerReciente && ultimaCompletada && (
            <div className="bg-emerald-50 border border-emerald-200 rounded p-4 mb-4">
              <div className="flex items-start gap-3">
                <PartyPopper className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-emerald-900">
                    ¡Listo! Tu CRM se actualizó a v{ultimaCompletada.version_nueva}
                  </h3>
                  <p className="text-xs text-emerald-800 mt-0.5">
                    Actualización completada el{' '}
                    {new Date(ultimaCompletada.fecha_fin_ejecucion!).toLocaleString('es-AR', {
                      dateStyle: 'long', timeStyle: 'short',
                    })}
                  </p>
                  {ultimaCompletada.changelog && (
                    <div className="mt-3 bg-white border border-emerald-100 rounded p-3 max-h-64 overflow-y-auto">
                      <p className="text-xs font-semibold text-emerald-900 mb-2">Qué trajo esta versión:</p>
                      <ChangelogViewer texto={ultimaCompletada.changelog} />
                    </div>
                  )}
                  <button
                    onClick={() => setBannerDescartado(true)}
                    className="mt-3 text-xs text-emerald-700 hover:text-emerald-900 underline"
                  >
                    Ocultar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Caso 1: hay update PROGRAMADA */}
          {activa?.estado === 'PROGRAMADA' && (
            <div className="bg-amber-50 border border-amber-200 rounded p-5 mb-4">
              <div className="flex items-start gap-3">
                <Calendar className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-amber-900">
                    Actualización programada a v{activa.version_nueva}
                  </h3>
                  {activa.programada_para ? (
                    <p className="text-xs text-amber-800 mt-1">
                      Se aplicará el{' '}
                      <strong>{new Date(activa.programada_para).toLocaleString('es-AR', {
                        dateStyle: 'long', timeStyle: 'short',
                      })}</strong>
                    </p>
                  ) : (
                    <p className="text-xs text-amber-800 mt-1">Se aplicará en el próximo ciclo del cron del host (~1 min).</p>
                  )}
                  {activa.changelog && (
                    <details className="mt-2">
                      <summary className="text-xs text-amber-800 cursor-pointer hover:text-amber-900">
                        Ver qué cambios trae →
                      </summary>
                      <div className="mt-2 bg-white border border-amber-100 rounded p-3 max-h-64 overflow-y-auto">
                        <ChangelogViewer texto={activa.changelog} />
                      </div>
                    </details>
                  )}
                  <button
                    onClick={() => cancelarProgramada(activa.id)}
                    className="mt-3 text-xs text-amber-700 hover:text-amber-900 underline flex items-center gap-1"
                  >
                    <X className="h-3 w-3" /> Cancelar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Caso 2: hay update disponible y no hay programada/ejecutando */}
          {!activa && disponible?.hay_actualizacion && disponible.ultimo_release && (
            <BannerUpdateDisponible
              release={disponible.ultimo_release}
              onActualizarAhora={actualizarAhora}
              onProgramar={() => setModalProgramarAbierto(true)}
            />
          )}

          {/* Caso 3: error al consultar */}
          {disponible?.error && (
            <div className="bg-slate-50 border border-slate-200 rounded p-4 mb-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-slate-500 mt-0.5" />
                <div>
                  <p className="text-sm text-slate-700">No se pudo verificar actualizaciones</p>
                  <p className="text-xs text-slate-500 mt-0.5">{disponible.error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Caso 4: al día */}
          {!activa && !bannerReciente && disponible && !disponible.hay_actualizacion && !disponible.error && (
            <div className="bg-emerald-50 border border-emerald-200 rounded p-5 mb-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-emerald-900">✓ Sistema al día</h3>
                  <p className="text-xs text-emerald-800 mt-0.5">
                    Estás corriendo FidCore v{estado?.version_actual} — la última versión disponible.
                  </p>
                  {ultimaCompletada?.changelog && (
                    <button
                      onClick={() => setMostrarNovedades(!mostrarNovedades)}
                      className="mt-2 text-xs text-emerald-700 hover:text-emerald-900 underline flex items-center gap-1"
                    >
                      {mostrarNovedades ? 'Ocultar' : 'Ver'} qué trae esta versión
                      <ArrowRight className={`h-3 w-3 transition-transform ${mostrarNovedades ? 'rotate-90' : ''}`} />
                    </button>
                  )}
                  {mostrarNovedades && ultimaCompletada?.changelog && (
                    <div className="mt-3 bg-white border border-emerald-100 rounded p-3 max-h-64 overflow-y-auto">
                      <ChangelogViewer texto={ultimaCompletada.changelog} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Info adicional siempre visible */}
          <InfoActualizaciones />
        </>
      )}

      {/* Modal programar */}
      {modalProgramarAbierto && disponible?.ultimo_release && (
        <ModalProgramar
          release={disponible.ultimo_release}
          onCerrar={() => setModalProgramarAbierto(false)}
          onProgramada={() => {
            setModalProgramarAbierto(false)
            cargarEstado()
          }}
        />
      )}
    </div>
  )
}

// ─── Sub-componentes locales ───────────────────────────────

function BannerUpdateDisponible({
  release, onActualizarAhora, onProgramar,
}: {
  release: ReleaseGitHub
  onActualizarAhora: () => void
  onProgramar: () => void
}) {
  return (
    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded p-5 mb-4">
      <div className="flex items-start gap-3 mb-4">
        <div className="bg-blue-100 rounded-full p-2 shrink-0">
          <Sparkles className="h-5 w-5 text-blue-700" />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-blue-950">
            Nueva versión disponible: FidCore v{release.version}
            {release.prerelease && (
              <span className="ml-2 inline-block text-2xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-medium uppercase tracking-wide align-middle">
                Pre-release
              </span>
            )}
          </h3>
          <p className="text-xs text-blue-700 mt-0.5">
            Publicada el {new Date(release.published_at).toLocaleDateString('es-AR', { dateStyle: 'long' })}
          </p>
        </div>
      </div>

      {/* Changelog renderizado */}
      <div className="bg-white border border-blue-100 rounded p-3 mb-4 max-h-72 overflow-y-auto">
        <p className="text-xs font-semibold text-slate-600 mb-2">Qué incorpora o corrige:</p>
        <ChangelogViewer texto={release.changelog} />
      </div>

      {/* Acciones */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onActualizarAhora} className="btn-primary flex items-center gap-1">
          <Download className="h-3.5 w-3.5" />
          Actualizar ahora
        </button>
        <button onClick={onProgramar} className="btn-secondary flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" />
          Programar
        </button>
      </div>
    </div>
  )
}

function InfoActualizaciones() {
  return (
    <details className="mt-6 text-xs text-slate-500">
      <summary className="cursor-pointer hover:text-slate-700">
        ¿Cómo funcionan las actualizaciones?
      </summary>
      <div className="mt-3 space-y-2 pl-4 leading-relaxed">
        <p>
          El sistema consulta automáticamente cada 4 horas el repositorio de FidCore
          para ver si hay nuevas versiones publicadas.
        </p>
        <p>
          Cuando aplicás una actualización (ahora o programada), el CRM:
        </p>
        <ol className="list-decimal list-inside space-y-1 ml-2">
          <li>Crea un <strong>backup automático</strong> del sistema completo.</li>
          <li>Descarga el código nuevo de GitHub.</li>
          <li>Reconstruye el CRM con la versión actualizada.</li>
          <li>Aplica las migraciones de base de datos si corresponde.</li>
          <li>Reinicia el sistema con la versión nueva.</li>
        </ol>
        <p className="mt-2">
          <strong>El CRM queda inaccesible durante el proceso (2-5 minutos)</strong>.
          Si algo falla, el sistema restaura el backup automáticamente.
        </p>
        <p>
          Para reducir interrupción, podés <strong>programar</strong> la actualización
          para un horario fuera de tu jornada laboral.
        </p>
      </div>
    </details>
  )
}
