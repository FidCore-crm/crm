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
  | 'responsabilidad_civil'
  | 'incendio'
  | 'robo'
  | 'art'
  | 'agropecuario'
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
    campos_siniestro_default: [],
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
    ],
  },

  {
    key: 'personas',
    label: 'Personas (Vida, AP, Sepelio, Salud)',
    emoji: '❤️',
    resumen: 'Para seguros sobre la persona. El formulario pide capital asegurado y beneficiarios.',
    ejemplos: ['Vida', 'Sepelio', 'Accidentes Personales', 'Salud'],
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
    label: 'Transporte',
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
      { key: 'descripcion_daños', label: 'Descripción de los daños', tipo: 'textarea', requerido: true },
      { key: 'condiciones_clima', label: 'Condiciones del clima', tipo: 'text', requerido: false },
    ],
  },

  {
    key: 'responsabilidad_civil',
    label: 'Responsabilidad Civil',
    emoji: '⚖️',
    resumen: 'Para coberturas que protegen al asegurado frente a reclamos de terceros por daños o lesiones causadas por su actividad.',
    ejemplos: ['RC profesional', 'RC hechos privados', 'RC comprensiva'],
    campos_poliza: [
      { key: 'actividad_cubierta', label: 'Descripción de la actividad cubierta', tipo: 'textarea', requerido: true, placeholder: 'Ej: Servicios médicos de cardiología en consultorio privado', ancho: 'completo' },
      { key: 'limite_por_persona', label: 'Límite por persona', tipo: 'number', requerido: false, ancho: 'mitad' },
      { key: 'limite_por_evento', label: 'Límite por evento', tipo: 'number', requerido: false, ancho: 'mitad' },
      { key: 'franquicia', label: 'Franquicia', tipo: 'number', requerido: false, ancho: 'mitad' },
      { key: 'ambito_territorial', label: 'Ámbito territorial', tipo: 'text', requerido: false, placeholder: 'Ej: Argentina, MERCOSUR', ancho: 'mitad' },
    ],
    campos_siniestro_default: [
      { key: 'datos_reclamante', label: 'Datos del damnificado / reclamante', tipo: 'textarea', requerido: true, placeholder: 'Nombre, DNI, contacto' },
      { key: 'danios_reclamados', label: 'Daños o lesiones reclamadas', tipo: 'textarea', requerido: false },
    ],
  },

  {
    key: 'incendio',
    label: 'Incendio',
    emoji: '🔥',
    resumen: 'Para coberturas específicas de incendio sobre inmuebles o contenido. El formulario pide ubicación, construcción y medidas de prevención.',
    ejemplos: ['Incendio edificio', 'Incendio contenido', 'Incendio + adicionales'],
    campos_poliza: [
      { key: 'calle', label: 'Calle', tipo: 'text', requerido: true, placeholder: 'Av. Corrientes', ancho: 'mitad' },
      { key: 'numero', label: 'Número', tipo: 'text', requerido: false, placeholder: '1234', ancho: 'mitad' },
      { key: 'localidad', label: 'Localidad', tipo: 'text', requerido: true, placeholder: 'CABA', ancho: 'mitad' },
      { key: 'provincia', label: 'Provincia', tipo: 'text', requerido: false, ancho: 'mitad' },
      { key: 'codigo_postal', label: 'Código postal', tipo: 'text', requerido: false, ancho: 'mitad' },
      { key: 'tipo_construccion', label: 'Tipo de construcción', tipo: 'select', requerido: false, opciones: ['Material', 'Mixta', 'Madera', 'Premoldeada', 'Otro'], ancho: 'mitad' },
      { key: 'superficie', label: 'Superficie (m²)', tipo: 'number', requerido: false, placeholder: '120', ancho: 'mitad' },
      { key: 'uso_inmueble', label: 'Uso del inmueble', tipo: 'select', requerido: false, opciones: ['Vivienda', 'Comercio', 'Oficina', 'Depósito', 'Industrial', 'Otro'], ancho: 'mitad' },
      { key: 'actividad_contenido', label: 'Actividad o contenido asegurado', tipo: 'textarea', requerido: false, placeholder: 'Mercadería, maquinaria, etc.', ancho: 'completo' },
      { key: 'medidas_prevencion', label: 'Medidas de prevención', tipo: 'textarea', requerido: false, placeholder: 'Extintores, detectores, hidrantes, etc.', ancho: 'completo' },
    ],
    campos_siniestro_default: [
      { key: 'causa_siniestro', label: 'Causa del siniestro', tipo: 'text', requerido: false, placeholder: 'Cortocircuito, fuego externo, etc.' },
      { key: 'sector_afectado', label: 'Sector / ambiente afectado', tipo: 'text', requerido: false },
      { key: 'descripcion_danios', label: 'Descripción de los daños', tipo: 'textarea', requerido: true },
      { key: 'bomberos_actuacion', label: 'Bomberos intervinientes / Nro. de actuación', tipo: 'text', requerido: false },
    ],
  },

  {
    key: 'robo',
    label: 'Robo',
    emoji: '🔒',
    resumen: 'Para coberturas de robo sobre objetos puntuales (bicicletas, teléfonos, notebooks, etc.). No usar para locales o casas — eso va en Integrales.',
    ejemplos: [],
    campos_poliza: [
      { key: 'descripcion_objeto', label: 'Descripción del objeto asegurado', tipo: 'textarea', requerido: true, placeholder: 'Ej: Bicicleta Trek Marlin 7 rodado 29 / iPhone 14 Pro 256GB', ancho: 'completo' },
      { key: 'marca', label: 'Marca', tipo: 'text', requerido: false, ancho: 'mitad' },
      { key: 'modelo', label: 'Modelo', tipo: 'text', requerido: false, ancho: 'mitad' },
      { key: 'numero_serie', label: 'Nro. de serie / IMEI / chasis', tipo: 'text', requerido: false, ancho: 'mitad' },
      { key: 'anio', label: 'Año', tipo: 'number', requerido: false, ancho: 'mitad' },
      { key: 'valor_asegurado', label: 'Valor asegurado', tipo: 'number', requerido: false, ancho: 'mitad' },
      { key: 'lugar_guarda', label: 'Lugar habitual de guarda', tipo: 'text', requerido: false, placeholder: 'Ej: cochera del edificio, oficina, mochila', ancho: 'mitad' },
    ],
    campos_siniestro_default: [
      { key: 'fiscalia_comisaria', label: 'Fiscalía / comisaría interviniente', tipo: 'text', requerido: false },
      { key: 'otros_bienes', label: 'Otros bienes robados en el mismo hecho', tipo: 'textarea', requerido: false },
    ],
  },

  {
    key: 'art',
    label: 'ART (Riesgos del Trabajo)',
    emoji: '👷',
    resumen: 'Para Aseguradoras de Riesgos del Trabajo. El formulario pide datos del empleador y dotación.',
    ejemplos: ['ART', 'Riesgos del trabajo'],
    campos_poliza: [
      { key: 'cuit_empleador', label: 'CUIT del empleador', tipo: 'text', requerido: true, placeholder: '30-12345678-9', ancho: 'mitad' },
      { key: 'razon_social', label: 'Razón social', tipo: 'text', requerido: false, ancho: 'mitad' },
      { key: 'actividad_ciiu', label: 'Actividad / CIIU', tipo: 'text', requerido: false, placeholder: 'Código CIIU o descripción', ancho: 'mitad' },
      { key: 'cantidad_empleados', label: 'Cantidad de empleados', tipo: 'number', requerido: false, ancho: 'mitad' },
      { key: 'masa_salarial', label: 'Masa salarial mensual estimada', tipo: 'number', requerido: false, ancho: 'mitad' },
      { key: 'calle', label: 'Calle (establecimiento)', tipo: 'text', requerido: false, ancho: 'mitad' },
      { key: 'numero', label: 'Número', tipo: 'text', requerido: false, ancho: 'mitad' },
      { key: 'localidad', label: 'Localidad', tipo: 'text', requerido: false, ancho: 'mitad' },
      { key: 'provincia', label: 'Provincia', tipo: 'text', requerido: false, ancho: 'mitad' },
    ],
    campos_siniestro_default: [
      { key: 'trabajador_nombre', label: 'Nombre y apellido del trabajador', tipo: 'text', requerido: true },
      { key: 'trabajador_dni', label: 'DNI del trabajador', tipo: 'text', requerido: true },
      { key: 'in_itinere', label: '¿In itinere?', tipo: 'select', requerido: false, opciones: 'Sí,No' },
      { key: 'diagnostico', label: 'Diagnóstico / lesión', tipo: 'textarea', requerido: false },
      { key: 'centro_medico', label: 'Centro médico que atendió', tipo: 'text', requerido: false },
    ],
  },

  {
    key: 'agropecuario',
    label: 'Agropecuario',
    emoji: '🌾',
    resumen: 'Para seguros del campo: cultivos, animales, maquinaria agrícola, granizo, multirriesgo.',
    ejemplos: ['Granizo', 'Multirriesgo agrícola', 'Animales', 'Maquinaria agrícola'],
    campos_poliza: [
      { key: 'ubicacion', label: 'Ubicación (calle/ruta del establecimiento)', tipo: 'text', requerido: false, ancho: 'mitad' },
      { key: 'partido', label: 'Partido / departamento', tipo: 'text', requerido: false, ancho: 'mitad' },
      { key: 'provincia', label: 'Provincia', tipo: 'text', requerido: false, ancho: 'mitad' },
      { key: 'tipo_cobertura', label: 'Tipo de cobertura específica', tipo: 'select', requerido: false, opciones: ['Granizo', 'Multirriesgo', 'Animales', 'Maquinaria', 'Otro'], ancho: 'mitad' },
      { key: 'superficie_ha', label: 'Superficie (hectáreas)', tipo: 'number', requerido: false, ancho: 'mitad' },
      { key: 'valor_asegurado', label: 'Valor asegurado', tipo: 'number', requerido: false, ancho: 'mitad' },
      { key: 'cultivo_actividad', label: 'Cultivo / especie / actividad', tipo: 'textarea', requerido: false, placeholder: 'Ej: soja, trigo, ganado vacuno', ancho: 'completo' },
    ],
    campos_siniestro_default: [
      { key: 'tipo_evento', label: 'Tipo de evento', tipo: 'select', requerido: true, opciones: 'Granizo,Inundación,Sequía,Helada,Incendio,Enfermedad animal,Otro' },
      { key: 'lote_afectado', label: 'Lote / sector afectado', tipo: 'text', requerido: false },
      { key: 'hectareas_afectadas', label: 'Hectáreas afectadas', tipo: 'text', requerido: false },
      { key: 'descripcion_danio', label: 'Descripción del daño', tipo: 'textarea', requerido: true },
      { key: 'perdida_estimada', label: 'Pérdida estimada (%)', tipo: 'text', requerido: false },
    ],
  },

  {
    key: 'generico',
    label: 'Otros / Genérico',
    emoji: '📋',
    resumen: 'Para cualquier otro tipo de seguro. El formulario solo va a pedir una descripción libre.',
    ejemplos: ['Cualquier ramo que no encaje en los otros'],
    campos_poliza: [
      { key: 'descripcion', label: 'Descripción del bien asegurado', tipo: 'textarea', requerido: true, placeholder: 'Describí qué se está asegurando…', ancho: 'completo' },
    ],
    campos_siniestro_default: [
      { key: 'descripcion_daños', label: 'Descripción de los daños', tipo: 'textarea', requerido: true, placeholder: 'Detallá los daños resultantes...' },
    ],
  },
]

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/** Devuelve la definición del tipo dado, o el genérico si no se encuentra. */
export function obtenerTipoRiesgo(key: string | null | undefined): TipoRiesgoDef {
  if (!key) return TIPOS_RIESGO[TIPOS_RIESGO.length - 1] // generico
  const k = String(key).toLowerCase()
  const found = TIPOS_RIESGO.find(t => t.key === k)
  if (found) return found
  // Compatibilidad histórica: ramos viejos con tipo "hogar" o "vida" caen
  // en integrales / personas respectivamente.
  if (k === 'hogar') return TIPOS_RIESGO.find(t => t.key === 'integrales')!
  if (k === 'vida') return TIPOS_RIESGO.find(t => t.key === 'personas')!
  // `caucion` se eliminó como tipo propio (v1.0.24); cualquier ramo viejo
  // que lo tuviera apuntando cae a genérico.
  if (k === 'caucion') return TIPOS_RIESGO.find(t => t.key === 'generico')!
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
 * Mapea cualquier `tipo_riesgo` al render de formulario de póliza que se
 * usa para dibujar los inputs del bien asegurado.
 *
 *   automotor                                   → 'automotor'  (UI hardcoded)
 *   integrales / hogar                          → 'hogar'      (UI hardcoded)
 *   personas / vida                             → 'vida'       (UI hardcoded)
 *   transporte / embarcacion / responsabilidad_civil
 *   / incendio / robo / art / agropecuario      → 'dinamico'   (lee campos_poliza)
 *   generico / caucion (legacy) / null          → 'generico'   (textarea libre)
 *
 * Los 3 renders hardcoded (automotor/hogar/vida) tienen UI específica con
 * inputs nombrados y validaciones. Los 7 que devuelven 'dinamico' rendean
 * los inputs leyendo la definición `campos_poliza` del tipo — el form solo
 * tiene que llamar a `<CamposBienAseguradoDinamico>` y pasarle un objeto
 * de valores libre que se guarda en `riesgos.detalle_tecnico`.
 *
 * 'generico' queda como fallback de seguridad cuando no hay tipo seteado o
 * el ramo viejo apuntaba a `caucion` (eliminado).
 */
export function tipoRenderForm(key: string | null | undefined): 'automotor' | 'hogar' | 'vida' | 'dinamico' | 'generico' {
  if (!key) return 'generico'
  const k = key.toLowerCase()
  if (k === 'automotor') return 'automotor'
  if (k === 'integrales' || k === 'hogar') return 'hogar'
  if (k === 'personas' || k === 'vida') return 'vida'
  if (
    k === 'transporte' ||
    k === 'embarcacion' ||
    k === 'responsabilidad_civil' ||
    k === 'incendio' ||
    k === 'robo' ||
    k === 'art' ||
    k === 'agropecuario'
  ) return 'dinamico'
  return 'generico'
}
