'use client'

import { Check, Loader2 } from 'lucide-react'
import type { EstadoRestauracion } from '@/types/database'

interface Paso {
  key: EstadoRestauracion
  label: string
}

const PASOS: Paso[] = [
  { key: 'VALIDANDO', label: 'Backup validado' },
  { key: 'PRE_BACKUP', label: 'Pre-backup de seguridad creado' },
  { key: 'EXTRAYENDO', label: 'Extrayendo contenido' },
  { key: 'RESTAURANDO_DB', label: 'Restaurando base de datos' },
  { key: 'RESTAURANDO_STORAGE', label: 'Restaurando storage' },
  { key: 'FINALIZANDO', label: 'Finalizando' },
  { key: 'COMPLETADA', label: 'Completada' },
]

const ORDEN: Record<EstadoRestauracion, number> = {
  PENDIENTE: 0,
  VALIDANDO: 1,
  PRE_BACKUP: 2,
  EXTRAYENDO: 3,
  RESTAURANDO_DB: 4,
  RESTAURANDO_STORAGE: 5,
  FINALIZANDO: 6,
  COMPLETADA: 7,
  FALLIDA: -1,
  CANCELADA: -1,
}

interface Props {
  estadoActual: EstadoRestauracion
  porcentaje: number
  incluirPreBackup?: boolean
}

export default function StepperRestauracion({ estadoActual, porcentaje, incluirPreBackup = true }: Props) {
  const actualOrden = ORDEN[estadoActual] ?? 0
  const pasosFiltrados = incluirPreBackup ? PASOS : PASOS.filter((p) => p.key !== 'PRE_BACKUP')

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-2">
        {pasosFiltrados.map((p) => {
          const orden = ORDEN[p.key]
          const completado = actualOrden > orden || estadoActual === 'COMPLETADA'
          const activo = actualOrden === orden
          return (
            <li key={p.key} className="flex items-center gap-3">
              <div
                className={`h-6 w-6 rounded-full flex items-center justify-center shrink-0 ${
                  completado
                    ? 'bg-green-500 text-white'
                    : activo
                      ? 'bg-blue-500 text-white animate-pulse'
                      : 'bg-slate-200 text-slate-500'
                }`}
              >
                {completado ? (
                  <Check className="h-3.5 w-3.5" />
                ) : activo ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <span className="text-2xs font-semibold">{orden}</span>
                )}
              </div>
              <span
                className={`text-xs ${
                  completado
                    ? 'text-slate-700 line-through decoration-slate-300'
                    : activo
                      ? 'text-slate-900 font-medium'
                      : 'text-slate-500'
                }`}
              >
                {p.label}
              </span>
            </li>
          )
        })}
      </ol>

      <div className="mt-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-2xs text-slate-600">Progreso</span>
          <span className="text-2xs font-mono text-slate-600">{porcentaje}%</span>
        </div>
        <div className="h-2 bg-slate-200 rounded overflow-hidden">
          <div
            className={`h-full transition-all ${
              estadoActual === 'FALLIDA' ? 'bg-red-500' : estadoActual === 'COMPLETADA' ? 'bg-green-500' : 'bg-blue-500'
            }`}
            style={{ width: `${porcentaje}%` }}
          />
        </div>
      </div>
    </div>
  )
}
