'use client'

import { useState, ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

// Wrapper para envolver cajas de secciones que quieren tener
// header propio + toggle expandir/colapsar. Uso: envolver contenido
// que NO tiene ya su propio mecanismo de colapsado (HistorialPoliza,
// GestorArchivos, etc. ya lo tienen — no envolverlos con esto).
interface Props {
  titulo: string
  contador?: number | string | null
  defaultOpen?: boolean
  icono?: ReactNode
  accion?: ReactNode // botón/link opcional en el header (ej: "+ Nuevo")
  children: ReactNode
}

export default function CajaColapsable({
  titulo,
  contador,
  defaultOpen = true,
  icono,
  accion,
  children,
}: Props) {
  const [abierto, setAbierto] = useState(defaultOpen)
  const tieneContador = contador !== undefined && contador !== null && contador !== ''

  return (
    <div className="bg-white border border-slate-200 rounded overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50">
        <button
          onClick={() => setAbierto(v => !v)}
          className="flex-1 flex items-center gap-2 px-3 py-2 hover:bg-slate-100 transition-colors text-left"
        >
          {icono}
          <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">
            {titulo}
            {tieneContador && <span className="ml-1 text-slate-400">({contador})</span>}
          </h3>
          <span className="ml-auto">
            {abierto
              ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
              : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
          </span>
        </button>
        {accion && (
          <div className="pr-3 flex items-center">{accion}</div>
        )}
      </div>
      {abierto && children}
    </div>
  )
}
