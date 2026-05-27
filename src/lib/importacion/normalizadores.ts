/**
 * Normalizadores de datos importados.
 *
 * Objetivo: garantizar que los datos que entran al CRM tengan formato
 * consistente sin importar cómo los mande cada compañía. Algunas envían
 * todo en mayúsculas (FEDERACIÓN), otras todo en minúsculas, otras mixto.
 * Esto desordena la visual y rompe deduplicación (`JUAN PEREZ` ≠ `Juan Perez`).
 *
 * Se aplica en el paso de procesamiento de lotes, después del mapeo y el
 * parseo IA, antes de la validación y la detección de duplicados. Así:
 *   1. Los duplicados matchean correctamente con lo que ya hay en CRM.
 *   2. `importacion_registros_dudosos` muestra datos prolijos al revisar.
 *   3. Los INSERT finales persisten ya normalizados.
 */

import type {
  EntidadesRegistro,
  PersonaImportada,
  PolizaImportada,
  RiesgoImportado,
} from '@/lib/importacion/types'

// ---------------------------------------------------------------------------
// Constantes de dominio
// ---------------------------------------------------------------------------

/**
 * Palabras que en medio de un nombre propio van en MINÚSCULA (artículos,
 * conjunciones, preposiciones). Si son la PRIMERA palabra del string,
 * se capitalizan (ej: "DE LA CRUZ S.R.L." → "De la Cruz SRL").
 */
const PARTICULAS_MINUSCULA = new Set([
  'de', 'del', 'la', 'las', 'los', 'el',
  'y', 'e', 'o', 'u',
  'en', 'a', 'al', 'por', 'para', 'con', 'sin',
  'da', 'do', 'das', 'dos', // apellidos portugueses/brasileños comunes
  'van', 'von', 'der', 'le', 'di',
])

/**
 * Tokens que se preservan en MAYÚSCULA tal cual (siglas, abreviaturas,
 * acrónimos, numerales romanos). Se comparan ignorando case y puntos.
 */
const SIGLAS_MAYUSCULA = new Set([
  // Sociedades comerciales argentinas
  'SA', 'SRL', 'SAS', 'SACI', 'SACIF', 'SAICF', 'SCA', 'SCS', 'SH',
  'SA.', 'S.A', 'S.A.', 'S.R.L.', 'S.A.S.', 'S.H.',
  // Organismos y entidades
  'YPF', 'AFIP', 'ANSES', 'ARBA', 'AGIP', 'ARCA',
  'CABA', 'AMBA', 'PAMI', 'IOMA', 'OSDE',
  'INTA', 'INTI', 'ANMAT', 'UBA', 'UTN',
  'SSN', 'BCRA', 'CNV', 'ONU', 'OMS',
  // Abreviaturas de dirección
  'CP', 'CP.',
  // Numerales romanos (hasta XX cubre 99% de los casos reales: Juan Pablo II, etc.)
  'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII',
  'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX',
])

/**
 * Abreviaturas que van con primera letra en mayúscula + punto final.
 * Se matchean ignorando puntos y case.
 */
const ABREVIATURAS_CAPITALIZADAS: Record<string, string> = {
  'av': 'Av.',
  'avda': 'Avda.',
  'bv': 'Bv.',
  'pje': 'Pje.',
  'dpto': 'Dpto.',
  'depto': 'Depto.',
  'sr': 'Sr.',
  'sra': 'Sra.',
  'dr': 'Dr.',
  'dra': 'Dra.',
  'ing': 'Ing.',
  'lic': 'Lic.',
  'arq': 'Arq.',
  'gral': 'Gral.',
  'cnel': 'Cnel.',
  'tte': 'Tte.',
  'cap': 'Cap.',
}

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

function capitalizarPalabra(palabra: string): string {
  if (!palabra) return palabra
  // Preserva separadores internos: apóstrofes (O'Connor), guiones (Perez-Lopez)
  // y puntos. split con grupo de captura deja separadores en índices impares.
  return palabra
    .split(/(['\-.])/)
    .map((parte, i) => {
      if (i % 2 === 1) return parte // separador, se deja tal cual
      if (!parte) return parte
      return parte.charAt(0).toUpperCase() + parte.slice(1).toLowerCase()
    })
    .join('')
}

/**
 * True cuando el token es una sigla/abreviatura/romano conocido y debe
 * preservarse en MAYÚSCULA. La comparación ignora puntos y case.
 */
function esSigla(token: string): boolean {
  const limpio = token.replace(/\./g, '').toUpperCase()
  if (SIGLAS_MAYUSCULA.has(limpio)) return true
  // Token como "S.A." → "SA" → sigue matcheando
  // Token como "S.A.C.I.F." → "SACIF"
  return false
}

/**
 * Título de una cadena respetando:
 *  - Partículas en minúscula salvo que sean la primera palabra.
 *  - Siglas en mayúscula (SA, SRL, YPF, II, III...).
 *  - Abreviaturas con puntos (Av., Sr., Ing.).
 *  - Separadores internos (apóstrofes, guiones) con cada lado capitalizado.
 *
 * Idempotente: `toTitleCase(toTitleCase(x))` === `toTitleCase(x)`.
 * Tolerante a null/undefined/vacío (devuelve el valor original).
 */
export function toTitleCase(valor: string | null | undefined): string | null | undefined {
  if (valor === null || valor === undefined) return valor
  const s = valor.toString().trim()
  if (!s) return s

  // Colapsar espacios múltiples a uno
  const normalizado = s.replace(/\s+/g, ' ')
  const tokens = normalizado.split(' ')

  return tokens
    .map((token, i) => {
      // 1. Siglas argentinas/acrónimos/romanos → UPPER
      if (esSigla(token)) {
        return token.replace(/\./g, '').toUpperCase() + (token.endsWith('.') ? '.' : '')
      }

      const sinPuntoFinal = token.endsWith('.') ? token.slice(0, -1) : token
      const lower = sinPuntoFinal.toLowerCase()

      // 2. Abreviaturas conocidas (Av., Sr., Dr., Ing., etc.)
      if (ABREVIATURAS_CAPITALIZADAS[lower]) {
        return ABREVIATURAS_CAPITALIZADAS[lower]
      }

      // 3. Partículas en minúscula salvo primera palabra
      if (i > 0 && PARTICULAS_MINUSCULA.has(lower)) {
        return lower
      }

      // 4. Default: capitalizar primera letra (con soporte de separadores)
      return capitalizarPalabra(token.toLowerCase())
    })
    .join(' ')
}

/**
 * Email → todo minúscula + trim. El local-part técnicamente es case-sensitive
 * por RFC, pero en la práctica todos los proveedores lo tratan case-insensitive,
 * y el PAS espera ver mails prolijos.
 */
export function normalizarEmail(
  valor: string | null | undefined
): string | null | undefined {
  if (valor === null || valor === undefined) return valor
  const s = valor.toString().trim().toLowerCase()
  return s || null
}

/**
 * Patente → MAYÚSCULA + sin espacios/guiones. Convención argentina:
 * "ab 123 cd" → "AB123CD", "abc-123" → "ABC123".
 */
export function normalizarPatente(
  valor: string | null | undefined
): string | null | undefined {
  if (valor === null || valor === undefined) return valor
  const s = valor.toString().trim().replace(/[\s\-]/g, '').toUpperCase()
  return s || null
}

/**
 * Código postal → trim + upper (para códigos argentinos nuevos tipo "B1878BUJ").
 * Si es numérico clásico (4 dígitos) queda igual.
 */
export function normalizarCodigoPostal(
  valor: string | null | undefined
): string | null | undefined {
  if (valor === null || valor === undefined) return valor
  const s = valor.toString().trim().toUpperCase()
  return s || null
}

// ---------------------------------------------------------------------------
// Normalización por entidad
// ---------------------------------------------------------------------------

// Campos de PERSONA que se normalizan en Title Case.
const CAMPOS_PERSONA_TITLECASE: Array<keyof PersonaImportada> = [
  'apellido', 'nombre', 'razon_social',
  'calle', 'barrio', 'localidad', 'provincia', 'pais',
]

// Campos de PERSONA que se pasan a minúscula.
const CAMPOS_PERSONA_LOWERCASE: Array<keyof PersonaImportada> = [
  'email', 'email_secundario',
]

// Campos de RIESGO en Title Case (automotor + hogar).
const CAMPOS_RIESGO_TITLECASE: Array<keyof RiesgoImportado> = [
  'marca', 'modelo', 'color', 'uso',
  'direccion_riesgo', 'tipo_construccion',
]

export function normalizarPersonaImportada(
  persona: PersonaImportada | null
): PersonaImportada | null {
  if (!persona) return persona
  const out: PersonaImportada = { ...persona }

  for (const campo of CAMPOS_PERSONA_TITLECASE) {
    const v = out[campo]
    if (typeof v === 'string') {
      out[campo] = toTitleCase(v) as any
    }
  }

  for (const campo of CAMPOS_PERSONA_LOWERCASE) {
    const v = out[campo]
    if (typeof v === 'string') {
      out[campo] = normalizarEmail(v) as any
    }
  }

  if (typeof out.codigo_postal === 'string') {
    out.codigo_postal = normalizarCodigoPostal(out.codigo_postal) as any
  }

  return out
}

export function normalizarRiesgoImportado(
  riesgo: RiesgoImportado | null
): RiesgoImportado | null {
  if (!riesgo) return riesgo
  const out: RiesgoImportado = { ...riesgo }

  for (const campo of CAMPOS_RIESGO_TITLECASE) {
    const v = out[campo]
    if (typeof v === 'string') {
      out[campo] = toTitleCase(v) as any
    }
  }

  if (typeof out.patente === 'string') {
    out.patente = normalizarPatente(out.patente) as any
  }

  // Motor y chasis: siempre UPPERCASE + trim (convención del CRM).
  if (typeof (out as any).motor === 'string') {
    const m = ((out as any).motor as string).trim().toUpperCase()
    ;(out as any).motor = m || null
  }
  if (typeof (out as any).chasis === 'string') {
    const c = ((out as any).chasis as string).trim().toUpperCase()
    ;(out as any).chasis = c || null
  }

  // Descripción corta: puede ser desde "FORD FIESTA 2018" hasta "Casa habitación".
  // Title case sirve para ambos.
  if (typeof out.descripcion_corta === 'string') {
    out.descripcion_corta = toTitleCase(out.descripcion_corta) as any
  }

  return out
}

/**
 * Pólizas no tienen muchos campos normalizables — los códigos de la compañía
 * (numero_poliza, numero_certificado, etc.) se dejan como vienen porque son
 * alfanuméricos case-sensitive para la compañía. observaciones y notas son
 * texto libre que no se toca para no destruir formato intencional.
 *
 * La función existe para dejar el punto de extensión si aparece algún campo
 * futuro que requiera normalización.
 */
export function normalizarPolizaImportada(
  poliza: PolizaImportada | null
): PolizaImportada | null {
  return poliza
}

/**
 * Aplica la normalización completa a un registro mapeado del importador.
 * Pensada para llamarse en `procesarLote` justo después del parseo IA y
 * antes de la validación / detección de duplicados.
 */
export function normalizarEntidadesRegistro(
  entidades: EntidadesRegistro
): EntidadesRegistro {
  return {
    persona: normalizarPersonaImportada(entidades.persona),
    poliza: normalizarPolizaImportada(entidades.poliza),
    riesgo: normalizarRiesgoImportado(entidades.riesgo),
  }
}
