'use client'

/**
 * Configurador del botón CTA para emails (v1.0.141).
 *
 * Toggle "Agregar botón de acción" + inputs de texto y URL. Se usa en:
 * - ModalEnviarEmail (envío manual desde ficha)
 * - ModalEnviarEmailMasivo (envío masivo simple desde listado)
 * - WizardNuevoEnvio (paso libre de campaña)
 *
 * El botón resultante en el mail se genera con `generarBotonHtml` en el
 * backend (color de marca automático) e inyectado al final del cuerpo.
 */

import { Link2 } from 'lucide-react'

interface Props {
  ctaTexto: string
  ctaUrl: string
  onCambio: (texto: string, url: string) => void
  className?: string
  /** Título del bloque. Default "Botón de acción (opcional)". */
  titulo?: string
}

export function ConfiguradorBotonCTA({ ctaTexto, ctaUrl, onCambio, className = '', titulo = 'Botón de acción (opcional)' }: Props) {
  const activo = !!(ctaTexto.trim() || ctaUrl.trim())

  return (
    <div className={`border border-slate-200 rounded-lg p-3 bg-slate-50 ${className}`}>
      <div className="flex items-center gap-1.5 mb-2">
        <Link2 className="h-3.5 w-3.5 text-slate-600" />
        <label className="text-xs font-medium text-slate-700">{titulo}</label>
        {activo && (
          <span className="text-2xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5 ml-auto">
            Activo
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <input
          type="text"
          className="form-input w-full text-sm"
          placeholder="Texto del botón (ej: Ver más)"
          value={ctaTexto}
          onChange={e => onCambio(e.target.value, ctaUrl)}
          maxLength={60}
        />
        <input
          type="url"
          className="form-input w-full text-sm"
          placeholder="URL destino (ej: https://…)"
          value={ctaUrl}
          onChange={e => onCambio(ctaTexto, e.target.value)}
        />
      </div>
      <p className="text-2xs text-slate-500 mt-1.5">
        Completá los 2 campos para que aparezca el botón. Se ubica al final del cuerpo con el color de tu productora.
      </p>
    </div>
  )
}
