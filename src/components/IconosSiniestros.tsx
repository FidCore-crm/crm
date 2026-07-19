/**
 * Íconos SVG específicos de tipos de siniestro que no tienen emoji apropiado.
 *
 * Los emojis fallan cuando el concepto es específico de automotor:
 *   - 🛞 se ve como rueda de carreta con radios en muchas plataformas.
 *   - 🪟 es ventana de casa, no cristal de auto.
 *
 * Estos SVG son inline (no dependen del set de emojis del OS) y quedan
 * consistentes entre desktop / iOS / Android. Diseñados a 24×24px para
 * matchear el tamaño típico de emoji del catálogo.
 */

import * as React from 'react'

type IconProps = React.SVGProps<SVGSVGElement>

/**
 * Rueda de auto — llanta con neumático. Grises + acento oscuro en el centro.
 */
export function IconoRuedaAuto(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
         width={24} height={24} aria-hidden {...props}>
      {/* Neumático (goma exterior negra) */}
      <circle cx="12" cy="12" r="10" fill="#1f2937" stroke="#0f172a" strokeWidth="0.5" />
      {/* Llanta (metal interior gris claro) */}
      <circle cx="12" cy="12" r="6.5" fill="#94a3b8" stroke="#64748b" strokeWidth="0.5" />
      {/* Rayos de la llanta */}
      <g stroke="#475569" strokeWidth="1.2" strokeLinecap="round">
        <line x1="12" y1="6" x2="12" y2="10" />
        <line x1="12" y1="14" x2="12" y2="18" />
        <line x1="6" y1="12" x2="10" y2="12" />
        <line x1="14" y1="12" x2="18" y2="12" />
        <line x1="7.8" y1="7.8" x2="10.2" y2="10.2" />
        <line x1="13.8" y1="13.8" x2="16.2" y2="16.2" />
        <line x1="16.2" y1="7.8" x2="13.8" y2="10.2" />
        <line x1="10.2" y1="13.8" x2="7.8" y2="16.2" />
      </g>
      {/* Tuerca central */}
      <circle cx="12" cy="12" r="1.5" fill="#334155" />
    </svg>
  )
}

/**
 * Overrides de íconos para tipos de siniestro específicos. El renderer del
 * form público usa este mapa cuando quiere pintar el ícono; si no matchea,
 * cae al `icono` string del catálogo (emoji).
 *
 * Solo agregar entradas acá cuando el emoji unicode no represente bien el
 * concepto — el resto de los tipos deben quedar como emoji para consistencia.
 */
export const ICONOS_SVG_TIPO_SINIESTRO: Record<string, React.ReactNode> = {
  ROBO_RUEDAS: <IconoRuedaAuto />,
  ROTURA_CRISTALES: <IconoParabrisasRoto />,
}

/**
 * Parabrisas roto — vidrio trapezoidal con fractura estrellada.
 */
export function IconoParabrisasRoto(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
         width={24} height={24} aria-hidden {...props}>
      {/* Contorno del parabrisas (trapezoidal, vista frontal) */}
      <path d="M4 6 L20 6 L18 19 L6 19 Z" fill="#bfdbfe" stroke="#1e40af" strokeWidth="1.2" strokeLinejoin="round" />
      {/* Líneas de fractura (estrella + ramas) */}
      <g stroke="#0f172a" strokeWidth="1" strokeLinecap="round">
        {/* Punto de impacto central */}
        <path d="M12 12 L8 8" />
        <path d="M12 12 L16 8.5" />
        <path d="M12 12 L7 15" />
        <path d="M12 12 L17 16" />
        <path d="M12 12 L12 17" />
        {/* Micro-ramas secundarias */}
        <path d="M10 10 L9.5 11.5" />
        <path d="M14 10 L14.5 11.5" />
        <path d="M10 14 L9.5 15" />
        <path d="M14 14 L15 15" />
      </g>
      {/* Círculo del punto de impacto */}
      <circle cx="12" cy="12" r="1.2" fill="#0f172a" />
    </svg>
  )
}
