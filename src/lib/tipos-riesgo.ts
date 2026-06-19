// ============================================================
// Catálogo de "tipos de riesgo" — los moldes de formulario para
// describir el bien asegurado de una póliza.
//
// El catálogo de ramos del PAS (compañías, ramos comerciales tipo
// "Auto", "Moto", "Integral de Comercio", etc.) apunta a UN tipo
// de riesgo de esta lista vía `metadata.tipo_riesgo`. El tipo
// define qué campos aparecen en el formulario de carga de póliza
// y qué campos por default aparecen en el formulario de carga
// de siniestro.
//
// Diferencia importante:
//   - "Ramo" = clasificación COMERCIAL del PAS (la elige él).
//   - "Tipo de riesgo" = MOLDE DE FORMULARIO técnico, hay 7 fijos
//     definidos acá. Es lo que en la UI llamamos "Datos del bien
//     asegurado".
//
// Si un PAS necesita un ramo que no encaje en estos 7 (drones,
// mascotas, criptoactivos), por ahora cae en "generico". Sumar
// un tipo nuevo requiere editar este archivo + los 3 forms de
// póliza que renderan los campos.
// ============================================================

export type TipoRiesgoKey =
  | 'automotor'
  | 'integrales'
  | 'personas'
  | 'transporte'
  | 'embarcacion'
  | 'caucion'
  | 'generico'

export interface TipoRiesgoDef {
  /** Identificador interno, lo que va en `metadata.tipo_riesgo` */
  key: TipoRiesgoKey
  /** Nombre visible en el dropdown */
  label: string
  /** Emoji ilustrativo */
  emoji: string
  /** Resumen corto que aparece debajo del dropdown */
  resumen: string
  /** Ramos típicos (para mostrar en help text) */
  ejemplos: string[]
  /**
   * Campos del formulario de PÓLIZA. Los lee el form de alta de póliza
   * para renderear los inputs. La key tiene que coincidir con la columna
   * del JSONB `riesgos.detalle_tecnico` y con el helper `detalleDe()` del
   * form de póliza.
   */
  campos_poliza: CampoPoliza[]
  /** Campos por default que se sugieren al cargar el ramo desde catálogos
   *  para usar en el formulario de SINIESTRO. El PAS los puede editar. */
  campos_siniestro_default: CampoSiniestro[]
}

export interface CampoPoliza {
  key: string
  label: string
  tipo: 'text' | 'textarea' | 'select' | 'number' | 'date'
  requerido: boolean
  placeholder?: string
  opciones?: string[]
  ancho?: 'completo' | 'mitad'
}

export interface CampoSiniestro {
  key: string
  label: string
  tipo: 'text' | 'textarea' | 'select' | 'date'
  requerido: boolean
  placeholder?: string
  opciones?: string
}

// ────────────────────────────────────────────────────────────
// Definiciones
// ────────────────────────────────────────────────────────────

export const TIPOS_RIESGO: TipoRiesgoDef[] = [
  {
    key: 'automotor',
    label: 'Automotor',
    emoji: '🚗',
    resumen: 'Para vehículos de cualquier tipo. El formulario va a pedir patente, marca, modelo y datos técnicos.',
    ejemplos: ['Auto', 'Moto', 'Camión', 'Casa rodante', 'Cuatriciclo', 'Pick-up'],
    campos_poliza: [
      { key: 'patente', label: 'Patente', tipo: 'text', requerido: true, placeholder: 'ABC123 o AB123CD', ancho: 'mitad' },
      { key: 'marca', label: 'Marca', tipo: 'text', requerido: true, placeholder: 'Toyota', ancho: 'mitad' },
      { key: 'modelo', label: 'Modelo', tipo: 'text', requerido: true, placeholder: 'Corolla', ancho: 'mitad' },
      { key: 'anio', label: 'Año', tipo: 'number', requerido: true, placeholder: '2023', ancho: 'mitad' },
      { key: 'motor', label: 'Motor', tipo: 'text', requerido: false, ancho: 'mitad' },
      { key: 'chasis', label: 'Chasis', tipo: 'text', requerido: false, ancho: 'mitad' },
      { key: 'color', label: 'Color', tipo: 'text', requerido: false, ancho: 'mitad' },
      { key: 'uso', label: 'Uso', tipo: 'select', requerido: false, opciones: ['Particular', 'Comercial', 'Profesional', 'Taxi/Remis', 'Otro'], ancho: 'mitad' },
    ],
    campos_siniestro_default: [
      { key: 'lugar_hecho', label: 'Lugar del hecho', tipo: 'text', requerido: true, placeholder: 'Av. Rivadavia y Carabobo' },
      { key: 'terceros', label: 'Datos del tercero', tipo: 'textarea', requerido: false, placeholder: 'Nombre, DNI, patente, compañía...' },
      { key: 'lesionados', label: '¿Hay lesionados?', tipo: 'select', requerido: false, opciones: 'No,Sí - Leves,Sí - Graves' },
      { key: 'acta_policial', label: 'Nro. Acta Policial', tipo: 'text', requerido: false, placeholder: 'Opcional' },
      { key: 'taller', label: 'Taller de reparación', tipo: 'text', requerido: false, placeholder: 'Nombre y dirección' },
    ],
  },

  {
    key: 'integrales',
    label: 'Integrales (Hogar, Comercio, Consorcio)',
    emoji: '🏠',
    resumen: 'Para inmuebles de cualquier tipo. El formulario pide dirección, superficie, construcción y uso.',
    ejemplos: ['Hogar', 'Integral de Comercio', 'Integral de Consorcio', 'Oficina', 'Local'],
    campos_poliza: [
      { key: 'calle', label: 'Calle', tipo: 'text', requerido: true, placeholder: 'Av. Corrientes', ancho: 'mitad' },
      { key: 'numero', label: 'Número', tipo: 'text', requerido: false, placeholder: '1234', ancho: 'mitad' },
      { key: 'piso_depto', label: 'Piso/Depto', tipo: 'text', requerido: false, placeholder: '5 B', ancho: 'mitad' },
      { key: 'localidad', label: 'Localidad', tipo: 'text', requerido: true, placeholder: 'CABA', ancho: 'mitad' },
      { key: 'provincia', label: 'Provincia', tipo: 'text', requerido: false, ancho: 'mitad' },
      { key: 'codigo_postal', label: 'Código postal', tipo: 'text', requerido: false, ancho: 'mitad' },
      { key: 'superficie', label: 'Superficie (m²)', tipo: 'number', requerido: false, placeholder: '120', ancho: 'mitad' },
      { key: 'tipo_construccion', label: 'Tipo de construcción', tipo: 'select', requerido: false, opciones: ['Material', 'Mixta', 'Madera', 'Premoldeada', 'Otro'], ancho: 'mitad' },
      { key: 'uso_inmueble', label: 'Uso del inmueble', tipo: 'select', requerido: false, opciones: ['Vivienda', 'Comercio', 'Oficina', 'Consorcio', 'Local industrial', 'Otro'], ancho: 'mitad' },
      { key: 'actividad', label: 'Actividad comercial (si corresponde)', tipo: 'text', requerido: false, placeholder: 'Kiosco, peluquería, etc.', ancho: 'mitad' },
      { key: 'medidas_seguridad', label: 'Medidas de seguridad', tipo: 'textarea', requerido: false, placeholder: 'Alarma, rejas, caja fuerte, etc.', ancho: 'completo' },
    ],
    campos_siniestro_default: [
      { key: 'descripcion_daños', label: 'Descripción de los daños', tipo: 'textarea', requerido: true, placeholder: 'Detallá los daños...' },
      { key: 'ambiente_afectado', label: 'Ambiente / sector afectado', tipo: 'text', requerido: false, placeholder: 'Cocina, baño, depósito...' },
      { key: 'causa', label: 'Causa del siniestro', tipo: 'text', requerido: false, placeholder: 'Cañería rota, cortocircuito, robo...' },
      { key: 'acta_policial', label: 'Nro. Acta Policial', tipo: 'text', requerido: false, placeholder: 'En caso de robo' },
    ],
  },

  {
    key: 'personas',
    label: 'Personas (Vida, AP, Sepelio, Salud)',
    emoji: '❤️',
    resumen: 'Para seguros sobre la persona. El formulario pide capital asegurado y beneficiarios.',
    ejemplos: ['Vida', 'Sepelio', 'Accidentes Personales', 'Salud', 'Mala praxis'],
    campos_poliza: [
      { key: 'capital_asegurado', label: 'Capital asegurado', tipo: 'number', requerido: false, placeholder: '5000000', ancho: 'mitad' },
      { key: 'plan', label: 'Plan / Cobertura', tipo: 'text', requerido: false, placeholder: 'Plan 200, Premium, etc.', ancho: 'mitad' },
      { key: 'prestador', label: 'Prestador (si aplica)', tipo: 'text', requerido: false, placeholder: 'Sanatorio o prestador', ancho: 'completo' },
      { key: 'beneficiarios', label: 'Beneficiarios', tipo: 'textarea', requerido: false, placeholder: 'Nombre, DNI, parentesco, %', ancho: 'completo' },
    ],
    campos_siniestro_default: [
      { key: 'prestador', label: 'Prestador / Sanatorio', tipo: 'text', requerido: true, placeholder: 'Nombre del sanatorio' },
      { key: 'diagnostico', label: 'Diagnóstico', tipo: 'textarea', requerido: false, placeholder: 'Descripción del diagnóstico' },
      { key: 'fecha_internacion', label: 'Fecha de internación', tipo: 'date', requerido: false },
      { key: 'beneficiario', label: 'Beneficiario que cobra', tipo: 'text', requerido: false, placeholder: 'Nombre del beneficiario' },
    ],
  },

  {
    key: 'transporte',
    label: 'Mercadería en tránsito',
    emoji: '📦',
    resumen: 'Para seguros de mercadería en viaje. El formulario pide tipo de mercadería, valor y origen-destino.',
    ejemplos: ['Transporte de mercadería', 'Logística', 'Importación', 'Exportación'],
    campos_poliza: [
      { key: 'tipo_mercaderia', label: 'Tipo de mercadería', tipo: 'text', requerido: true, placeholder: 'Electrodomésticos, alimentos, etc.', ancho: 'completo' },
      { key: 'valor_mercaderia', label: 'Valor de la mercadería', tipo: 'number', requerido: false, placeholder: '0', ancho: 'mitad' },
      { key: 'medio_transporte', label: 'Medio de transporte', tipo: 'select', requerido: false, opciones: ['Terrestre', 'Marítimo', 'Aéreo', 'Multimodal'], ancho: 'mitad' },
      { key: 'origen', label: 'Origen', tipo: 'text', requerido: false, placeholder: 'Buenos Aires, Argentina', ancho: 'mitad' },
      { key: 'destino', label: 'Destino', tipo: 'text', requerido: false, placeholder: 'San Pablo, Brasil', ancho: 'mitad' },
      { key: 'detalle', label: 'Detalle adicional', tipo: 'textarea', requerido: false, ancho: 'completo' },
    ],
    campos_siniestro_default: [
      { key: 'tipo_evento', label: 'Tipo de evento', tipo: 'select', requerido: true, opciones: 'Robo total,Robo parcial,Daño en tránsito,Pérdida,Otro' },
      { key: 'lugar_hecho', label: 'Lugar del hecho', tipo: 'text', requerido: false, placeholder: 'Ciudad / ruta' },
      { key: 'descripcion_daños', label: 'Descripción del daño / pérdida', tipo: 'textarea', requerido: true },
      { key: 'remito', label: 'Nro. de remito / guía', tipo: 'text', requerido: false },
    ],
  },

  {
    key: 'embarcacion',
    label: 'Embarcación',
    emoji: '🛥️',
    resumen: 'Para seguros náuticos. El formulario pide matrícula, eslora y tipo de embarcación.',
    ejemplos: ['Lancha', 'Velero', 'Crucero', 'Jet ski', 'Embarcación deportiva'],
    campos_poliza: [
      { key: 'nombre_embarcacion', label: 'Nombre de la embarcación', tipo: 'text', requerido: false, placeholder: '"Mar Azul"', ancho: 'mitad' },
      { key: 'matricula', label: 'Matrícula', tipo: 'text', requerido: true, placeholder: 'MAT-12345', ancho: 'mitad' },
      { key: 'tipo_embarcacion', label: 'Tipo', tipo: 'select', requerido: false, opciones: ['Lancha', 'Velero', 'Crucero', 'Jet ski', 'Yate', 'Otro'], ancho: 'mitad' },
      { key: 'anio', label: 'Año de fabricación', tipo: 'number', requerido: false, ancho: 'mitad' },
      { key: 'eslora', label: 'Eslora (metros)', tipo: 'number', requerido: false, ancho: 'mitad' },
      { key: 'motor', label: 'Motor', tipo: 'text', requerido: false, placeholder: 'Marca y modelo', ancho: 'mitad' },
      { key: 'uso', label: 'Uso', tipo: 'select', requerido: false, opciones: ['Recreativo', 'Deportivo', 'Comercial', 'Pesca', 'Otro'], ancho: 'mitad' },
      { key: 'amarra', label: 'Lugar de amarra', tipo: 'text', requerido: false, placeholder: 'Club náutico / puerto', ancho: 'mitad' },
    ],
    campos_siniestro_default: [
      { key: 'tipo_evento', label: 'Tipo de evento', tipo: 'select', requerido: true, opciones: 'Daño,Hundimiento,Colisión,Robo,Incendio,Otro' },
      { key: 'lugar_hecho', label: 'Lugar del hecho', tipo: 'text', requerido: false, placeholder: 'Río / puerto / ciudad' },
      { key: 'descripcion_daños', label: 'Descripción del siniestro', tipo: 'textarea', requerido: true },
      { key: 'condiciones_clima', label: 'Condiciones del clima', tipo: 'text', requerido: false },
    ],
  },

  {
    key: 'caucion',
    label: 'Sin bien físico (Caución, Fianza)',
    emoji: '📄',
    resumen: 'Para garantías financieras o coberturas que no involucran un bien físico. El formulario pide solo descripción y monto.',
    ejemplos: ['Caución', 'Fianza', 'Garantía de alquiler', 'Garantía de obra', 'Aval'],
    campos_poliza: [
      { key: 'descripcion', label: 'Descripción del riesgo / objeto', tipo: 'textarea', requerido: true, placeholder: 'Caución de garantía por alquiler, obra, etc.', ancho: 'completo' },
      { key: 'monto_garantizado', label: 'Monto garantizado', tipo: 'number', requerido: false, ancho: 'mitad' },
      { key: 'beneficiario', label: 'Beneficiario de la garantía', tipo: 'text', requerido: false, placeholder: 'Quién cobra si la cobertura se ejecuta', ancho: 'mitad' },
    ],
    campos_siniestro_default: [
      { key: 'descripcion_evento', label: 'Descripción del incumplimiento / ejecución', tipo: 'textarea', requerido: true },
      { key: 'fecha_intimacion', label: 'Fecha de intimación', tipo: 'date', requerido: false },
      { key: 'monto_reclamado', label: 'Monto reclamado', tipo: 'text', requerido: false, placeholder: 'Solo números' },
    ],
  },

  {
    key: 'generico',
    label: 'Otros / Genérico',
    emoji: '📋',
    resumen: 'Para cualquier otro tipo de seguro. El formulario solo va a pedir una descripción libre.',
    ejemplos: ['Cualquier ramo que no encaje en los otros'],
    campos_poliza: [
      { key: 'descripcion', label: 'Descripción del bien / riesgo asegurado', tipo: 'textarea', requerido: true, placeholder: 'Describí qué se está asegurando…', ancho: 'completo' },
    ],
    campos_siniestro_default: [
      { key: 'descripcion_daños', label: 'Descripción del siniestro', tipo: 'textarea', requerido: true, placeholder: 'Describí qué ocurrió...' },
      { key: 'lugar_hecho', label: 'Lugar del hecho', tipo: 'text', requerido: false, placeholder: 'Dirección o lugar' },
      { key: 'acta_policial', label: 'Nro. Acta Policial', tipo: 'text', requerido: false, placeholder: 'Opcional' },
    ],
  },
]

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/** Devuelve la definición del tipo dado, o el genérico si no se encuentra. */
export function obtenerTipoRiesgo(key: string | null | undefined): TipoRiesgoDef {
  if (!key) return TIPOS_RIESGO[TIPOS_RIESGO.length - 1] // generico
  const found = TIPOS_RIESGO.find(t => t.key === key)
  if (found) return found
  // Compatibilidad histórica: ramos viejos con tipo "hogar" o "vida" caen
  // en integrales / personas respectivamente.
  if (key === 'hogar') return TIPOS_RIESGO.find(t => t.key === 'integrales')!
  if (key === 'vida') return TIPOS_RIESGO.find(t => t.key === 'personas')!
  return TIPOS_RIESGO[TIPOS_RIESGO.length - 1] // generico fallback
}

/** Devuelve los campos por default del siniestro para precargar en el editor. */
export function camposSiniestroDefault(key: TipoRiesgoKey | null): CampoSiniestro[] {
  if (!key) return []
  return obtenerTipoRiesgo(key).campos_siniestro_default
}

/** Lista de keys válidas (sirve para validación o tests). */
export const TIPO_RIESGO_KEYS: TipoRiesgoKey[] = TIPOS_RIESGO.map(t => t.key)

/**
 * Mapea cualquier `tipo_riesgo` al render de formulario de póliza viejo
 * (los 4 que existían antes del catálogo ampliado). Es la compatibilidad
 * que evita tener que escribir 7 secciones distintas de UI:
 *
 *   automotor                 → 'automotor'  (auto/moto/camión)
 *   integrales / hogar        → 'hogar'      (inmuebles)
 *   personas / vida           → 'vida'       (personas)
 *   transporte / embarcacion  → 'generico'   (descripción libre)
 *   caucion / generico / *    → 'generico'   (descripción libre)
 *
 * Los tipos nuevos (transporte, embarcacion, caucion) por ahora rendean
 * la UI genérica — el PAS los puede usar igual, pero los campos
 * específicos definidos en `campos_poliza` no se renderean todavía.
 * Mejora pendiente: refactorizar los 3 forms para que renderen
 * dinámicamente desde `campos_poliza`.
 */
export function tipoRenderForm(key: string | null | undefined): 'automotor' | 'hogar' | 'vida' | 'generico' {
  if (!key) return 'generico'
  const k = key.toLowerCase()
  if (k === 'automotor') return 'automotor'
  if (k === 'integrales' || k === 'hogar') return 'hogar'
  if (k === 'personas' || k === 'vida') return 'vida'
  return 'generico'
}
