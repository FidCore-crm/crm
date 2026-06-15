'use client'

import { Sparkles, Shield, Mail, FileText, Users, BookOpen } from 'lucide-react'
import { WizardLayout } from '../components/WizardLayout'

interface Props {
  pasoActual: number
  totalPasos: number
  onContinuar: () => void
  nombreUsuario?: string
}

export function PasoBienvenida({ pasoActual, totalPasos, onContinuar, nombreUsuario }: Props) {
  return (
    <WizardLayout
      pasoActual={pasoActual}
      totalPasos={totalPasos}
      titulo={nombreUsuario ? `¡Bienvenido, ${nombreUsuario}!` : '¡Bienvenido a FidCore!'}
      descripcion="Vamos a configurar tu CRM en unos minutos. Vas a poder saltear los pasos opcionales y configurarlos después si querés."
      onContinuar={onContinuar}
      continuarLabel="Empezar"
    >
      <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100 shrink-0">
            <Sparkles className="h-5 w-5 text-orange-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">¿Qué vamos a configurar?</h3>
            <p className="mt-1 text-sm text-slate-600">
              Los datos básicos para que el CRM funcione con tu identidad de productor.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <div className="flex items-center gap-3 p-3 rounded border border-slate-100 bg-slate-50">
            <Shield className="h-4 w-4 text-blue-600 shrink-0" />
            <span className="text-sm text-slate-700">Tu perfil profesional</span>
          </div>
          <div className="flex items-center gap-3 p-3 rounded border border-slate-100 bg-slate-50">
            <FileText className="h-4 w-4 text-blue-600 shrink-0" />
            <span className="text-sm text-slate-700">Licencia del CRM</span>
          </div>
          <div className="flex items-center gap-3 p-3 rounded border border-slate-100 bg-slate-50">
            <Mail className="h-4 w-4 text-blue-600 shrink-0" />
            <span className="text-sm text-slate-700">Envío de correos</span>
          </div>
          <div className="flex items-center gap-3 p-3 rounded border border-slate-100 bg-slate-50">
            <Sparkles className="h-4 w-4 text-blue-600 shrink-0" />
            <span className="text-sm text-slate-700">Agente IA para PDFs (opcional)</span>
          </div>
          <div className="flex items-center gap-3 p-3 rounded border border-slate-100 bg-slate-50">
            <Users className="h-4 w-4 text-blue-600 shrink-0" />
            <span className="text-sm text-slate-700">Portal del Cliente (opcional)</span>
          </div>
          <div className="flex items-center gap-3 p-3 rounded border border-slate-100 bg-slate-50">
            <BookOpen className="h-4 w-4 text-blue-600 shrink-0" />
            <span className="text-sm text-slate-700">Revisión de catálogos</span>
          </div>
        </div>

        <div className="text-xs text-slate-500 pt-2 border-t border-slate-100">
          Si cerrás el navegador a la mitad, podés volver y retomar desde donde quedaste.
        </div>
      </div>
    </WizardLayout>
  )
}
