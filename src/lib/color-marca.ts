/**
 * Sistema de color de marca personalizable.
 *
 * El PAS elige UN color (de una paleta curada) que se aplica a todas las
 * superficies cara al asegurado: PDFs de cotización, emails al cliente, portal
 * del asegurado y formulario público de denuncia. El CRM interno NO usa este
 * color — mantiene su paleta navy/grises.
 *
 * De ese color único derivamos automáticamente los tonos: claro (fondos),
 * oscuro (bordes), texto-sobre-color (blanco o negro según contraste WCAG AA),
 * hover, borde sutil.
 */

export type ColorMarca = {
  nombre: string
  hex: string
  familia: 'sobrio' | 'pastel'
}

export const COLOR_MARCA_DEFAULT = '#0A1628'

/**
 * Paleta curada — 16 colores divididos entre tonos sobrios (corporativos,
 * apropiados para una organización de seguros) y pasteles (modernos, suaves).
 *
 * Reglas para agregar colores nuevos:
 *  - Saturación moderada (no fluo)
 *  - Suficiente contraste con texto blanco para los sobrios
 *  - Suficiente contraste con texto oscuro para los pasteles
 *  - Apariencia profesional (no fiestero ni infantil)
 */
export const PALETA_COLORES_MARCA: ColorMarca[] = [
  // SOBRIOS — un representante por cada familia de la rueda cromática (rojo →
  // naranja → amarillo → verde → cyan → azul → violeta → magenta → rosa → neutros).
  // Tailwind levels 600-900 mayormente, para asegurar contraste con texto blanco.
  { nombre: 'Rojo bandera', hex: '#DC2626', familia: 'sobrio' },       // red-600
  { nombre: 'Rojo vino', hex: '#7F1D1D', familia: 'sobrio' },          // red-900
  { nombre: 'Naranja vibrante', hex: '#EA580C', familia: 'sobrio' },   // orange-600
  { nombre: 'Terracota', hex: '#9A3412', familia: 'sobrio' },          // orange-800
  { nombre: 'Mostaza oscuro', hex: '#A16207', familia: 'sobrio' },     // yellow-700
  { nombre: 'Marrón cuero', hex: '#78350F', familia: 'sobrio' },       // amber-900
  { nombre: 'Verde lima', hex: '#65A30D', familia: 'sobrio' },         // lime-600
  { nombre: 'Verde esmeralda', hex: '#047857', familia: 'sobrio' },    // emerald-700
  { nombre: 'Verde bosque', hex: '#14532D', familia: 'sobrio' },       // green-900
  { nombre: 'Turquesa', hex: '#0D9488', familia: 'sobrio' },           // teal-600
  { nombre: 'Azul petróleo', hex: '#155E75', familia: 'sobrio' },      // cyan-800
  { nombre: 'Azul cielo', hex: '#0284C7', familia: 'sobrio' },         // sky-600
  { nombre: 'Azul royal', hex: '#2563EB', familia: 'sobrio' },         // blue-600
  { nombre: 'Navy corporativo', hex: '#0A1628', familia: 'sobrio' },   // navy custom
  { nombre: 'Indigo profundo', hex: '#4338CA', familia: 'sobrio' },    // indigo-700
  { nombre: 'Violeta profundo', hex: '#6D28D9', familia: 'sobrio' },   // violet-700
  { nombre: 'Púrpura', hex: '#7E22CE', familia: 'sobrio' },            // purple-700
  { nombre: 'Magenta', hex: '#A21CAF', familia: 'sobrio' },            // fuchsia-700
  { nombre: 'Rosa fuerte', hex: '#BE185D', familia: 'sobrio' },        // pink-700
  { nombre: 'Borgoña', hex: '#881337', familia: 'sobrio' },            // rose-900
  { nombre: 'Slate', hex: '#334155', familia: 'sobrio' },              // slate-700
  { nombre: 'Grafito', hex: '#1F2937', familia: 'sobrio' },            // gray-800
  { nombre: 'Marrón chocolate', hex: '#57534E', familia: 'sobrio' },   // stone-600
  { nombre: 'Negro carbón', hex: '#171717', familia: 'sobrio' },       // neutral-900

  // PASTELES — siguen la misma rueda cromática, niveles Tailwind 200-300 para
  // garantizar contraste con texto oscuro (slate-900).
  { nombre: 'Coral pastel', hex: '#FCA5A5', familia: 'pastel' },       // red-300
  { nombre: 'Salmón pastel', hex: '#FDA4AF', familia: 'pastel' },      // rose-300
  { nombre: 'Durazno pastel', hex: '#FDBA74', familia: 'pastel' },     // orange-300
  { nombre: 'Naranja claro', hex: '#FED7AA', familia: 'pastel' },      // orange-200
  { nombre: 'Amarillo pastel', hex: '#FCD34D', familia: 'pastel' },    // yellow-300
  { nombre: 'Crema', hex: '#FDE68A', familia: 'pastel' },              // yellow-200
  { nombre: 'Verde lima pastel', hex: '#BEF264', familia: 'pastel' },  // lime-300
  { nombre: 'Menta pastel', hex: '#86EFAC', familia: 'pastel' },       // green-300
  { nombre: 'Esmeralda pastel', hex: '#6EE7B7', familia: 'pastel' },   // emerald-300
  { nombre: 'Turquesa pastel', hex: '#5EEAD4', familia: 'pastel' },    // teal-300
  { nombre: 'Aqua pastel', hex: '#67E8F9', familia: 'pastel' },        // cyan-300
  { nombre: 'Celeste pastel', hex: '#7DD3FC', familia: 'pastel' },     // sky-300
  { nombre: 'Azul pastel', hex: '#93C5FD', familia: 'pastel' },        // blue-300
  { nombre: 'Azul claro', hex: '#BFDBFE', familia: 'pastel' },         // blue-200
  { nombre: 'Indigo pastel', hex: '#A5B4FC', familia: 'pastel' },      // indigo-300
  { nombre: 'Lavanda pastel', hex: '#C4B5FD', familia: 'pastel' },     // violet-300
  { nombre: 'Lila pastel', hex: '#D8B4FE', familia: 'pastel' },        // purple-300
  { nombre: 'Magenta pastel', hex: '#F0ABFC', familia: 'pastel' },     // fuchsia-300
  { nombre: 'Rosa pastel', hex: '#F9A8D4', familia: 'pastel' },        // pink-300
  { nombre: 'Rosa claro', hex: '#FBCFE8', familia: 'pastel' },         // pink-200
  { nombre: 'Verde claro', hex: '#BBF7D0', familia: 'pastel' },        // green-200
  { nombre: 'Lavanda claro', hex: '#DDD6FE', familia: 'pastel' },      // violet-200
  { nombre: 'Beige cálido', hex: '#D6D3D1', familia: 'pastel' },       // stone-300
  { nombre: 'Gris pastel', hex: '#CBD5E1', familia: 'pastel' },        // slate-300
]

export type TonosDerivados = {
  base: string             // El color elegido tal cual ('#RRGGBB')
  claro: string            // Versión clara (~85% mezcla con blanco) — fondos suaves
  muyClaro: string         // Versión muy clara (~93% mezcla) — fondos sutiles
  oscuro: string           // Versión oscura (~18% mezcla con negro) — bordes, hover
  vibrante: string         // Versión más luminosa (~35% mezcla con blanco) — gradient/destacados
  textoSobreColor: string  // '#FFFFFF' o '#0F172A' según contraste WCAG AA
  borde: string            // Versión semitransparente / mezcla 30% — bordes sutiles
}

export type ColorMarcaRgb = { r: number; g: number; b: number }

/**
 * Convierte '#RRGGBB' a { r, g, b } con valores 0–255.
 */
export function hexARgb(hex: string): ColorMarcaRgb {
  const limpio = hex.replace('#', '')
  return {
    r: parseInt(limpio.slice(0, 2), 16),
    g: parseInt(limpio.slice(2, 4), 16),
    b: parseInt(limpio.slice(4, 6), 16),
  }
}

/**
 * Convierte { r, g, b } a '#RRGGBB'.
 */
export function rgbAHex({ r, g, b }: ColorMarcaRgb): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/**
 * Mezcla un color con blanco o negro en una proporción dada.
 * factor 0 = color original, factor 1 = blanco/negro puro.
 */
function mezclar(rgb: ColorMarcaRgb, hacia: 'blanco' | 'negro', factor: number): ColorMarcaRgb {
  const objetivo = hacia === 'blanco' ? 255 : 0
  return {
    r: rgb.r + (objetivo - rgb.r) * factor,
    g: rgb.g + (objetivo - rgb.g) * factor,
    b: rgb.b + (objetivo - rgb.b) * factor,
  }
}

/**
 * Luminancia relativa según WCAG. Usada para decidir si el texto sobre este
 * color debe ser blanco o negro.
 */
function luminanciaRelativa(rgb: ColorMarcaRgb): number {
  const componente = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * componente(rgb.r) + 0.7152 * componente(rgb.g) + 0.0722 * componente(rgb.b)
}

/**
 * Devuelve '#FFFFFF' o '#0F172A' (slate-900) según el que tenga mejor contraste
 * con el color de fondo. Garantiza al menos WCAG AA para texto normal.
 */
export function textoSobreColor(hex: string): string {
  const lum = luminanciaRelativa(hexARgb(hex))
  // Threshold 0.55: arriba va texto oscuro, abajo va texto blanco
  return lum > 0.55 ? '#0F172A' : '#FFFFFF'
}

/**
 * Deriva todos los tonos a partir del color base.
 */
export function derivarTonos(hex: string): TonosDerivados {
  const rgb = hexARgb(hex)
  return {
    base: hex,
    claro: rgbAHex(mezclar(rgb, 'blanco', 0.85)),
    muyClaro: rgbAHex(mezclar(rgb, 'blanco', 0.93)),
    oscuro: rgbAHex(mezclar(rgb, 'negro', 0.18)),
    vibrante: rgbAHex(mezclar(rgb, 'blanco', 0.32)),
    textoSobreColor: textoSobreColor(hex),
    borde: rgbAHex(mezclar(rgb, 'blanco', 0.65)),
  }
}

/**
 * Construye un `linear-gradient` 135° desde el color de marca: oscuro → base
 * → vibrante. Pensado para los heroes / fondos donde antes se usaba navy
 * hardcoded. Si no hay color, cae al gradient navy de siempre.
 */
export function gradientDeColorMarca(hex: string | null | undefined): string {
  const colorBase = hex && esColorMarcaValido(hex) ? hex : COLOR_MARCA_DEFAULT
  const tonos = derivarTonos(colorBase)
  return `linear-gradient(135deg, ${tonos.oscuro} 0%, ${tonos.base} 55%, ${tonos.vibrante} 100%)`
}

/**
 * Validador. Devuelve true si el hex es '#RRGGBB' con caracteres hex válidos.
 */
export function esColorMarcaValido(hex: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(hex)
}

/**
 * Normaliza un hex a mayúsculas. Si no es válido, devuelve el default.
 */
export function normalizarColorMarca(hex: string | null | undefined): string {
  if (!hex || !esColorMarcaValido(hex)) return COLOR_MARCA_DEFAULT
  return hex.toUpperCase()
}
