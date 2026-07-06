/**
 * Normalización canónica del identificador de una persona.
 *
 * Regla: DNI para personas físicas, CUIT para jurídicas. Si viene un CUIL de
 * persona física, extraemos el DNI del medio para evitar duplicados
 * (el mismo humano guardado dos veces con dos números distintos).
 */

const PREFIJOS_FISICA = ['20', '23', '24', '25', '26', '27']
const PREFIJOS_JURIDICA = ['30', '33', '34']

/**
 * Devuelve el identificador canónico de la persona:
 * - FISICA  → DNI de 7-8 dígitos (extrae del CUIL si viene completo)
 * - JURIDICA → CUIT de 11 dígitos
 * Devuelve null si el input no es interpretable.
 */
export function normalizarIdentificadorPersona(
  raw: string | number | null | undefined,
  tipo: 'FISICA' | 'JURIDICA',
): string | null {
  if (raw === null || raw === undefined || raw === '') return null
  const digitos = String(raw).replace(/\D/g, '').replace(/^0+/, '')
  if (!digitos) return null

  if (tipo === 'FISICA') {
    if (digitos.length === 11 && PREFIJOS_FISICA.includes(digitos.slice(0, 2))) {
      return digitos.slice(2, 10).replace(/^0+/, '')
    }
    if (digitos.length >= 7 && digitos.length <= 8) return digitos
    return null
  }

  if (digitos.length === 11 && PREFIJOS_JURIDICA.includes(digitos.slice(0, 2))) {
    return digitos
  }
  return null
}

/**
 * Genera todas las variantes plausibles de un identificador para búsqueda
 * tolerante en DB. Cubre el caso legacy: personas cargadas antes del fix
 * pueden estar guardadas con el CUIL completo aunque sean físicas.
 *
 * Ejemplo — FISICA con DNI 12349712:
 *   → ['12349712', '27123497126', '20123497128', '23123497129', ...]
 */
export function variantesBusquedaIdentificador(
  raw: string | number | null | undefined,
  tipo: 'FISICA' | 'JURIDICA',
): string[] {
  if (raw === null || raw === undefined || raw === '') return []
  const digitosRaw = String(raw).replace(/\D/g, '').replace(/^0+/, '')
  if (!digitosRaw) return []

  const set = new Set<string>()
  const canonico = normalizarIdentificadorPersona(raw, tipo)
  if (canonico) set.add(canonico)
  set.add(digitosRaw)

  if (tipo === 'FISICA') {
    let dni: string | null = null
    if (digitosRaw.length === 11 && PREFIJOS_FISICA.includes(digitosRaw.slice(0, 2))) {
      dni = digitosRaw.slice(2, 10).replace(/^0+/, '')
    } else if (digitosRaw.length >= 7 && digitosRaw.length <= 8) {
      dni = digitosRaw
    }
    if (dni) {
      set.add(dni)
      // Todas las variantes de CUIL derivables del DNI (para matchear
      // registros históricos guardados con CUIL en lugar de DNI).
      const dniPad = dni.padStart(8, '0')
      for (const prefijo of PREFIJOS_FISICA) {
        const cuilBase = prefijo + dniPad
        const dv = calcularDigitoVerificadorCUIT(cuilBase)
        if (dv !== null) set.add(cuilBase + String(dv))
      }
    }
  }

  return Array.from(set).filter(v => v.length >= 7)
}

const MULTIPLICADORES = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]

function calcularDigitoVerificadorCUIT(base10: string): number | null {
  if (!/^\d{10}$/.test(base10)) return null
  let suma = 0
  for (let i = 0; i < 10; i++) suma += parseInt(base10[i], 10) * MULTIPLICADORES[i]
  let dv = 11 - (suma % 11)
  if (dv === 11) dv = 0
  if (dv === 10) return null
  return dv
}

/**
 * Infiere el tipo de persona a partir del identificador crudo.
 * Reglas:
 * - 11 dígitos con prefijo 30/33/34 → JURIDICA
 * - 11 dígitos con prefijo 20/23/24/25/26/27 → FISICA
 * - 7-8 dígitos → FISICA
 * - null si no se puede inferir
 */
export function inferirTipoPersonaDesdeIdentificador(
  raw: string | number | null | undefined,
): 'FISICA' | 'JURIDICA' | null {
  if (raw === null || raw === undefined || raw === '') return null
  const digitos = String(raw).replace(/\D/g, '')
  if (!digitos) return null
  if (digitos.length === 11) {
    const prefijo = digitos.slice(0, 2)
    if (PREFIJOS_JURIDICA.includes(prefijo)) return 'JURIDICA'
    if (PREFIJOS_FISICA.includes(prefijo)) return 'FISICA'
    return null
  }
  if (digitos.length >= 7 && digitos.length <= 8) return 'FISICA'
  return null
}
