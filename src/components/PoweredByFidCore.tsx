/**
 * Mini-logo "FidCore" para el footer de las superficies del cliente final
 * (portal del asegurado, form de denuncia). Solo aparece en modo VPS
 * (SaaS-managed) — el cliente PAS on-premise pagó por el software, no es
 * razonable poner tu marca en sus superficies visibles al asegurado.
 *
 * Estilo (opción D confirmada): isotipo SVG chiquito en gris, sin texto.
 * Discreto, casi imperceptible. Es marca pasiva, no autopublicidad.
 */

import { esModoVps } from '@/lib/modo-instalacion'

interface Props {
  /** Alineación del bloque (izq/der/centro). Default: right. */
  align?: 'left' | 'right' | 'center'
  className?: string
  /** Tamaño del isotipo en px. Default 14. */
  size?: number
}

export function PoweredByFidCore({ align = 'right', className = '', size = 14 }: Props) {
  if (!esModoVps()) return null

  const alignCls =
    align === 'left' ? 'justify-start' : align === 'center' ? 'justify-center' : 'justify-end'

  return (
    <div className={`flex items-center ${alignCls} ${className}`} title="FidCore">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/branding/fidcore-isotipo.svg"
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        style={{
          filter: 'grayscale(1) opacity(0.35)',
          display: 'block',
        }}
      />
    </div>
  )
}
