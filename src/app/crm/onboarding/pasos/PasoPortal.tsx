'use client'

import { useEffect, useState } from 'react'
import { Users, Loader2 } from 'lucide-react'
import { toast } from '@/lib/toast'
import { WizardLayout } from '../components/WizardLayout'

interface Props {
  pasoActual: number
  totalPasos: number
  onAtras: () => void
  onContinuar: () => void
  onSkip: () => void
}

export function PasoPortal({ pasoActual, totalPasos, onAtras, onContinuar, onSkip }: Props) {
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [activo, setActivo] = useState(false)
  const [textoBienvenida, setTextoBienvenida] = useState('')

  useEffect(() => {
    const cargar = async () => {
      try {
        const r = await fetch('/api/configuracion/portal-cliente', { cache: 'no-store' })
        const json = await r.json()
        if (json.ok && json.data) {
          setActivo(json.data.activo ?? false)
          setTextoBienvenida(json.data.texto_bienvenida ?? '')
        }
      } catch {
        /* ignorar */
      } finally {
        setCargando(false)
      }
    }
    void cargar()
  }, [])

  const guardarYContinuar = async () => {
    setGuardando(true)
    try {
      const r = await fetch('/api/configuracion/portal-cliente', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo, texto_bienvenida: textoBienvenida.trim() || null }),
      })
      const json = await r.json()
      if (!r.ok || !json.ok) {
        toast.error(json.error?.mensaje || 'No se pudo guardar la configuración del portal')
        return
      }
      onContinuar()
    } catch (err: any) {
      toast.error(err.message || 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) {
    return (
      <WizardLayout pasoActual={pasoActual} totalPasos={totalPasos} titulo="Portal del Asegurado">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
        </div>
      </WizardLayout>
    )
  }

  return (
    <WizardLayout
      pasoActual={pasoActual}
      totalPasos={totalPasos}
      titulo="Portal del Asegurado (opcional)"
      descripcion="El Portal del Asegurado es una página pública (sin contraseña) donde tus asegurados pueden ver sus pólizas, descargarse la documentación y consultar teléfonos de asistencia 24hs. Vos generás un link único por cliente y se lo mandás por WhatsApp o email."
      onAtras={onAtras}
      onContinuar={guardarYContinuar}
      onSkip={onSkip}
      continuarHabilitado={!guardando}
      continuarLoading={guardando}
    >
      <div className="space-y-4">
        {/* Toggle activación */}
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 shrink-0">
              <Users className="h-5 w-5 text-blue-600" />
            </div>
            <div className="flex-1">
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Activar Portal del Asegurado</h3>
                  <p className="text-sm text-slate-600 mt-1">
                    Si lo dejás apagado, podés activarlo después en Configuración → Portal del Asegurado.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={activo}
                  onChange={e => setActivo(e.target.checked)}
                  className="h-5 w-9 rounded-full appearance-none bg-slate-300 checked:bg-orange-500 transition-colors cursor-pointer relative
                    before:content-[''] before:absolute before:top-0.5 before:left-0.5 before:h-4 before:w-4 before:bg-white before:rounded-full before:transition-transform
                    checked:before:translate-x-4"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Beneficios */}
        <div className="bg-slate-50 border border-slate-200 rounded p-4">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
            ¿Qué ven tus clientes?
          </h3>
          <ul className="text-sm text-slate-700 space-y-1 list-disc list-inside">
            <li>Sus pólizas vigentes con descarga de PDF</li>
            <li>Sus siniestros activos con seguimiento del estado</li>
            <li>Teléfonos de asistencia 24hs de las compañías</li>
            <li>Tu nombre + WhatsApp para contactarte directamente</li>
            <li>Botón para denunciar un siniestro (con sus datos precargados)</li>
          </ul>
        </div>

        {/* Texto de bienvenida (solo si activo) */}
        {activo && (
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Mensaje de bienvenida (opcional)
            </label>
            <p className="text-xs text-slate-500 mb-3">
              Aparece arriba de las pólizas cuando el cliente entra al portal.
            </p>
            <textarea
              className="form-input w-full"
              rows={3}
              value={textoBienvenida}
              onChange={e => setTextoBienvenida(e.target.value)}
              placeholder="Ej: ¡Bienvenido a tu portal! Acá podés consultar tus pólizas y denunciar siniestros. Cualquier duda, escribime."
            />
          </div>
        )}
      </div>
    </WizardLayout>
  )
}
