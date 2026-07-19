'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  CheckCircle2, Loader2, Circle, XCircle, Sparkles, FileText,
  ArrowLeft, AlertCircle,
} from 'lucide-react'
import { useAgentePDFPolling } from '@/lib/hooks/useAgentePDFPolling'
import { apiCall } from '@/lib/api-client'

type Paso = 'PDF cargado' | 'Analizando contenido con IA' | 'Extrayendo datos' | 'Identificando catálogos' | 'Preparando revisión'

const PASOS: Paso[] = [
  'PDF cargado',
  'Analizando contenido con IA',
  'Extrayendo datos',
  'Identificando catálogos',
  'Preparando revisión',
]

const TITULOS: Record<string, string> = {
  POLIZA_NUEVA: 'Analizando PDF de póliza',
  RENOVACION: 'Analizando PDF de renovación',
  ENDOSO: 'Analizando PDF de endoso',
}

function formatBytes(bytes: number | null) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function ProcesandoPDFPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const { estado, error: pollError } = useAgentePDFPolling(id, { intervaloMs: 2000 })
  const [pasoVisible, setPasoVisible] = useState(0)
  const [cancelando, setCancelando] = useState(false)

  // Avance visual automático cada 3s mientras el backend está PROCESANDO
  useEffect(() => {
    if (!estado) return
    if (estado.estado !== 'PROCESANDO' && estado.estado !== 'PENDIENTE') return
    const t = setInterval(() => {
      setPasoVisible(p => (p < PASOS.length - 1 ? p + 1 : p))
    }, 4000)
    return () => clearInterval(t)
    // Depende SOLO de la propiedad `estado.estado`, no del objeto entero — un
    // refresh del polling que llegue con misma prop no debe reiniciar el timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado?.estado])

  // Redirigir cuando termina la extracción
  useEffect(() => {
    if (!estado) return
    if (estado.estado === 'EXTRAIDO') {
      router.push(`/crm/agente-pdf/${id}/revisar`)
    } else if (estado.estado === 'APROBADO') {
      router.push(`/crm/agente-pdf/${id}/exito`)
    }
    // Depende SOLO de la propiedad `estado.estado` — mismo motivo que arriba.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado?.estado, id, router])

  async function cancelar() {
    if (!confirm('¿Cancelar el análisis? Se va a perder el trabajo hecho hasta ahora.')) return
    setCancelando(true)
    const r = await apiCall(`/api/agente-pdf/${id}/cancelar`, { method: 'POST' }, { mostrar_toast_en_error: false })
    if (r.ok) {
      router.push('/crm/dashboard')
    } else {
      setCancelando(false)
    }
  }

  const tipo = estado?.tipo_operacion
  const esFallido = estado?.estado === 'FALLIDO'
  const esCancelado = estado?.estado === 'CANCELADO'

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push('/crm/dashboard')}
          className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-800"
        >
          <ArrowLeft className="h-4 w-4" /> Volver al dashboard
        </button>
        {estado && !esFallido && !esCancelado && estado.estado !== 'EXTRAIDO' && (
          <button
            onClick={cancelar}
            disabled={cancelando}
            className="text-xs text-red-600 hover:underline disabled:opacity-50"
          >
            {cancelando ? 'Cancelando...' : 'Cancelar análisis'}
          </button>
        )}
      </div>

      <div>
        <h1 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-blue-600" />
          {tipo ? TITULOS[tipo] : 'Analizando PDF'}
        </h1>
        <p className="text-xs text-slate-600">
          El asistente está extrayendo los datos del PDF con inteligencia artificial.
        </p>
      </div>

      {/* Info del archivo */}
      {estado && (
        <div className="bg-white border border-slate-200 rounded p-3 flex items-center gap-3">
          <div className="h-10 w-10 rounded bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0">
            <FileText className="h-5 w-5 text-red-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-slate-800 truncate">{estado.nombre_archivo}</p>
            <p className="text-2xs text-slate-600">
              {formatBytes(estado.tamano_archivo)} ·{' '}
              {tipo === 'POLIZA_NUEVA' ? 'Póliza nueva' : tipo === 'RENOVACION' ? 'Renovación' : 'Endoso'}
            </p>
          </div>
        </div>
      )}

      {/* Estado FALLIDO */}
      {esFallido && (
        <div className="bg-white border border-red-200 rounded p-5 flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <XCircle className="h-6 w-6 text-red-500 shrink-0" />
            <div className="flex-1">
              <h2 className="text-sm font-semibold text-red-800">El análisis falló</h2>
              <p className="text-xs text-red-700 mt-1">
                {estado?.error_mensaje || 'Error desconocido al procesar el PDF'}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => router.back()} className="btn-secondary">
              Volver e intentar de nuevo
            </button>
            <button onClick={() => router.push('/crm/polizas/nueva')} className="btn-primary">
              Cargar manualmente
            </button>
          </div>
        </div>
      )}

      {/* Estado CANCELADO */}
      {esCancelado && (
        <div className="bg-white border border-slate-200 rounded p-5 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-slate-600" />
            <h2 className="text-sm font-semibold text-slate-700">Análisis cancelado</h2>
          </div>
          <button onClick={() => router.push('/crm/dashboard')} className="btn-secondary w-fit">
            Volver al dashboard
          </button>
        </div>
      )}

      {/* Stepper */}
      {!esFallido && !esCancelado && (
        <div className="bg-white border border-slate-200 rounded p-5 flex flex-col gap-3">
          {PASOS.map((paso, idx) => {
            const completado = idx < pasoVisible
            const actual = idx === pasoVisible
            return (
              <div key={paso} className="flex items-center gap-3">
                {completado ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                ) : actual ? (
                  <Loader2 className="h-5 w-5 text-blue-600 animate-spin shrink-0" />
                ) : (
                  <Circle className="h-5 w-5 text-slate-300 shrink-0" />
                )}
                <span
                  className={`text-xs ${
                    completado
                      ? 'text-slate-500 line-through'
                      : actual
                      ? 'text-slate-800 font-medium'
                      : 'text-slate-500'
                  }`}
                >
                  {paso}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Mensaje info */}
      {!esFallido && !esCancelado && (
        <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-800">
          <p className="font-medium">Esto tarda entre 30 segundos y 1 minuto.</p>
          <p className="text-2xs mt-1 text-blue-700">
            Podés dejar esta pantalla abierta o cerrarla — el análisis continúa en segundo plano y te vamos a avisar en la campana cuando termine.
          </p>
        </div>
      )}

      {pollError && (
        <div className="text-2xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
          Perdimos conexión con el servidor. Seguimos reintentando... ({pollError})
        </div>
      )}
    </div>
  )
}
