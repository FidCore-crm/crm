/**
 * Refacturación de una póliza (forma de pago).
 * Reemplaza al catálogo REFACTURACION (eliminado en migración 095).
 *
 * Las 7 opciones son universales de la industria. No son editables por el PAS.
 */

export const REFACTURACIONES = [
  'MENSUAL',
  'BIMESTRAL',
  'TRIMESTRAL',
  'CUATRIMESTRAL',
  'SEMESTRAL',
  'ANUAL',
  'PAGO_UNICO',
] as const

export type Refacturacion = typeof REFACTURACIONES[number]

const LABELS: Record<Refacturacion, string> = {
  MENSUAL: 'Mensual',
  BIMESTRAL: 'Bimestral',
  TRIMESTRAL: 'Trimestral',
  CUATRIMESTRAL: 'Cuatrimestral',
  SEMESTRAL: 'Semestral',
  ANUAL: 'Anual',
  PAGO_UNICO: 'Pago único',
}

export function formatearRefacturacion(valor: string | null | undefined): string {
  if (!valor) return '—'
  const upper = valor.toUpperCase().replace(/[\s-]/g, '_')
  if (esRefacturacionValida(upper)) return LABELS[upper as Refacturacion]
  return valor
}

export function esRefacturacionValida(valor: string): valor is Refacturacion {
  return (REFACTURACIONES as readonly string[]).includes(valor)
}

export function opcionesRefacturacion(): Array<{ value: Refacturacion; label: string }> {
  return REFACTURACIONES.map(v => ({ value: v, label: LABELS[v] }))
}

/**
 * Normaliza un string libre (que puede venir de un PDF, importación o catálogo viejo)
 * a uno de los 7 valores válidos. Si no matchea, devuelve null.
 */
export function normalizarRefacturacion(texto: string | null | undefined): Refacturacion | null {
  if (!texto) return null
  const t = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()

  if (/mensual|mes\b/.test(t)) return 'MENSUAL'
  if (/bimestral|bimensual|2\s*meses/.test(t)) return 'BIMESTRAL'
  if (/trimestral|3\s*meses/.test(t)) return 'TRIMESTRAL'
  if (/cuatrimestral|4\s*meses/.test(t)) return 'CUATRIMESTRAL'
  if (/semestral|6\s*meses/.test(t)) return 'SEMESTRAL'
  if (/anual|12\s*meses|año/.test(t)) return 'ANUAL'
  if (/pago\s*unico|unico|contado/.test(t)) return 'PAGO_UNICO'
  return null
}
