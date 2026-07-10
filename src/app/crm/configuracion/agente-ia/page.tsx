'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Sparkles, Eye, EyeOff, ExternalLink, CheckCircle,
  Loader2, RefreshCw, Trash2, KeyRound, Save, Zap, FileText,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { apiCall } from '@/lib/api-client'

type FamiliaId = 'sonnet' | 'opus' | 'haiku'

const FAMILIAS: Array<{
  id: FamiliaId
  nombre: string
  descripcion: string
  detalle: string
  costoRelativo: string
}> = [
  {
    id: 'sonnet',
    nombre: 'Sonnet',
    descripcion: 'Recomendado',
    detalle: 'Equilibrio entre precisión y costo. Suficiente para la mayoría de las tareas.',
    costoRelativo: 'Costo intermedio',
  },
  {
    id: 'opus',
    nombre: 'Opus',
    descripcion: 'Máxima calidad',
    detalle: 'Más preciso en tareas complejas. Es ~5× más caro que Sonnet.',
    costoRelativo: 'Más caro',
  },
  {
    id: 'haiku',
    nombre: 'Haiku',
    descripcion: 'Más rápido y económico',
    detalle: 'Menor precisión pero 3× más barato que Sonnet. Ideal para volúmenes grandes.',
    costoRelativo: 'Más barato',
  },
]

interface EstadoConfig {
  ok: boolean
  configurada: boolean
  familia: FamiliaId
  modelo_resuelto: string | null
  uso_total_tokens: number
  uso_total_costo_usd: number
  uso_mes_tokens: number
  uso_mes_llamadas: number
  reset_mes: string | null
  ultima_validacion: string | null
  ultima_validacion_ok: boolean | null
  key_preview: string | null
  modulo_ia_pdf_polizas_activo?: boolean
}

function formatRelativo(iso: string | null): string {
  if (!iso) return 'Nunca'
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'hace instantes'
  if (diffMin < 60) return `hace ${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `hace ${diffH} h`
  const diffD = Math.floor(diffH / 24)
  return `hace ${diffD} día${diffD !== 1 ? 's' : ''}`
}

function Toast({ msg, tipo, onClose }: { msg: string; tipo: 'ok' | 'error' | 'info'; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4500)
    return () => clearTimeout(t)
  }, [onClose])
  const color =
    tipo === 'ok' ? 'bg-green-600' : tipo === 'error' ? 'bg-red-600' : 'bg-slate-800'
  return (
    <div className={`fixed bottom-4 right-4 z-50 ${color} text-white text-sm px-4 py-2 rounded shadow-lg max-w-md`}>
      {msg}
    </div>
  )
}

export default function AgenteIaPage() {
  const router = useRouter()
  const { usuario, loading: authLoading, isAdmin } = useAuth()

  const [cargando, setCargando] = useState(true)
  const [estado, setEstado] = useState<EstadoConfig | null>(null)

  const [modoEditar, setModoEditar] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [mostrarKey, setMostrarKey] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const [probando, setProbando] = useState(false)
  const [eliminando, setEliminando] = useState(false)

  const [_familiaSeleccionada, setFamiliaSeleccionada] = useState<FamiliaId>('sonnet')
  const [guardandoFamilia, setGuardandoFamilia] = useState(false)

  const [guardandoModuloPDF, setGuardandoModuloPDF] = useState(false)

  const [toast, setToast] = useState<{ msg: string; tipo: 'ok' | 'error' | 'info' } | null>(null)
  const mostrarToast = (msg: string, tipo: 'ok' | 'error' | 'info' = 'info') => setToast({ msg, tipo })

  // Redirigir si no es admin
  useEffect(() => {
    if (!authLoading && (!usuario || !isAdmin)) {
      router.push('/crm/dashboard')
    }
  }, [authLoading, usuario, isAdmin, router])

  const cargarEstado = useCallback(async () => {
    setCargando(true)
    // Este endpoint devuelve campos en el root (legacy) — apiCall los expone en data.
    const r = await apiCall<EstadoConfig>('/api/configuracion/anthropic', undefined, { mostrar_toast_en_error: false })
    if (r.ok && r.data) {
      setEstado({ ...r.data, ok: true })
      if (r.data.familia) setFamiliaSeleccionada(r.data.familia)
    } else if (!r.ok) {
      mostrarToast(r.error?.mensaje ?? 'Error al cargar la configuración', 'error')
    }
    setCargando(false)
  }, [])

  useEffect(() => {
    if (!authLoading && isAdmin) cargarEstado()
  }, [authLoading, isAdmin, cargarEstado])

  async function guardarKey() {
    const key = apiKeyInput.trim()
    if (!key.startsWith('sk-ant-')) {
      mostrarToast('La API key debe empezar con "sk-ant-"', 'error')
      return
    }
    setGuardando(true)
    const r = await apiCall<{ test?: { ok: boolean; error?: string } }>('/api/configuracion/anthropic', {
      method: 'POST',
      body: { api_key: key },
    }, { mostrar_toast_en_error: false })

    if (!r.ok) {
      mostrarToast(r.error?.mensaje ?? 'Error al guardar', 'error')
      setGuardando(false)
      return
    }

    if (r.data?.test?.ok) {
      mostrarToast('IA configurada correctamente', 'ok')
    } else {
      mostrarToast(`Key guardada, pero el test falló: ${r.data?.test?.error || 'error desconocido'}`, 'error')
    }
    setApiKeyInput('')
    setMostrarKey(false)
    setModoEditar(false)
    await cargarEstado()
    setGuardando(false)
  }

  async function probarConexion() {
    setProbando(true)
    const r = await apiCall<{ tokens_input: number; tokens_output: number }>('/api/configuracion/anthropic/test', {
      method: 'POST',
      body: {},
    }, { mostrar_toast_en_error: false })
    if (r.ok && r.data) {
      mostrarToast(`Conexión exitosa (${r.data.tokens_input}/${r.data.tokens_output} tokens)`, 'ok')
    } else {
      mostrarToast(r.error?.mensaje ?? 'Error al probar conexión', 'error')
    }
    await cargarEstado()
    setProbando(false)
  }

  async function eliminarConfig() {
    if (!confirm('¿Estás seguro de eliminar la configuración de Anthropic?')) return
    if (!confirm('Confirmar: las funciones inteligentes dejarán de estar disponibles. ¿Continuar?')) return
    setEliminando(true)
    const r = await apiCall('/api/configuracion/anthropic', { method: 'DELETE' }, { mostrar_toast_en_error: false })
    if (r.ok) {
      mostrarToast('Configuración eliminada', 'ok')
      await cargarEstado()
    } else {
      mostrarToast(r.error?.mensaje ?? 'Error al eliminar', 'error')
    }
    setEliminando(false)
  }

  async function toggleModuloPDF(nuevo: boolean) {
    if (!estado?.configurada && nuevo) {
      mostrarToast('Configurá la API key primero', 'error')
      return
    }
    setGuardandoModuloPDF(true)
    const r = await apiCall('/api/configuracion/anthropic', {
      method: 'PATCH',
      body: { modulo_ia_pdf_polizas_activo: nuevo },
    }, { mostrar_toast_en_error: false })
    if (r.ok) {
      mostrarToast(nuevo ? 'Módulo activado' : 'Módulo desactivado', 'ok')
      await cargarEstado()
    } else {
      mostrarToast(r.error?.mensaje ?? 'Error al actualizar módulo', 'error')
    }
    setGuardandoModuloPDF(false)
  }

  async function guardarFamilia(nueva: FamiliaId) {
    if (nueva === estado?.familia) return
    setGuardandoFamilia(true)
    const r = await apiCall('/api/configuracion/anthropic', {
      method: 'PATCH',
      body: { familia: nueva },
    }, { mostrar_toast_en_error: false })
    if (r.ok) {
      mostrarToast(`Modelo cambiado a ${nueva.charAt(0).toUpperCase()}${nueva.slice(1)}`, 'ok')
      await cargarEstado()
    } else {
      mostrarToast(r.error?.mensaje ?? 'Error al actualizar modelo', 'error')
      setFamiliaSeleccionada(estado?.familia || 'sonnet')
    }
    setGuardandoFamilia(false)
  }

  if (authLoading || !isAdmin) {
    return <div className="p-8 text-sm text-slate-500">Verificando permisos...</div>
  }

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push('/crm/configuracion')}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="h-4 w-4" /> Volver
        </button>
      </div>
      <div>
        <h1 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-blue-600" />
          Inteligencia Artificial
        </h1>
        <p className="text-xs text-slate-500">
          Configurá la integración con Claude (Anthropic)
        </p>
      </div>

      {cargando || !estado ? (
        <div className="bg-white border border-slate-200 rounded p-6 space-y-3">
          <div className="h-4 bg-slate-100 rounded w-1/3 animate-pulse" />
          <div className="h-3 bg-slate-100 rounded w-2/3 animate-pulse" />
          <div className="h-3 bg-slate-100 rounded w-1/2 animate-pulse" />
        </div>
      ) : (
        <>
          {/* Sección 1 — Estado */}
          {!estado.configurada || modoEditar ? (
            <div className="bg-white border border-slate-200 rounded p-5">
              <div className="flex items-start gap-3 mb-4">
                <div className="h-10 w-10 rounded bg-blue-50 flex items-center justify-center shrink-0">
                  <Sparkles className="h-5 w-5 text-blue-600" />
                </div>
                <div className="flex-1">
                  <h2 className="text-sm font-semibold text-slate-800">
                    Activá las funciones inteligentes
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Conectá tu cuenta de Anthropic para habilitar Claude en el CRM.
                  </p>
                </div>
              </div>

              <ul className="text-xs text-slate-600 space-y-1.5 mb-4 pl-2">
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-3.5 w-3.5 text-green-600 shrink-0" />
                  Importación inteligente de cartera
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-3.5 w-3.5 text-slate-300 shrink-0" />
                  <span className="text-slate-500">[Próximamente] Agente conversacional del CRM</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-3.5 w-3.5 text-slate-300 shrink-0" />
                  <span className="text-slate-500">[Próximamente] Agente de renovaciones</span>
                </li>
              </ul>

              <div className="bg-slate-50 border border-slate-200 rounded p-3 mb-4 text-xs text-slate-600">
                <p className="font-medium text-slate-700 mb-1.5">¿Cómo obtener la API key?</p>
                <ol className="space-y-0.5 list-decimal list-inside">
                  <li>Creá una cuenta en console.anthropic.com</li>
                  <li>Cargá saldo (mínimo recomendado: USD 5)</li>
                  <li>Generá una nueva API key</li>
                  <li>Pegala abajo y presioná "Validar y guardar"</li>
                </ol>
                <a
                  href="https://console.anthropic.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-600 hover:underline mt-2"
                >
                  Ir a console.anthropic.com <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <label className="block text-xs font-medium text-slate-600 mb-1">
                API key de Anthropic
              </label>
              <div className="relative">
                <input
                  type={mostrarKey ? 'text' : 'password'}
                  value={apiKeyInput}
                  onChange={e => setApiKeyInput(e.target.value)}
                  placeholder="sk-ant-api03-..."
                  className="form-input w-full pr-10 font-mono text-xs"
                  disabled={guardando}
                />
                <button
                  type="button"
                  onClick={() => setMostrarKey(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                >
                  {mostrarKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-2xs text-slate-400 mt-1">
                La key se guarda encriptada con AES-256-GCM.
              </p>

              <div className="flex gap-2 mt-4">
                <button
                  onClick={guardarKey}
                  disabled={guardando || !apiKeyInput.trim()}
                  className="btn-primary flex items-center gap-1.5 disabled:opacity-50"
                >
                  {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Validar y guardar
                </button>
                {modoEditar && (
                  <button
                    onClick={() => {
                      setModoEditar(false)
                      setApiKeyInput('')
                    }}
                    className="btn-secondary"
                    disabled={guardando}
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded p-5">
              <div className="flex items-start gap-3 mb-4">
                <div className="h-10 w-10 rounded bg-green-50 flex items-center justify-center shrink-0">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                </div>
                <div className="flex-1">
                  <h2 className="text-sm font-semibold text-slate-800">
                    IA configurada y funcionando
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Las funciones inteligentes del CRM están activas.
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 text-2xs font-medium px-2 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">
                  <Zap className="h-3 w-3" /> Activa
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="border border-slate-200 rounded p-3">
                  <div className="text-2xs text-slate-500 uppercase">Modelo en uso</div>
                  <div className="text-sm font-medium text-slate-800 mt-0.5">
                    Claude {estado.familia.charAt(0).toUpperCase() + estado.familia.slice(1)}
                  </div>
                  {estado.modelo_resuelto && (
                    <div className="text-2xs text-slate-500 font-mono mt-0.5">
                      {estado.modelo_resuelto}
                    </div>
                  )}
                </div>
                <div className="border border-slate-200 rounded p-3">
                  <div className="text-2xs text-slate-500 uppercase">API key</div>
                  <div className="text-sm font-mono text-slate-800 mt-0.5">
                    {estado.key_preview || '—'}
                  </div>
                </div>
                <div className="border border-slate-200 rounded p-3">
                  <div className="text-2xs text-slate-500 uppercase">Última validación</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-sm text-slate-800">{formatRelativo(estado.ultima_validacion)}</span>
                    {estado.ultima_validacion_ok === true && (
                      <span className="text-2xs px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">OK</span>
                    )}
                    {estado.ultima_validacion_ok === false && (
                      <span className="text-2xs px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">ERROR</span>
                    )}
                  </div>
                </div>
                <div className="border border-slate-200 rounded p-3">
                  <div className="text-2xs text-slate-500 uppercase">Estado</div>
                  <div className="text-sm font-medium text-green-700 mt-0.5">Activa</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={probarConexion}
                  disabled={probando}
                  className="btn-secondary flex items-center gap-1.5 disabled:opacity-50"
                >
                  {probando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Probar conexión
                </button>
                <button
                  onClick={() => {
                    if (confirm('Vas a cambiar la API key. ¿Continuar?')) {
                      setModoEditar(true)
                    }
                  }}
                  className="btn-secondary flex items-center gap-1.5"
                >
                  <KeyRound className="h-4 w-4" />
                  Cambiar API key
                </button>
                <button
                  onClick={eliminarConfig}
                  disabled={eliminando}
                  className="btn-danger flex items-center gap-1.5 disabled:opacity-50"
                >
                  {eliminando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Eliminar configuración
                </button>
              </div>
            </div>
          )}

          {/* Sección 2 — Estadísticas de uso */}
          <div className="bg-white border border-slate-200 rounded p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-3">Estadísticas de uso</h2>
            <div className="grid grid-cols-4 gap-3">
              <div className="border border-slate-200 rounded p-3">
                <div className="text-2xs text-slate-500 uppercase">Tokens este mes</div>
                <div className="text-lg font-semibold text-slate-800 mt-0.5 font-mono">
                  {estado.uso_mes_tokens.toLocaleString('es-AR')}
                </div>
              </div>
              <div className="border border-slate-200 rounded p-3">
                <div className="text-2xs text-slate-500 uppercase">Llamadas este mes</div>
                <div className="text-lg font-semibold text-slate-800 mt-0.5 font-mono">
                  {estado.uso_mes_llamadas}
                </div>
              </div>
              <div className="border border-slate-200 rounded p-3">
                <div className="text-2xs text-slate-500 uppercase">Tokens totales</div>
                <div className="text-lg font-semibold text-slate-800 mt-0.5 font-mono">
                  {estado.uso_total_tokens.toLocaleString('es-AR')}
                </div>
              </div>
              <div className="border border-slate-200 rounded p-3">
                <div className="text-2xs text-slate-500 uppercase">Costo total</div>
                <div className="text-lg font-semibold text-slate-800 mt-0.5 font-mono">
                  ${estado.uso_total_costo_usd.toFixed(2)} <span className="text-xs font-normal text-slate-500">USD</span>
                </div>
              </div>
            </div>
            <p className="text-2xs text-slate-400 mt-3">
              El consumo se factura directamente a tu cuenta de Anthropic.
            </p>
            <a
              href="https://console.anthropic.com/usage"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mt-1"
            >
              Ver consumo detallado en Anthropic <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          {/* Sección 2.5 — Módulos disponibles */}
          <div className="bg-white border border-slate-200 rounded p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-1">Módulos disponibles</h2>
            <p className="text-2xs text-slate-500 mb-4">
              Activá o desactivá las funciones inteligentes del CRM.
            </p>

            <div className="border border-slate-200 rounded p-4">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded bg-blue-50 flex items-center justify-center shrink-0">
                  <FileText className="h-5 w-5 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-slate-800">
                        Asistente para carga de pólizas y endosos desde PDF
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Subí PDFs de las compañías y el sistema extrae los datos automáticamente para crear pólizas, renovaciones y endosos.
                      </p>
                    </div>
                    <label className="inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        disabled={!estado.configurada || guardandoModuloPDF}
                        checked={!!estado.modulo_ia_pdf_polizas_activo}
                        onChange={e => toggleModuloPDF(e.target.checked)}
                      />
                      <div className="relative w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 peer-disabled:opacity-50 peer-disabled:cursor-not-allowed" />
                    </label>
                  </div>

                  <ul className="text-2xs text-slate-600 mt-3 space-y-0.5 pl-1">
                    <li>• Funciona con Federación Patronal, San Cristóbal, Sancor, Mercantil Andina, Provincia, La Segunda y más</li>
                    <li>• Costo aproximado: $0.05 USD por PDF procesado</li>
                    <li>• Requiere API key de Anthropic configurada</li>
                  </ul>

                  {!estado.configurada && (
                    <p className="text-2xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-3">
                      Configurá tu API key primero para activar este módulo.
                    </p>
                  )}

                  {estado.configurada && estado.modulo_ia_pdf_polizas_activo && (
                    <span className="inline-flex items-center gap-1 text-2xs font-medium px-2 py-0.5 rounded bg-green-50 text-green-700 border border-green-200 mt-3">
                      <Zap className="h-3 w-3" /> Activo
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Sección 3 — Información sobre costos */}
          <div className="bg-white border border-slate-200 rounded p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-3">Costos estimados</h2>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left border-b border-slate-200">
                  <th className="py-2 text-slate-600 font-medium">Operación</th>
                  <th className="py-2 text-slate-600 font-medium text-right">Costo estimado</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                <tr className="border-b border-slate-100">
                  <td className="py-2">Importar 500 registros</td>
                  <td className="py-2 text-right font-mono">~$0.50–1.00 USD</td>
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="py-2">Importar 2000 registros</td>
                  <td className="py-2 text-right font-mono">~$2–4 USD</td>
                </tr>
                <tr>
                  <td className="py-2 text-slate-500">Próximamente: agente conversacional</td>
                  <td className="py-2 text-right font-mono text-slate-500">~$0.003 por pregunta</td>
                </tr>
              </tbody>
            </table>
            <a
              href="https://www.anthropic.com/pricing"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mt-3"
            >
              Ver precios oficiales de Anthropic <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          {/* Sección 4 — Selector de familia de modelo */}
          <div className="bg-white border border-slate-200 rounded p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Modelo de Claude</h2>
                <p className="text-2xs text-slate-500 mt-0.5">
                  Elegí por rendimiento y costo. El sistema selecciona automáticamente la versión más nueva vigente de la familia que elijas.
                </p>
              </div>
              {guardandoFamilia && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {FAMILIAS.map(f => {
                const seleccionada = estado.familia === f.id
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => guardarFamilia(f.id)}
                    disabled={guardandoFamilia || !estado.configurada}
                    className={`text-left border rounded p-3 transition disabled:opacity-50 disabled:cursor-not-allowed ${
                      seleccionada
                        ? 'border-blue-500 bg-blue-50/40 ring-2 ring-blue-500/20'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold text-slate-800">
                        Claude {f.nombre}
                      </span>
                      {seleccionada && (
                        <CheckCircle className="h-4 w-4 text-blue-600" />
                      )}
                    </div>
                    <div className="text-2xs text-slate-500 mb-2">{f.descripcion}</div>
                    <p className="text-2xs text-slate-600 leading-relaxed">{f.detalle}</p>
                    <div className="mt-2 inline-block text-2xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                      {f.costoRelativo}
                    </div>
                  </button>
                )
              })}
            </div>

            {estado.modelo_resuelto && (
              <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded">
                <div className="text-2xs text-slate-500 uppercase mb-1">
                  Versión actual en uso
                </div>
                <div className="font-mono text-xs text-slate-800">
                  {estado.modelo_resuelto}
                </div>
                <p className="text-2xs text-slate-500 mt-1.5 leading-relaxed">
                  El sistema detecta automáticamente cuando Anthropic publica una versión nueva y se actualiza solo. Si Anthropic discontinúa esta versión, el CRM la reemplaza sin interrumpir el servicio.
                </p>
              </div>
            )}

            {!estado.configurada && (
              <p className="text-2xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-3">
                Configurá la API key arriba para poder elegir el modelo.
              </p>
            )}
          </div>
        </>
      )}

      {toast && <Toast msg={toast.msg} tipo={toast.tipo} onClose={() => setToast(null)} />}
    </div>
  )
}
