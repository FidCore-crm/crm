'use client'

import { Phone } from 'lucide-react'

export interface AsistenciaData {
  compania_id: string
  compania: string
  telefono: string
  nombre_boton: string
}

export default function AsistenciaButton({ asistencia }: { asistencia: AsistenciaData }) {
  const telLimpio = asistencia.telefono.replace(/[^\d+]/g, '')

  return (
    <a
      href={`tel:${telLimpio}`}
      className="flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm hover:border-green-300 hover:bg-green-50 active:bg-green-100 transition-colors min-h-[56px]"
      aria-label={`Llamar a ${asistencia.nombre_boton}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
          <Phone className="h-4 w-4 text-green-700" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{asistencia.nombre_boton}</p>
          <p className="text-xs text-slate-500 truncate">{asistencia.compania}</p>
        </div>
      </div>
      <span className="text-sm font-mono text-slate-700 shrink-0">{asistencia.telefono}</span>
    </a>
  )
}
