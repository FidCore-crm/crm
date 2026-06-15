'use client'

import { useEffect, useState } from 'react'
import { Upload, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { toast } from '@/lib/toast'
import { WizardLayout } from '../components/WizardLayout'

interface Props {
  pasoActual: number
  totalPasos: number
  onAtras: () => void
  onContinuar: () => void
  onSkip: () => void
}

interface EstadoLicencia {
  modo: 'ACTIVA' | 'GRACIA' | 'BLOQUEADA' | 'SIN_LICENCIA'
  licencia_activa: {
    cliente: string
    plan: string
    fecha_vencimiento: string
    dias_restantes: number
    es_permanente: boolean
  } | null
  instalacion_id: string
}

export function PasoLicencia({ pasoActual, totalPasos, onAtras, onContinuar, onSkip }: Props) {
  const [cargando, setCargando] = useState(true)
  const [estado, setEstado] = useState<EstadoLicencia | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => {
    void cargarEstado()
  }, [])

  const cargarEstado = async () => {
    try {
      const r = await fetch('/api/licencia/actual', { cache: 'no-store' })
      const json = await r.json()
      if (json.ok && json.data) setEstado(json.data)
    } catch {
      /* ignorar */
    } finally {
      setCargando(false)
    }
  }

  const procesarArchivo = async (file: File) => {
    if (!file.name.endsWith('.lic')) {
      toast.error('El archivo debe tener extensión .lic')
      return
    }
    setSubiendo(true)
    try {
      const contenido = await file.text()
      const payload = JSON.parse(contenido)
      const r = await fetch('/api/licencia/cargar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await r.json()
      if (!r.ok || !json.ok) {
        toast.error(json.error?.mensaje || 'No se pudo cargar la licencia')
        return
      }
      toast.exito('Licencia cargada correctamente')
      await cargarEstado()
    } catch (err: any) {
      toast.error('El archivo no es una licencia válida (debe ser JSON)')
    } finally {
      setSubiendo(false)
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) void procesarArchivo(file)
  }

  const tieneLicenciaActiva = estado?.modo === 'ACTIVA' || estado?.modo === 'GRACIA'

  // El "saltear" pasa por un confirm explícito porque las consecuencias del
  // modo solo-lectura no son obvias al leer "saltear este paso".
  const onSkipConConfirm = () => {
    const ok = window.confirm(
      'Si salteás este paso, el CRM va a quedar en MODO SOLO LECTURA hasta que cargues una licencia.\n\n' +
      'Vas a poder ver tu información pero NO cargar pólizas, personas ni siniestros nuevos.\n\n' +
      '¿Querés continuar de todos modos?'
    )
    if (ok) onSkip()
  }

  return (
    <WizardLayout
      pasoActual={pasoActual}
      totalPasos={totalPasos}
      titulo="Licencia del CRM"
      descripcion="La licencia es lo que habilita el CRM para operar. Sin licencia, el sistema entra en modo solo lectura: podés ver tu información pero no cargar pólizas ni clientes nuevos."
      onAtras={onAtras}
      onContinuar={onContinuar}
      onSkip={tieneLicenciaActiva ? undefined : onSkipConConfirm}
      continuarHabilitado={!subiendo}
    >
      {cargando ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Verificando licencia...
        </div>
      ) : tieneLicenciaActiva ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-green-900">Licencia activa</h3>
              <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-green-700">Cliente:</span>{' '}
                  <strong>{estado?.licencia_activa?.cliente}</strong>
                </div>
                <div>
                  <span className="text-green-700">Plan:</span>{' '}
                  <strong>{estado?.licencia_activa?.plan}</strong>
                </div>
                {!estado?.licencia_activa?.es_permanente && (
                  <>
                    <div>
                      <span className="text-green-700">Vencimiento:</span>{' '}
                      <strong>{estado?.licencia_activa?.fecha_vencimiento}</strong>
                    </div>
                    <div>
                      <span className="text-green-700">Días restantes:</span>{' '}
                      <strong>{estado?.licencia_activa?.dias_restantes}</strong>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Identificador de instalación */}
          <div className="bg-slate-50 border border-slate-200 rounded p-4">
            <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
              ID de esta instalación
            </h3>
            <code className="text-xs font-mono bg-white px-2 py-1 rounded border border-slate-200 text-slate-700 block break-all">
              {estado?.instalacion_id ?? 'desconocido'}
            </code>
            <p className="mt-2 text-xs text-slate-500">
              Si todavía no tenés tu archivo <code>.lic</code>, pasale este ID a tu contacto
              de FidCore para que te emita la licencia.
            </p>
          </div>

          {/* Drag-drop / upload */}
          <div
            onDragOver={e => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              dragOver ? 'border-orange-500 bg-orange-50' : 'border-slate-300 bg-white'
            }`}
          >
            <Upload className="h-8 w-8 text-slate-400 mx-auto mb-3" />
            <p className="text-sm text-slate-700 font-medium">
              Arrastrá tu archivo <code>.lic</code> acá
            </p>
            <p className="text-xs text-slate-500 mt-1">o</p>
            <label className="inline-block mt-2 cursor-pointer">
              <span className="btn-primary inline-flex items-center gap-2">
                {subiendo ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Elegir archivo
              </span>
              <input
                type="file"
                accept=".lic,application/json"
                className="hidden"
                onChange={e => {
                  if (e.target.files?.[0]) void procesarArchivo(e.target.files[0])
                  e.target.value = ''
                }}
              />
            </label>
          </div>

          {/* Aviso si saltea */}
          <div className="bg-amber-50 border border-amber-200 rounded p-4 flex items-start gap-3">
            <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-900">
              <strong>Si salteás este paso</strong>, el CRM funciona en modo solo lectura
              hasta que cargues una licencia válida desde{' '}
              <strong>Configuración → Licencia</strong>.
            </div>
          </div>
        </div>
      )}
    </WizardLayout>
  )
}
