/**
 * Medio de pago al que el asegurado adhirió para esta póliza.
 *
 * Enum hardcoded (no catálogo configurable): los tres medios universales que
 * usan todas las compañías. Si en el futuro aparece un cuarto medio relevante,
 * agregarlo acá + actualizar el CHECK constraint en `polizas.medio_pago`.
 *
 * Patrón espejo a `refacturaciones.ts` (post-migración 095).
 */

export const MEDIOS_PAGO = ['EFECTIVO', 'DEBITO_CUENTA', 'TARJETA_CREDITO'] as const

export type MedioPago = typeof MEDIOS_PAGO[number]

const LABELS: Record<MedioPago, string> = {
  EFECTIVO: 'Efectivo',
  DEBITO_CUENTA: 'Débito en cuenta',
  TARJETA_CREDITO: 'Tarjeta de crédito',
}

export function opcionesMedioPago(): Array<{ valor: MedioPago; label: string }> {
  return MEDIOS_PAGO.map((v) => ({ valor: v, label: LABELS[v] }))
}

export function formatearMedioPago(valor: string | null | undefined): string {
  if (!valor) return ''
  return LABELS[valor as MedioPago] ?? valor
}

/**
 * Normaliza un texto libre (mayúsculas/minúsculas, sinónimos típicos del PAS
 * o de archivos de compañía) a uno de los 3 enums válidos. Útil en el
 * importador y en el agente IA. Devuelve null si no se reconoce.
 */
export function normalizarMedioPago(texto: string | null | undefined): MedioPago | null {
  if (!texto) return null
  const t = String(texto).trim().toUpperCase().replace(/[-_\s.]+/g, '')

  if (!t) return null

  // Tarjeta de crédito
  if (/^TARJ/.test(t) || t.includes('CREDIT') || t === 'TC' || t === 'TARJETA') return 'TARJETA_CREDITO'

  // Débito en cuenta / CBU
  if (t.startsWith('DEB') || t.includes('CBU') || t.includes('CUENTA') || t.includes('BANCAR')) return 'DEBITO_CUENTA'

  // Efectivo
  if (t.startsWith('EFEC') || t === 'CASH' || t.includes('CONTADO') || t.includes('CUPON')) return 'EFECTIVO'

  return null
}
