'use client'

/**
 * Tooltip inline de ayuda contextual.
 *
 * Renderiza un ícono `?` discreto al lado del elemento al que ayuda. Click
 * abre un popover con título + texto corto + opcional link al artículo
 * completo del Centro de Ayuda.
 *
 * Respeta la preferencia del usuario `mostrar_ayuda_contextual`:
 *   - true (default) → se ve el ícono.
 *   - false → no se renderiza nada.
 *
 * Uso:
 *   <AyudaTooltip clave="polizas.estado" />
 *   <AyudaTooltip clave="polizas.cancelar_vs_anular" inline />
 *
 * `inline` reduce el tamaño del ícono para que entre al lado de texto de
 * cuerpo (por defecto está pensado para etiquetas de formularios).
 */

import { useState, useRef, useEffect } from 'react'
import { HelpCircle, X, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { obtenerTextoAyuda, type ClaveAyuda } from '@/lib/ayuda/textos'

interface Props {
  clave: ClaveAyuda
  /** Reduce el ícono a 12px y baja el padding para que entre al lado de texto. */
  inline?: boolean
  /** Alinea el popover (default: 'left'). */
  align?: 'left' | 'right'
}

export default function AyudaTooltip({ clave, inline = false, align = 'left' }: Props) {
  const { usuario } = useAuth()
  const [abierto, setAbierto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Cerrar al click outside
  useEffect(() => {
    if (!abierto) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setAbierto(false)
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setAbierto(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [abierto])

  // Respeta la preferencia del usuario
  if (usuario && usuario.mostrar_ayuda_contextual === false) return null

  const dato = obtenerTextoAyuda(clave)
  if (!dato) return null

  const tamano = inline ? 'h-3 w-3' : 'h-3.5 w-3.5'

  return (
    <div ref={ref} className="inline-flex relative align-middle">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setAbierto((v) => !v) }}
        className="inline-flex items-center justify-center text-slate-500 hover:text-blue-600 transition-colors"
        aria-label={`Ayuda: ${dato.titulo}`}
        title={dato.titulo}
      >
        <HelpCircle className={tamano} />
      </button>

      {abierto && (
        <div
          className={`absolute z-50 top-full mt-1.5 ${align === 'right' ? 'right-0' : 'left-0'} w-72 bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-left animate-fade-in`}
          role="tooltip"
        >
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <h4 className="text-xs font-semibold text-slate-800 leading-tight">{dato.titulo}</h4>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setAbierto(false) }}
              className="text-slate-500 hover:text-slate-600 -mr-1 -mt-1"
              aria-label="Cerrar"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <p className="text-2xs text-slate-600 leading-relaxed">{dato.texto}</p>
          {dato.articulo && (
            <Link
              href={`/crm/ayuda/${dato.articulo}`}
              className="mt-2 inline-flex items-center gap-1 text-2xs font-medium text-blue-600 hover:text-blue-800"
              onClick={() => setAbierto(false)}
            >
              Leer más en Centro de Ayuda
              <ExternalLink className="h-2.5 w-2.5" />
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
