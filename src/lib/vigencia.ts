/**
 * Cálculo de vigencia de una póliza en meses, derivado de fecha_inicio + fecha_fin.
 * Reemplaza al catálogo VIGENCIA (eliminado en migración 095).
 *
 * La vigencia siempre se expresa en meses (ej: "12 meses", "6 meses", "1 mes").
 * El PAS interpreta el número directamente (12 = anual, 6 = semestral, etc.).
 */

const DIAS_POR_MES = 30.4375

export function calcularVigenciaMeses(
  fechaInicio: string | Date | null | undefined,
  fechaFin: string | Date | null | undefined
): number | null {
  if (!fechaInicio || !fechaFin) return null
  const inicio = fechaInicio instanceof Date ? fechaInicio : new Date(fechaInicio)
  const fin = fechaFin instanceof Date ? fechaFin : new Date(fechaFin)
  if (isNaN(inicio.getTime()) || isNaN(fin.getTime())) return null
  if (fin <= inicio) return null

  const diffMs = fin.getTime() - inicio.getTime()
  const diffDias = diffMs / (1000 * 60 * 60 * 24)
  const meses = Math.round(diffDias / DIAS_POR_MES)
  return meses > 0 ? meses : null
}

export function formatearVigencia(meses: number | null): string {
  if (meses == null) return '—'
  if (meses === 1) return '1 mes'
  return `${meses} meses`
}

export function vigenciaTextoDesdeFechas(
  fechaInicio: string | Date | null | undefined,
  fechaFin: string | Date | null | undefined
): string {
  return formatearVigencia(calcularVigenciaMeses(fechaInicio, fechaFin))
}

export function sumarMesesAFecha(fechaInicio: string | Date, meses: number): Date {
  const inicio = fechaInicio instanceof Date ? new Date(fechaInicio) : new Date(fechaInicio)
  const resultado = new Date(inicio)
  resultado.setMonth(resultado.getMonth() + meses)
  return resultado
}
