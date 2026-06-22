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
  // Organismos y entidades
  'YPF', 'AFIP', 'ANSES', 'ARBA', 'AGIP', 'ARCA',
  'CABA', 'AMBA', 'PAMI', 'IOMA', 'OSDE',
  'INTA', 'INTI', 'ANMAT', 'UBA', 'UTN',
  'SSN', 'BCRA', 'CNV', 'ONU', 'OMS',
  // Abreviaturas de dirección
  'CP',
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
  return SIGLAS_MAYUSCULA.has(limpio)
}

/**
 * Título de una cadena respetando:
 *  - Partículas en minúscula salvo que sean la primera palabra.
 *  - Siglas en mayúscula (SA, SRL, YPF, II, III...). Las siglas con puntos
 *    ("S.A.", "S.R.L.") se NORMALIZAN sin puntos para evitar variantes.
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
      // 1. Siglas argentinas/acrónimos/romanos → UPPER sin puntos.
      // Esto colapsa "S.A." y "SA" al mismo string "SA" para que dedupe
      // consistente y muestre prolijo en la UI.
      if (esSigla(token)) {
        return token.replace(/\./g, '').toUpperCase()
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
 * Estado de persona. La DB tiene un CHECK constraint que solo acepta los
 * 4 valores del enum: PROSPECTO/ACTIVO/INACTIVO/BLOQUEADO. Pero el PAS
 * puede escribir "activo", "Activo", "ACTIVO", "Cliente", "Cliente activo",
 * "Vigente", etc. — toleramos variantes razonables y caemos a ACTIVO si
 * no matchea con nada.
 */
export function normalizarEstadoPersona(
  valor: string | null | undefined
): 'PROSPECTO' | 'ACTIVO' | 'INACTIVO' | 'BLOQUEADO' {
  if (!valor) return 'ACTIVO'
  const s = String(valor).trim().toUpperCase()
  if (!s) return 'ACTIVO'
  if (s.includes('PROSPECT')) return 'PROSPECTO'
  if (s.includes('BLOQUE') || s.includes('SUSPEND')) return 'BLOQUEADO'
  if (
    s.includes('INACT') ||
    s.includes('BAJA') ||
    s === 'NO' ||
    s.includes('SUSPENDIDO')
  ) return 'INACTIVO'
  // Default amplio: cliente, activo, vigente, asegurado, etc. → ACTIVO
  return 'ACTIVO'
}

/**
 * Estado de póliza. CHECK constraint acepta: PROGRAMADA/VIGENTE/NO_VIGENTE/
 * CANCELADA/ANULADA. El PAS puede escribir "vigente", "Vigente", "VIGENTE",
 * "Activa", "En vigor", etc. Si el valor es vacío o no matchea, devolvemos
 * null para que el flujo de importación calcule el estado desde las fechas.
 */
export function normalizarEstadoPoliza(
  valor: string | null | undefined
): 'PROGRAMADA' | 'VIGENTE' | 'NO_VIGENTE' | 'CANCELADA' | 'ANULADA' | null {
  if (!valor) return null
  const s = String(valor).trim().toUpperCase()
  if (!s) return null
  if (s.includes('PROGRAM') || s.includes('FUTUR')) return 'PROGRAMADA'
  if (s.includes('CANCEL')) return 'CANCELADA'
  if (s.includes('ANUL')) return 'ANULADA'
  if (
    s.includes('NO_VIG') ||
    s.includes('NO VIG') ||
    s === 'VENCIDA' ||
    s === 'VENCIDO' ||
    s.includes('CADUC') ||
    s === 'INACTIVA' ||
    s === 'BAJA'
  ) return 'NO_VIGENTE'
  // Default amplio: vigente, activa, en vigor, en curso, asegurada → VIGENTE
  return 'VIGENTE'
}

/**
 * Tipo de persona. CHECK constraint acepta: FISICA/JURIDICA. Si el PAS
 * no lo escribió o escribió algo raro, lo INFERIMOS desde el DNI/CUIT:
 *  - CUIT empieza con 30/33/34 → JURIDICA.
 *  - DNI de 7-8 dígitos → FISICA.
 *  - CUIT con prefijo 20/23/24/25/26/27 → FISICA.
 */
export function normalizarTipoPersona(
  valor: string | null | undefined,
  dni_cuil?: string | null,
): 'FISICA' | 'JURIDICA' {
  if (valor) {
    const s = String(valor).trim().toUpperCase()
    if (s.startsWith('JUR') || s.startsWith('PJ') || s.startsWith('PERSONA J')) return 'JURIDICA'
    if (s.startsWith('FIS') || s.startsWith('PF') || s.startsWith('PERSONA F')) return 'FISICA'
  }
  // Inferir del documento si está
  if (dni_cuil) {
    const digitos = String(dni_cuil).replace(/\D/g, '')
    if (digitos.length === 11) {
      const prefijo = digitos.slice(0, 2)
      if (['30', '33', '34'].includes(prefijo)) return 'JURIDICA'
      return 'FISICA' // 20/23/24/25/26/27 → física
    }
    // DNI corto (7-8 dígitos) → siempre persona física
    return 'FISICA'
  }
  return 'FISICA'
}

/**
 * Moneda. La DB no tiene CHECK formal pero todo el código asume ARS/USD.
 * Aceptamos variantes: $, pesos, dolares, U$S, etc.
 */
export function normalizarMoneda(
  valor: string | null | undefined
): 'ARS' | 'USD' {
  if (!valor) return 'ARS'
  const s = String(valor).trim().toUpperCase().replace(/[\s.]/g, '')
  if (!s) return 'ARS'
  if (
    s === 'USD' ||
    s === 'US' ||
    s === 'U$S' ||
    s === 'U$' ||
    s.includes('DOLAR') ||
    s.includes('DOLLAR') ||
    s === 'US$'
  ) return 'USD'
  return 'ARS'
}

/**
 * DNI/CUIT/CUIL → solo dígitos. Saca puntos, guiones, espacios y cualquier
 * otro separador que el PAS haya usado en el archivo. Caso típico:
 * "20.123.456-7" → "20123456" / "27-33445566-8" → "27334455668".
 */
export function normalizarDocumento(
  valor: string | number | null | undefined
): string | null | undefined {
  if (valor === null || valor === undefined || valor === '') return null
  const s = String(valor).replace(/\D/g, '')
  return s || null
}

/**
 * Teléfono → formato +54... cuando es posible, sino solo dígitos.
 * Caso típico: "(011) 4555-6789" → "+541145556789" / "11 5555 6666" → "+541155556666".
 *
 * Reglas:
 *  - Si empieza con +54, mantener.
 *  - Si empieza con 54, anteponer +.
 *  - Si empieza con 0 (línea fija argentina), reemplazar con 54.
 *  - Si empieza con 9 después del 54, mantener (móvil internacional).
 *  - Si nada parece argentino, devolver dígitos sin prefijo (puede ser exterior).
 */
export function normalizarTelefono(
  valor: string | null | undefined
): string | null | undefined {
  if (valor === null || valor === undefined || valor === '') return null
  const original = String(valor).trim()
  if (!original) return null

  const digitos = original.replace(/\D/g, '')
  if (!digitos) return null
  // Demasiado corto: probablemente no es un teléfono, devolver tal cual trimmed.
  if (digitos.length < 6) return original

  let normalizado: string
  if (digitos.startsWith('54')) {
    normalizado = `+${digitos}`
  } else if (digitos.startsWith('0')) {
    // Línea fija argentina con prefijo nacional.
    normalizado = `+54${digitos.slice(1)}`
  } else if (digitos.length >= 10 && digitos.length <= 11) {
    // Asumimos argentino sin prefijo de país.
    normalizado = `+54${digitos}`
  } else {
    // No identificamos prefijo claro — devolvemos solo los dígitos con +.
    normalizado = `+${digitos}`
  }

  return normalizado
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

// Campos de PERSONA que se normalizan como teléfono.
const CAMPOS_PERSONA_TELEFONO: Array<keyof PersonaImportada> = [
  'telefono', 'telefono_secundario', 'whatsapp',
]

// Campos de PERSONA que son documentos (DNI/CUIT/CUIL).
const CAMPOS_PERSONA_DOCUMENTO: Array<keyof PersonaImportada> = [
  'dni_cuil',
]

// Campos de RIESGO en Title Case (campos top-level legacy).
const CAMPOS_RIESGO_TITLECASE: Array<keyof RiesgoImportado> = [
  'marca', 'modelo', 'color', 'uso',
  'direccion_riesgo', 'tipo_construccion',
]

// Claves del detalle_tecnico que NO se normalizan a Title Case (mantienen
// formato original o se pasan a upper). Cubre identificadores de hardware
// (patentes, motores, números de serie), emails y campos puramente numéricos.
const CLAVES_RIESGO_NO_TITLECASE = new Set([
  // Identificadores que van en upper o mantienen su formato
  'patente', 'motor', 'chasis', 'numero_serie', 'imei', 'matricula',
  'cuit_empleador', 'actividad_ciiu',
  // Email
  'email',
  // Numéricos puros (capital, valor, superficie, etc.) — los detecta typeof
  // antes de aplicar, pero los listamos para claridad.
  'anio', 'capital_asegurado', 'valor_asegurado', 'valor_mercaderia',
  'superficie', 'superficie_ha', 'eslora', 'cantidad_empleados',
  'masa_salarial', 'limite_por_persona', 'limite_por_evento',
  'franquicia', 'hectareas_afectadas', 'perdida_estimada',
  // Códigos / acta / matrículas que pueden tener letras pero se preservan tal cual
  'acta_policial', 'acta_denuncia', 'bomberos_actuacion',
  // Texto libre largo (descripciones, beneficiarios) — el PAS escribe a su gusto
  'descripcion', 'descripcion_objeto', 'descripcion_hecho', 'descripcion_daños',
  'descripcion_danio', 'descripcion_danios',
  'beneficiarios', 'observaciones', 'detalle', 'detalle_adicional',
  'medidas_seguridad', 'medidas_prevencion',
  'actividad_cubierta', 'actividad_contenido', 'cultivo_actividad',
])

export function normalizarPersonaImportada(
  persona: PersonaImportada | null
): PersonaImportada | null {
  if (!persona) return persona
  const out: PersonaImportada = { ...persona }

  // 1. Trim universal sobre strings que no son metadata
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'string') {
      const trimmed = v.trim()
      ;(out as any)[k] = trimmed === '' ? null : trimmed
    }
  }

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

  for (const campo of CAMPOS_PERSONA_TELEFONO) {
    const v = out[campo]
    if (typeof v === 'string') {
      out[campo] = normalizarTelefono(v) as any
    }
  }

  for (const campo of CAMPOS_PERSONA_DOCUMENTO) {
    const v = out[campo]
    if (typeof v === 'string' || typeof v === 'number') {
      out[campo] = normalizarDocumento(v) as any
    }
  }

  if (typeof out.codigo_postal === 'string') {
    out.codigo_postal = normalizarCodigoPostal(out.codigo_postal) as any
  }

  // ENUM: estado siempre normalizado a uno de los 4 válidos del CHECK constraint.
  // Si vino vacío o algo raro, queda en ACTIVO.
  out.estado = normalizarEstadoPersona(out.estado as string | null | undefined) as any

  // ENUM: tipo_persona normalizado + inferido desde el DNI/CUIT.
  out.tipo_persona = normalizarTipoPersona(
    out.tipo_persona as string | null | undefined,
    out.dni_cuil as string | null | undefined,
  ) as any

  // Número de casa: se preserva tal cual (puede tener letras como "1234 bis")
  // pero se trimea (ya lo hizo el loop universal).

  return out
}

export function normalizarRiesgoImportado(
  riesgo: RiesgoImportado | null
): RiesgoImportado | null {
  if (!riesgo) return riesgo
  const out: RiesgoImportado = { ...riesgo }

  // 1. Trim universal sobre todos los strings
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'string') {
      const trimmed = v.trim()
      ;(out as any)[k] = trimmed === '' ? null : trimmed
    }
  }

  // 2. Campos top-level legacy en Title Case
  for (const campo of CAMPOS_RIESGO_TITLECASE) {
    const v = out[campo]
    if (typeof v === 'string') {
      out[campo] = toTitleCase(v) as any
    }
  }

  // 3. Patente (top-level legacy)
  if (typeof out.patente === 'string') {
    out.patente = normalizarPatente(out.patente) as any
  }

  // 4. Motor y chasis: siempre UPPERCASE + trim (convención del CRM).
  if (typeof (out as any).motor === 'string') {
    const m = ((out as any).motor as string).trim().toUpperCase()
    ;(out as any).motor = m || null
  }
  if (typeof (out as any).chasis === 'string') {
    const c = ((out as any).chasis as string).trim().toUpperCase()
    ;(out as any).chasis = c || null
  }

  // 5. Descripción corta: title case si vino texto.
  if (typeof out.descripcion_corta === 'string') {
    out.descripcion_corta = toTitleCase(out.descripcion_corta) as any
  }

  // 6. Cualquier OTRO campo string que no esté en la blacklist
  // (campos dinámicos del detalle_tecnico de los 11 tipos: tipo_mercaderia,
  // origen, destino, plan, prestador, ubicacion, partido, lugar_guarda, etc.)
  // se pasa a Title Case para que quede prolijo.
  const TOP_LEVEL_YA_PROCESADOS = new Set<string>([
    'tipo_riesgo', 'descripcion_corta', 'suma_asegurada',
    'patente', 'marca', 'modelo', 'anio', 'motor', 'chasis', 'color', 'uso',
    'direccion_riesgo', 'tipo_construccion', 'superficie',
    'capital_asegurado', 'beneficiarios',
  ])
  for (const [k, v] of Object.entries(out)) {
    if (TOP_LEVEL_YA_PROCESADOS.has(k)) continue
    if (CLAVES_RIESGO_NO_TITLECASE.has(k)) continue
    if (typeof v !== 'string') continue
    // Patente embebida en otros campos
    if (k.toLowerCase().includes('patente')) {
      ;(out as any)[k] = normalizarPatente(v)
      continue
    }
    // Matrículas, números de serie y similares: upper
    if (
      k.toLowerCase().includes('matricula') ||
      k.toLowerCase().includes('numero_serie') ||
      k.toLowerCase() === 'imei'
    ) {
      ;(out as any)[k] = v.toUpperCase()
      continue
    }
    // Default: Title Case
    ;(out as any)[k] = toTitleCase(v)
  }

  return out
}

/**
 * Pólizas no tienen muchos campos normalizables — los códigos de la compañía
 * (numero_poliza, numero_certificado, etc.) se dejan como vienen porque son
 * alfanuméricos case-sensitive para la compañía. observaciones y notas son
 * texto libre que no se toca para no destruir formato intencional.
 *
 * Lo que SÍ hacemos: trim universal para limpiar espacios al inicio/final.
 */
export function normalizarPolizaImportada(
  poliza: PolizaImportada | null
): PolizaImportada | null {
  if (!poliza) return poliza
  const out: PolizaImportada = { ...poliza }

  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'string') {
      const trimmed = v.trim()
      ;(out as any)[k] = trimmed === '' ? null : trimmed
    }
  }

  // ENUM: estado de póliza tolerante. Si no matchea o vino vacío,
  // queda en null y el importador deriva el estado desde las fechas.
  const estadoNorm = normalizarEstadoPoliza(out.estado as string | null | undefined)
  if (estadoNorm) out.estado = estadoNorm as any

  // ENUM: moneda → ARS por default si vino algo raro o vacío.
  out.moneda = normalizarMoneda(out.moneda as string | null | undefined) as any

  return out
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
