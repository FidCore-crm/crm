/**
 * Tipos compartidos del dominio de siniestros.
 *
 * Usado por:
 *  - Formulario manual (/crm/siniestros/nuevo)
 *  - Formulario público (/denuncia)
 *  - API interna (/api/siniestros/crear)
 *  - API pública (/api/publico/siniestros)
 *  - PDF de denuncia (src/lib/pdf-siniestro.ts)
 *  - Emails de notificación
 *
 * El backend serializa estas estructuras dentro de
 * `siniestros.detalle_siniestro` (JSONB). Los datos del tercero también se
 * persisten en columnas directas (`tercero_nombre`, `tercero_dni`, etc.)
 * para búsqueda y reporting.
 */

export type TipoRiesgoSiniestro = 'automotor' | 'moto' | 'hogar' | 'vida' | 'generico'

export interface ConductorData {
  nombre: string
  apellido?: string
  dni: string
  telefono: string
  relacion: string
  registro: string
}

export interface TerceroData {
  nombre: string
  dni: string
  telefono: string
  compania: string
  poliza: string
  /** Categoría unificada de tercero (7 valores: vehiculo/moto/bici/peaton/objeto_fijo/persona/otro). */
  categoria?: string
  tipo_vehiculo: string
  patente: string
  marca: string
  modelo: string
  anio: string
  danos: string
}

export interface TestigoData {
  nombre: string
  telefono: string
}

export const MAX_TESTIGOS = 3

export const TIPOS_VIVIENDA = [
  { value: 'casa',         label: 'Casa' },
  { value: 'departamento', label: 'Departamento' },
  { value: 'ph',           label: 'PH' },
  { value: 'duplex',       label: 'Dúplex' },
] as const

export const QUE_PASO_HOGAR = [
  { value: 'incendio',              label: 'Incendio' },
  { value: 'robo_hurto',            label: 'Robo / Hurto' },
  { value: 'filtracion_agua',       label: 'Filtración de agua' },
  { value: 'granizo',               label: 'Granizo' },
  { value: 'vendaval',              label: 'Vendaval' },
  { value: 'danos_electronicos',    label: 'Daños a equipos electrónicos' },
  { value: 'responsabilidad_civil', label: 'Responsabilidad civil' },
  { value: 'otro',                  label: 'Otro' },
] as const

export const TIPOS_VEHICULO_TERCERO = [
  { value: 'auto',       label: 'Auto' },
  { value: 'moto',       label: 'Moto' },
  { value: 'camioneta',  label: 'Camioneta' },
  { value: 'camion',     label: 'Camión' },
  { value: 'colectivo',  label: 'Colectivo' },
  { value: 'bicicleta',  label: 'Bicicleta' },
  { value: 'peaton',     label: 'Peatón' },
  { value: 'otro',       label: 'Otro' },
] as const

export const RELACIONES_CONDUCTOR = [
  'Cónyuge',
  'Hijo/a',
  'Padre/Madre',
  'Hermano/a',
  'Empleado/a',
  'Amigo/a',
  'Otro',
] as const

/**
 * Construye el JSONB `detalle_siniestro` consolidado a partir de los inputs
 * estructurados. Centralizar acá la forma del JSONB garantiza paridad entre
 * el form manual y el público, y evita que cada caller "invente" claves.
 *
 * Las claves se omiten cuando el dato no aplica (toggle apagado) para que
 * el JSONB quede limpio.
 */
export function construirDetalleSiniestro(input: {
  tipo_riesgo: string
  tipo_otro_descripcion?: string
  // Lugar
  denuncia_policial?: boolean
  acta_policial?: string
  // Auto/moto
  vehiculo_estacionado?: boolean
  otra_persona_conduce?: boolean
  conductor?: ConductorData
  danos_propios?: string
  hubo_lesionados?: boolean
  detalle_lesiones?: string
  hubo_tercero?: boolean
  tercero_fuga?: boolean
  tercero?: TerceroData
  hubo_testigos?: boolean
  testigos?: TestigoData[]
  // Hogar
  tipo_vivienda?: string
  que_paso?: string
  ambiente_afectado?: string
  causa_siniestro?: string
  // Genéricos extra (campos configurados por el productor en el ramo)
  extra?: Record<string, string>
}): Record<string, any> {
  const out: Record<string, any> = {
    tipo_riesgo: input.tipo_riesgo,
    ...(input.extra ?? {}),
  }

  if (input.tipo_otro_descripcion?.trim()) {
    out.tipo_otro_descripcion = input.tipo_otro_descripcion.trim()
  }

  if (input.denuncia_policial) {
    out.denuncia_policial = true
    if (input.acta_policial?.trim()) {
      out.acta_policial = input.acta_policial.trim()
    }
  }

  if (input.vehiculo_estacionado !== undefined) {
    out.vehiculo_estacionado = input.vehiculo_estacionado
  }

  const esAutoMoto = input.tipo_riesgo === 'automotor' || input.tipo_riesgo === 'moto'
  if (esAutoMoto) {
    out.otra_persona_conduce = !!input.otra_persona_conduce
    if (input.otra_persona_conduce && input.conductor) {
      out.conductor = {
        nombre:   input.conductor.nombre?.trim() ?? '',
        apellido: input.conductor.apellido?.trim() ?? '',
        dni:      input.conductor.dni?.trim() ?? '',
        telefono: input.conductor.telefono?.trim() ?? '',
        relacion: input.conductor.relacion?.trim() ?? '',
        registro: input.conductor.registro?.trim() ?? '',
      }
    }
    if (input.danos_propios?.trim()) out.danos_propios = input.danos_propios.trim()
    out.hubo_lesionados = !!input.hubo_lesionados
    if (input.hubo_lesionados && input.detalle_lesiones?.trim()) {
      out.detalle_lesiones = input.detalle_lesiones.trim()
    }
    out.hubo_tercero = !!input.hubo_tercero
    if (input.hubo_tercero) {
      out.tercero_fuga = !!input.tercero_fuga
      if (!input.tercero_fuga && input.tercero) {
        out.tercero = {
          nombre:        input.tercero.nombre?.trim() ?? '',
          dni:           input.tercero.dni?.trim() ?? '',
          telefono:      input.tercero.telefono?.trim() ?? '',
          compania:      input.tercero.compania?.trim() ?? '',
          poliza:        input.tercero.poliza?.trim() ?? '',
          tipo_vehiculo: input.tercero.tipo_vehiculo?.trim() ?? '',
          patente:       (input.tercero.patente ?? '').toUpperCase().trim(),
          marca:         input.tercero.marca?.trim() ?? '',
          modelo:        input.tercero.modelo?.trim() ?? '',
          anio:          input.tercero.anio?.trim() ?? '',
          danos:         input.tercero.danos?.trim() ?? '',
        }
      }
    }
  }

  // Testigos (aplica a cualquier ramo, pero típicamente auto/moto)
  if (input.hubo_testigos && input.testigos && input.testigos.length > 0) {
    const limpios = input.testigos
      .map(t => ({
        nombre:   t.nombre?.trim() ?? '',
        telefono: t.telefono?.trim() ?? '',
      }))
      .filter(t => t.nombre || t.telefono)
      .slice(0, MAX_TESTIGOS)
    if (limpios.length > 0) {
      out.hubo_testigos = true
      out.testigos = limpios
    }
  }

  // Hogar
  if (input.tipo_riesgo === 'hogar') {
    if (input.tipo_vivienda) out.tipo_vivienda = input.tipo_vivienda
    if (input.que_paso) out.que_paso = input.que_paso
    if (input.ambiente_afectado?.trim()) out.ambiente_afectado = input.ambiente_afectado.trim()
    if (input.causa_siniestro?.trim()) out.causa_siniestro = input.causa_siniestro.trim()
  }

  return out
}

/**
 * Lee un valor de tipo_riesgo del catálogo ramo y lo normaliza a uno de los
 * 5 tipos canónicos (automotor / moto / hogar / vida / generico).
 *
 * El admin puede haber puesto cualquier string en `metadata.tipo_riesgo`,
 * incluyendo mayúsculas, plurales, sinónimos. Esta función absorbe esa
 * variedad y devuelve siempre uno de los 5.
 */
export function normalizarTipoRiesgo(raw: string | null | undefined): TipoRiesgoSiniestro {
  if (!raw) return 'generico'
  const s = String(raw).toLowerCase().trim()
  if (s === 'moto' || s === 'motovehiculo' || s === 'motos') return 'moto'
  if (s.startsWith('auto')) return 'automotor'
  if (s.startsWith('hogar') || s.includes('combinado familiar')) return 'hogar'
  if (s.startsWith('vida') || s.includes('salud') || s.includes('accidente')) return 'vida'
  // Tipos nuevos del catálogo de ramos extendido — mapeo a los legacy
  // para que las APIs públicas y los forms de denuncia sigan funcionando.
  // Cuando se extienda el formulario público para soportar los nuevos
  // tipos con UI propia, este mapeo se puede acotar o eliminar.
  if (s === 'integrales') return 'hogar'
  if (s === 'personas') return 'vida'
  // transporte, embarcacion, caucion → generico (sin formulario específico todavía)
  return 'generico'
}
