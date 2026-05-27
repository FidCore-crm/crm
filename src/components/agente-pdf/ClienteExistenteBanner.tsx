'use client'

import { CheckCircle2 } from 'lucide-react'

export type AccionCliente = 'USAR' | 'ACTUALIZAR'

interface Props {
  cliente_existente: {
    id: string
    nombre_completo: string
    estado: string
    cant_polizas: number
  }
  accion: AccionCliente
  onCambiarAccion: (nueva: AccionCliente) => void
}

export default function ClienteExistenteBanner({
  cliente_existente,
  accion,
  onCambiarAccion,
}: Props) {
  return (
    <div className="border border-emerald-200 bg-emerald-50 rounded p-3 flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-emerald-800">
            Cliente existente detectado
          </p>
          <p className="text-2xs text-emerald-700 mt-0.5">
            Este DNI corresponde a{' '}
            <span className="font-medium">{cliente_existente.nombre_completo}</span>
            {' '}({cliente_existente.estado.toLowerCase()}
            {cliente_existente.cant_polizas > 0 &&
              ` — ${cliente_existente.cant_polizas} póliza${cliente_existente.cant_polizas !== 1 ? 's' : ''}`}
            ).
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1 pl-6">
        <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
          <input
            type="radio"
            name="accion_cliente"
            checked={accion === 'USAR'}
            onChange={() => onCambiarAccion('USAR')}
          />
          Usar el cliente existente <span className="text-2xs text-emerald-700">(recomendado)</span>
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
          <input
            type="radio"
            name="accion_cliente"
            checked={accion === 'ACTUALIZAR'}
            onChange={() => onCambiarAccion('ACTUALIZAR')}
          />
          Actualizar datos del cliente con los del PDF
        </label>
      </div>
    </div>
  )
}
