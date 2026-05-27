'use client'

import { useState } from 'react'
import { CheckCircle2, AlertTriangle } from 'lucide-react'

interface Props {
  label: string
  valor: string | null | undefined
  onChange: (nuevoValor: string) => void
  tipo?: 'text' | 'email' | 'number' | 'date' | 'tel'
  dudoso?: boolean
  motivoDudoso?: string
  placeholder?: string
  monospace?: boolean
  readonly?: boolean
}

export default function CampoEditable({
  label,
  valor,
  onChange,
  tipo = 'text',
  dudoso = false,
  motivoDudoso,
  placeholder,
  monospace,
  readonly,
}: Props) {
  const [local, setLocal] = useState<string>(valor ?? '')
  const [tocado, setTocado] = useState(false)

  // Sincroniza con props
  if ((valor ?? '') !== local && !tocado) {
    setLocal(valor ?? '')
  }

  const colorBorde = dudoso ? 'border-amber-400' : 'border-slate-200'
  const colorIcono = dudoso ? 'text-amber-500' : 'text-emerald-500'
  const Icono = dudoso ? AlertTriangle : CheckCircle2

  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-2xs text-slate-500 uppercase tracking-wide font-semibold">
        {label}
      </label>
      <div className="relative">
        <input
          type={tipo}
          value={local}
          placeholder={placeholder}
          readOnly={readonly}
          onChange={e => {
            setLocal(e.target.value)
            setTocado(true)
            onChange(e.target.value)
          }}
          className={`form-input w-full pr-8 text-xs ${colorBorde} ${monospace ? 'font-mono' : ''} ${readonly ? 'bg-slate-50 cursor-default' : ''}`}
        />
        <Icono
          className={`absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 ${colorIcono}`}
          aria-hidden
        />
      </div>
      {dudoso && motivoDudoso && (
        <p className="text-2xs text-amber-700 leading-tight flex items-start gap-1">
          <AlertTriangle className="h-2.5 w-2.5 mt-0.5 shrink-0" /> {motivoDudoso}
        </p>
      )}
    </div>
  )
}
