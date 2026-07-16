/**
 * Helper para parsear el campo `detalle` de una opción de cotización.
 * El PAS lo escribe como texto libre en un textarea, típicamente listando
 * sublímites uno por línea con el patrón `Concepto: monto`. Ej:
 *
 *   Incendio edificio: $500.000
 *   Incendio contenido: $200.000
 *   Robo contenido: $150.000
 *   RC frente a terceros: $1.000.000
 *   Franquicia: sin franquicia
 *
 * Cada línea que matchea `algo: algo` se toma como ítem estructurado; el
 * resto (líneas sin `:` o vacías) queda como nota libre. Esto permite que
 * la UI y el PDF renderen prolijo cuando el PAS carga sublímites, pero
 * sigue funcionando con texto plano viejo o comentarios sueltos.
 */

export type ItemDetalle = {
  label: string
  valor: string
}

export type DetalleParseado = {
  items: ItemDetalle[]
  notas: string[]
}

/**
 * Parsea el string `detalle` de una opción. Nunca tira — cualquier entrada
 * inesperada cae como notas.
 */
export function parsearDetalleOpcion(detalle: string | null | undefined): DetalleParseado {
  const vacio: DetalleParseado = { items: [], notas: [] }
  if (!detalle || typeof detalle !== 'string') return vacio
  const texto = detalle.trim()
  if (!texto) return vacio

  const items: ItemDetalle[] = []
  const notas: string[] = []

  // Split por líneas. Aceptamos \n y \r\n.
  const lineas = texto.split(/\r?\n/)
  for (const raw of lineas) {
    const linea = raw.trim()
    if (!linea) continue

    // Busca el PRIMER `:` que no esté en los primeros 0 caracteres (para
    // que un label tipo "URL: https://..." no rompa). Split en 2 partes.
    const idx = linea.indexOf(':')
    if (idx > 0 && idx < linea.length - 1) {
      const label = linea.slice(0, idx).trim()
      const valor = linea.slice(idx + 1).trim()
      if (label && valor) {
        items.push({ label, valor })
        continue
      }
    }
    // Línea sin `:` válido → nota libre.
    notas.push(linea)
  }

  return { items, notas }
}

/**
 * ¿La opción tiene contenido estructurado (ítems) o solo notas / vacío?
 * Útil para decidir si el PDF renderiza el bloque "Sumas aseguradas".
 */
export function tieneItems(parseado: DetalleParseado): boolean {
  return parseado.items.length > 0
}

/**
 * ¿La opción tiene cualquier contenido para mostrar?
 */
export function tieneContenido(parseado: DetalleParseado): boolean {
  return parseado.items.length > 0 || parseado.notas.length > 0
}

/**
 * Genera un resumen truncado del detalle para mostrar en la tabla comparativa
 * del PDF y de la ficha. Muestra los primeros N ítems seguidos de "..." si
 * hay más, o las primeras notas si no hay ítems.
 */
export function resumenCortoDetalle(
  detalle: string | null | undefined,
  maxItems: number = 2,
): string {
  const parseado = parsearDetalleOpcion(detalle)

  if (parseado.items.length > 0) {
    const primeros = parseado.items.slice(0, maxItems)
    const resumen = primeros.map(i => `${i.label}: ${i.valor}`).join(' · ')
    if (parseado.items.length > maxItems) {
      return `${resumen} · …`
    }
    return resumen
  }

  if (parseado.notas.length > 0) {
    const primeraNota = parseado.notas[0]
    if (parseado.notas.length > 1 || primeraNota.length > 80) {
      return primeraNota.slice(0, 80) + '…'
    }
    return primeraNota
  }

  return ''
}

/**
 * Placeholder para el textarea del form. Guía visual del formato esperado.
 */
export const PLACEHOLDER_DETALLE_OPCION = [
  'Incendio edificio: $500.000',
  'Incendio contenido: $200.000',
  'Robo contenido: $150.000',
  'RC frente a terceros: $1.000.000',
  '',
  'Notas: sin franquicia · vigencia anual',
].join('\n')
