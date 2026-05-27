'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpen, LayoutDashboard, CheckCircle2, AlertCircle } from 'lucide-react'
import { WizardLayout } from '../components/WizardLayout'

interface Props {
  pasoActual: number
  totalPasos: number
  onAtras: () => void
  onCompletar: () => Promise<boolean>
  completando: boolean
}

export function PasoFinal({ pasoActual, totalPasos, onAtras, onCompletar, completando }: Props) {
  const router = useRouter()
  const [sinLicencia, setSinLicencia] = useState(false)

  useEffect(() => {
    const verificarLicencia = async () => {
      try {
        const r = await fetch('/api/licencia/actual', { cache: 'no-store' })
        const json = await r.json()
        if (json.ok && json.data) {
          const modo = json.data.modo
          setSinLicencia(modo === 'SIN_LICENCIA' || modo === 'BLOQUEADA')
        }
      } catch {
        // si falla, asumimos que tiene licencia para no asustar de más
      }
    }
    void verificarLicencia()
  }, [])

  const irACatalogos = async () => {
    const ok = await onCompletar()
    if (ok) router.replace('/crm/configuracion/catalogos')
  }

  const irADashboard = async () => {
    const ok = await onCompletar()
    if (ok) router.replace('/crm/dashboard')
  }

  return (
    <WizardLayout
      pasoActual={pasoActual}
      totalPasos={totalPasos}
      titulo="¡Configuración terminada!"
      descripcion="El CRM ya está listo para que empieces a operar. Antes de cargar tu primer cliente, te recomendamos un último paso."
      onAtras={onAtras}
      sinFooter
    >
      <div className="space-y-4">
        {/* Mensaje de éxito */}
        <div className="bg-green-50 border border-green-200 rounded-lg p-5 flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-green-900">Todo guardado correctamente</h3>
            <p className="mt-1 text-sm text-green-800">
              Podés modificar cualquiera de estas configuraciones en cualquier momento desde
              el menú <strong>Configuración</strong> del sidebar.
            </p>
          </div>
        </div>

        {/* Aviso prominente si saltearon la licencia */}
        {sinLicencia && (
          <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-5 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-amber-900">
                Tu CRM va a quedar en modo solo lectura
              </h3>
              <p className="mt-1 text-sm text-amber-800">
                No cargaste una licencia en el paso anterior. Vas a poder ver tu información
                pero <strong>no</strong> cargar pólizas, personas ni siniestros nuevos hasta
                que la subas desde <strong>Configuración → Licencia</strong>.
              </p>
            </div>
          </div>
        )}

        {/* Recomendación: revisar catálogos */}
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 shrink-0">
              <BookOpen className="h-5 w-5 text-amber-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-md font-semibold text-slate-900">
                Antes de empezar: revisá los catálogos
              </h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                El CRM viene con las compañías de seguros, ramos y coberturas más comunes en
                Argentina precargados. Antes de importar tu cartera o empezar a cargar pólizas,
                conviene que pases por <strong>Configuración → Catálogos</strong> y revises:
              </p>
              <ul className="mt-3 space-y-1.5 text-sm text-slate-600 list-disc list-inside">
                <li>Que estén todas las compañías con las que trabajás (si falta alguna, la agregás ahí)</li>
                <li>Que los ramos y coberturas coincidan con cómo las llamás en tu trabajo diario</li>
                <li>Que las equivalencias de coberturas estén configuradas — esto ayuda al agente IA a reconocer pólizas en PDFs</li>
              </ul>
            </div>
          </div>
        </div>

        {/* CTAs principales */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <button
            type="button"
            onClick={irACatalogos}
            disabled={completando}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-amber-500 bg-amber-50 text-amber-900 hover:bg-amber-100 transition-colors disabled:opacity-50"
          >
            <BookOpen className="h-4 w-4" />
            <span className="font-medium">
              {completando ? 'Guardando...' : 'Ir a Configuración → Catálogos'}
            </span>
          </button>
          <button
            type="button"
            onClick={irADashboard}
            disabled={completando}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <LayoutDashboard className="h-4 w-4" />
            <span className="font-medium">
              {completando ? 'Guardando...' : 'Ir al Dashboard'}
            </span>
          </button>
        </div>
      </div>
    </WizardLayout>
  )
}
