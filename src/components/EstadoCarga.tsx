'use client'

import { ReactNode } from 'react'
import { Loader2, AlertCircle, Inbox, RefreshCw } from 'lucide-react'

interface Props {
  loading?: boolean
  error?: { codigo?: string; mensaje: string } | null
  empty?: boolean
  emptyMensaje?: string
  emptyIcono?: ReactNode
  onReintentar?: () => void
  children: ReactNode
}

export function EstadoCarga({
  loading,
  error,
  empty,
  emptyMensaje = 'No hay datos para mostrar',
  emptyIcono,
  onReintentar,
  children,
}: Props) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-600">
        <Loader2 className="w-8 h-8 animate-spin mb-3" />
        <p className="text-sm">Cargando...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mb-3" />
        <h3 className="text-lg font-semibold text-slate-900 mb-1">
          No se pudieron cargar los datos
        </h3>
        <p className="text-sm text-slate-600 mb-4 max-w-md">{error.mensaje}</p>
        {error.codigo && (
          <p className="text-xs text-slate-500 font-mono mb-4">{error.codigo}</p>
        )}
        {onReintentar && (
          <button
            onClick={onReintentar}
            className="btn-secondary flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Reintentar
          </button>
        )}
      </div>
    )
  }

  if (empty) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center text-slate-600">
        {emptyIcono || <Inbox className="w-12 h-12 mb-3 text-slate-500" />}
        <p className="text-sm">{emptyMensaje}</p>
      </div>
    )
  }

  return <>{children}</>
}
