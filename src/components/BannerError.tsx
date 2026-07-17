'use client'

/**
 * Banner de error unificado para todo el CRM (v1.0.140).
 *
 * Se usa arriba del contenido de una página o modal cuando falla una mutación.
 * Sticky, rojo prominente, con botón X para cerrar. Reemplaza los diversos
 * `<div className="bg-red-50 ...">` que estaban al final del form (donde no
 * se veían si el usuario no scrolleaba abajo).
 *
 * Uso:
 *   <BannerError mensaje={errorGral} onCerrar={() => setErrorGral('')} />
 */

import { AlertCircle, X } from 'lucide-react'

interface Props {
  mensaje: string | null | undefined
  /** Título visible arriba del mensaje. Default: "No se pudo completar la operación" */
  titulo?: string
  /** Handler para cerrar el banner. Si no viene, no muestra el botón X. */
  onCerrar?: () => void
  /** Si false, no aplica sticky. Útil dentro de modales. */
  sticky?: boolean
  /** className extra */
  className?: string
}

export function BannerError({
  mensaje,
  titulo = 'No se pudo completar la operación',
  onCerrar,
  sticky = true,
  className = '',
}: Props) {
  if (!mensaje) return null
  return (
    <div
      className={
        'bg-red-50 border-l-4 border-red-500 border border-red-200 rounded-lg p-4 ' +
        'shadow-md flex items-start justify-between gap-3 ' +
        (sticky ? 'sticky top-2 z-30 ' : '') +
        className
      }
    >
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-red-900 mb-0.5">{titulo}</p>
          <p className="text-sm text-red-800 leading-relaxed break-words">{mensaje}</p>
        </div>
      </div>
      {onCerrar && (
        <button
          type="button"
          onClick={onCerrar}
          className="text-red-500 hover:text-red-700 shrink-0"
          title="Cerrar"
          aria-label="Cerrar mensaje de error"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
