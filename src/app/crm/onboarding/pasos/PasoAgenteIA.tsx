'use client'

import { useEffect, useState } from 'react'
import { Sparkles, CheckCircle2, ExternalLink, Loader2, Eye, EyeOff } from 'lucide-react'
import { toast } from '@/lib/toast'
import { WizardLayout } from '../components/WizardLayout'

interface Props {
  pasoActual: number
  totalPasos: number
  onAtras: () => void
  onContinuar: () => void
  onSkip: () => void
}

export function PasoAgenteIA({ pasoActual, totalPasos, onAtras, onContinuar, onSkip }: Props) {
  const [cargando, setCargando] = useState(true)
  const [yaConfigurada, setYaConfigurada] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [verApiKey, setVerApiKey] = useState(false)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    const cargar = async () => {
      try {
        const r = await fetch('/api/configuracion/anthropic', { cache: 'no-store' })
        const json = await r.json()
        if (json.ok && json.data?.configurada) setYaConfigurada(true)
      } catch {
        /* ignorar */
      } finally {
        setCargando(false)
      }
    }
    void cargar()
  }, [])

  const guardarYContinuar = async () => {
    if (!apiKey.trim()) {
      onSkip()
      return
    }
    setGuardando(true)
    try {
      const r = await fetch('/api/configuracion/anthropic', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey.trim() }),
      })
      const json = await r.json()
      if (!r.ok || !json.ok) {
        toast.error(json.error?.mensaje || 'No se pudo guardar la API key')
        return
      }
      toast.exito('API key guardada — agente IA activado')
      onContinuar()
    } catch (err: any) {
      toast.error(err.message || 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) {
    return (
      <WizardLayout pasoActual={pasoActual} totalPasos={totalPasos} titulo="Agente IA para PDFs">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
        </div>
      </WizardLayout>
    )
  }

  return (
    <WizardLayout
      pasoActual={pasoActual}
      totalPasos={totalPasos}
      titulo="Agente IA para PDFs (opcional)"
      descripcion="El agente IA lee los PDFs de pólizas que mandan las compañías y carga los datos en el CRM automáticamente: cliente, número de póliza, vigencia, coberturas. Te ahorra cargar pólizas a mano."
      onAtras={onAtras}
      onContinuar={guardarYContinuar}
      onSkip={onSkip}
      continuarHabilitado={!guardando}
      continuarLoading={guardando}
      continuarLabel={apiKey.trim() ? 'Activar agente IA' : 'Continuar'}
    >
      {yaConfigurada ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-5 flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-green-900">Agente IA ya configurado</h3>
            <p className="mt-1 text-sm text-green-800">
              Si necesitás cambiar la API key, lo hacés desde <strong>Configuración → Agente IA</strong>.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Cómo funciona */}
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100 shrink-0">
                <Sparkles className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">¿Cómo funciona?</h3>
                <ul className="mt-2 space-y-1.5 text-sm text-slate-600 list-disc list-inside">
                  <li>Subís el PDF de una póliza nueva, renovación o endoso desde el CRM</li>
                  <li>El agente lo lee, identifica al cliente y carga los datos automáticamente</li>
                  <li>Vos revisás antes de aprobar — siempre tenés el control final</li>
                  <li>Costo aproximado: USD 0,02 por PDF procesado (corre por tu cuenta de Anthropic)</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Cómo obtener la API key */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-blue-900 mb-2">¿Cómo obtengo la API key?</h3>
            <ol className="text-sm text-blue-900 space-y-1 list-decimal list-inside">
              <li>
                Andá a{' '}
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline inline-flex items-center gap-1"
                >
                  console.anthropic.com/settings/keys
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
              <li>Creá una cuenta (si no tenés)</li>
              <li>Cargá saldo (USD 5–10 alcanzan para meses de uso)</li>
              <li>Apretá <strong>Create Key</strong>, copiala y pegala acá abajo</li>
            </ol>
          </div>

          {/* Input de la API key */}
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              API key de Anthropic
            </label>
            <div className="relative">
              <input
                type={verApiKey ? 'text' : 'password'}
                className="form-input w-full pr-10"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-ant-api03-..."
              />
              <button
                type="button"
                onClick={() => setVerApiKey(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600"
              >
                {verApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-600">
              Se guarda encriptada en tu CRM. No se comparte con nadie.
            </p>
          </div>
        </div>
      )}
    </WizardLayout>
  )
}
