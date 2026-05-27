/**
 * Validación y normalización centralizada de Personas.
 *
 * Se invoca desde POST /api/personas y PATCH /api/personas/[id] para garantizar
 * que los datos que llegan al CRM tengan formato consistente sin importar
 * qué frontend (o cliente externo) los mande.
 *
 * Regla: nunca confiar en el cliente — toda validación crítica vive acá.
 */

import { validarCUIT, validarEmail } from '@/lib/importacion/validators'
import { toTitleCase, normalizarEmail } from '@/lib/importacion/normalizadores'

export interface PersonaInput {
  tipo_persona?: 'FISICA' | 'JURIDICA'
  apellido?: string | null
  nombre?: string | null
  razon_social?: string | null
  dni_cuil?: string | null
  email?: string | null
  email_secundario?: string | null
  telefono?: string | null
  telefono_secundario?: string | null
  whatsapp?: string | null
  estado?: string | null
  origen?: string | null
  segmento?: string | null
  canal_preferido?: string | null
  acepta_marketing?: boolean | null
  calle?: string | null
  numero?: string | null
  piso_depto?: string | null
  barrio?: string | null
  localidad?: string | null
  provincia?: string | null
  codigo_postal?: string | null
  pais?: string | null
}

export interface PersonaNormalizada {
  tipo_persona: 'FISICA' | 'JURIDICA'
  apellido: string
  nombre: string | null
  razon_social: string | null
  dni_cuil: string
  email: string | null
  email_secundario: string | null
  telefono: string | null
  telefono_secundario: string | null
  whatsapp: string | null
  estado: 'ACTIVO' | 'INACTIVO' | 'BLOQUEADO' | 'PROSPECTO'
  origen: string | null
  segmento: string | null
  canal_preferido: string | null
  acepta_marketing: boolean
  calle: string | null
  numero: string | null
  piso_depto: string | null
  barrio: string | null
  localidad: string | null
  provincia: string | null
  codigo_postal: string | null
  pais: string | null
}

const ESTADOS_VALIDOS = ['ACTIVO', 'INACTIVO', 'BLOQUEADO', 'PROSPECTO'] as const
const ORIGENES_VALIDOS = [
  'REFERIDO', 'WEB', 'REDES_SOCIALES', 'CARTERA_PROPIA',
  'LLAMADA_ENTRANTE', 'EVENTO', 'OTRO',
] as const
const CANALES_VALIDOS = ['WHATSAPP', 'TELEFONO', 'EMAIL', 'CORREO', 'PRESENCIAL'] as const

function trimOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s.length > 0 ? s : null
}

function soloDigitos(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '')
}

/**
 * Escapa los wildcards `%` y `_` para usar el valor literal en queries `ilike`.
 * Evita falsos positivos cuando el usuario tipea esos caracteres en una búsqueda.
 */
export function escaparLikeWildcards(valor: string): string {
  return valor.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * Valida y normaliza un payload de persona. En modo `crear` exige los campos
 * mínimos; en modo `editar` los toma como parciales si están presentes.
 *
 * Aplica:
 *  - trim en todos los strings, null para vacíos
 *  - Title Case en apellido/nombre/razón social/calle/barrio/localidad/provincia
 *  - lowercase en emails
 *  - dni_cuil → solo dígitos (para que el storage sea siempre puro numérico)
 *  - validación CUIT con dígito verificador si tiene 11 dígitos
 */
export function validarYNormalizarPersona(
  input: PersonaInput,
  modo: 'crear' | 'editar'
): { ok: true; datos: PersonaNormalizada } | { ok: false; campos: Record<string, string> } {
  const campos: Record<string, string> = {}

  const tipo_persona = input.tipo_persona === 'JURIDICA' ? 'JURIDICA' : 'FISICA'

  const apellidoIn = trimOrNull(input.apellido)
  const nombreIn = trimOrNull(input.nombre)
  const razonIn = trimOrNull(input.razon_social)

  if (tipo_persona === 'FISICA') {
    if (modo === 'crear' && !apellidoIn) campos.apellido = 'El apellido es obligatorio'
    if (modo === 'crear' && !nombreIn) campos.nombre = 'El nombre es obligatorio'
  } else {
    if (modo === 'crear' && !razonIn) campos.razon_social = 'La razón social es obligatoria'
  }

  const dniDigitos = soloDigitos(input.dni_cuil)
  if (modo === 'crear' || input.dni_cuil !== undefined) {
    if (!dniDigitos) {
      campos.dni_cuil = 'El DNI/CUIL es obligatorio'
    } else if (dniDigitos.length < 7) {
      campos.dni_cuil = 'DNI/CUIL inválido (mínimo 7 dígitos)'
    } else if (dniDigitos.length > 8 && dniDigitos.length !== 11) {
      campos.dni_cuil = 'DNI debe tener 7-8 dígitos o CUIL/CUIT 11 dígitos'
    } else if (dniDigitos.length === 11) {
      const r = validarCUIT(dniDigitos)
      if (!r.valido) campos.dni_cuil = r.motivo || 'CUIL/CUIT inválido (dígito verificador incorrecto)'
    }
  }

  let emailNormalizado: string | null = null
  if (input.email !== undefined) {
    const t = trimOrNull(input.email)
    if (t) {
      const r = validarEmail(t)
      if (!r.valido) campos.email = 'Email inválido'
      else emailNormalizado = r.normalizado ?? t.toLowerCase()
    }
  }

  let emailSecNormalizado: string | null = null
  if (input.email_secundario !== undefined) {
    const t = trimOrNull(input.email_secundario)
    if (t) {
      const r = validarEmail(t)
      if (!r.valido) campos.email_secundario = 'Email secundario inválido'
      else emailSecNormalizado = r.normalizado ?? t.toLowerCase()
    }
  }

  if (input.estado !== undefined && input.estado !== null && input.estado !== '') {
    if (!ESTADOS_VALIDOS.includes(input.estado as typeof ESTADOS_VALIDOS[number])) {
      campos.estado = 'Estado inválido'
    }
  }
  if (input.origen) {
    if (!ORIGENES_VALIDOS.includes(input.origen as typeof ORIGENES_VALIDOS[number])) {
      campos.origen = 'Origen inválido'
    }
  }
  if (input.canal_preferido) {
    if (!CANALES_VALIDOS.includes(input.canal_preferido as typeof CANALES_VALIDOS[number])) {
      campos.canal_preferido = 'Canal preferido inválido'
    }
  }

  if (Object.keys(campos).length > 0) {
    return { ok: false, campos }
  }

  // Normalización: title case para nombres propios + razón social en upper
  const apellidoNorm = tipo_persona === 'FISICA'
    ? (toTitleCase(apellidoIn) ?? apellidoIn ?? '')
    : (razonIn ? razonIn.toUpperCase() : '')
  const nombreNorm = tipo_persona === 'FISICA' ? (toTitleCase(nombreIn) ?? null) : null
  const razonNorm = tipo_persona === 'JURIDICA' && razonIn ? razonIn.toUpperCase() : null

  const datos: PersonaNormalizada = {
    tipo_persona,
    apellido: apellidoNorm,
    nombre: nombreNorm,
    razon_social: razonNorm,
    dni_cuil: dniDigitos,
    email: emailNormalizado ?? (input.email !== undefined ? null : ''),
    email_secundario: emailSecNormalizado ?? (input.email_secundario !== undefined ? null : ''),
    telefono: trimOrNull(input.telefono),
    telefono_secundario: trimOrNull(input.telefono_secundario),
    whatsapp: trimOrNull(input.whatsapp),
    estado: (input.estado as PersonaNormalizada['estado']) || 'ACTIVO',
    origen: trimOrNull(input.origen),
    segmento: trimOrNull(input.segmento),
    canal_preferido: trimOrNull(input.canal_preferido),
    acepta_marketing: input.acepta_marketing === undefined ? true : !!input.acepta_marketing,
    calle: toTitleCase(trimOrNull(input.calle)) ?? null,
    numero: trimOrNull(input.numero),
    piso_depto: trimOrNull(input.piso_depto),
    barrio: toTitleCase(trimOrNull(input.barrio)) ?? null,
    localidad: toTitleCase(trimOrNull(input.localidad)) ?? null,
    provincia: toTitleCase(trimOrNull(input.provincia)) ?? null,
    codigo_postal: trimOrNull(input.codigo_postal)?.toUpperCase() ?? null,
    pais: toTitleCase(trimOrNull(input.pais)) ?? null,
  }

  // Si el caller no envió email/email_secundario, los devolvemos como undefined
  // para que el endpoint sepa "no tocar este campo" en modo editar. Lo filtra
  // el endpoint antes del INSERT/UPDATE.
  if (input.email === undefined) (datos as any).email = undefined
  if (input.email_secundario === undefined) (datos as any).email_secundario = undefined

  // `pais` es NOT NULL con default 'Argentina' en la DB. Si el caller no lo
  // envió explícito, devolvemos undefined para que el INSERT use el default
  // del schema en vez de pisarlo con NULL.
  if (input.pais === undefined) (datos as any).pais = undefined

  return { ok: true, datos }
}

/**
 * Construye el payload final para INSERT/UPDATE filtrando los `undefined` que
 * indican "no enviado por el cliente". Útil para PATCH parcial.
 */
export function payloadParaSupabase(datos: PersonaNormalizada): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(datos)) {
    if (v !== undefined) out[k] = v
  }
  return out
}
