'use client'

import { Lock, Award } from 'lucide-react'
import { PoweredByFidCore } from '@/components/PoweredByFidCore'

export default function FooterPortal({
  organizacion,
}: {
  organizacion: {
    nombre: string
    telefono: string
    email: string
    matriculado: boolean
  }
}) {
  return (
    <footer className="mt-8 pt-6 pb-8 border-t border-slate-200 px-4">
      <div className="max-w-2xl mx-auto flex flex-col gap-4 text-center">
        {/* Datos del PAS */}
        {(organizacion.nombre || organizacion.telefono || organizacion.email) && (
          <div className="flex flex-col gap-1">
            {organizacion.nombre && (
              <p className="text-sm font-semibold text-slate-700 break-words">{organizacion.nombre}</p>
            )}
            <div className="flex items-center justify-center flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
              {organizacion.telefono && <span className="break-words">{organizacion.telefono}</span>}
              {organizacion.telefono && organizacion.email && <span className="text-slate-300">•</span>}
              {organizacion.email && <span className="break-all">{organizacion.email}</span>}
            </div>
            {organizacion.matriculado && (
              <div className="inline-flex items-center justify-center gap-1.5 mt-1 text-2xs text-slate-500">
                <Award className="h-3 w-3 text-slate-400" />
                Productor matriculado SSN
              </div>
            )}
          </div>
        )}

        {/* Aviso de privacidad */}
        <div className="flex items-start gap-2 max-w-md mx-auto bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
          <Lock className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
          <p className="text-2xs text-slate-500 text-left leading-relaxed">
            Este portal solo expone tus datos personales a vos. Tu información está protegida y
            es accesible únicamente con tu link único.
          </p>
        </div>

        {/* Powered by FidCore (solo modo VPS/SaaS-managed) */}
        <PoweredByFidCore align="center" className="mt-2" />
      </div>
    </footer>
  )
}
