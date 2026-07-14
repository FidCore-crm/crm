// ============================================================================
// siniestros-catalogo.ts — Matriz (tipo_riesgo × tipo_siniestro) → campos.
//
// Fuente única de verdad de qué campos debe pedir cada formulario de siniestro
// según el ramo (tipo_riesgo del catálogo) y el tipo elegido por el asegurado
// (tipo_siniestro).
//
// Consumidores:
//   - src/app/denuncia/page.tsx           (formulario público)
//   - src/app/crm/siniestros/nuevo/page.tsx (alta manual desde el CRM)
//   - src/components/EditarSiniestroModal.tsx (edición post-carga)
//   - src/app/crm/siniestros/[id]/page.tsx (ficha detalle)
//
// Estructura:
//   - BLOQUES: grupos reusables de campos (conductor, tercero, testigos, etc.)
//   - TipoSiniestroConfig: cada tipo tiene una lista de bloques + campos extras
//   - TIPOS_POR_TIPO_RIESGO: matriz principal. Para cada tipo_riesgo del catálogo
//     de ramos (automotor/moto/hogar/etc), lista los tipos de siniestro válidos.
//
// Reglas de negocio importantes:
//   - RC_TERCEROS NO se ofrece en automotor/moto (está implícito en accidente).
//   - ROBO_RUEDAS es específico de automotor (usa el selector visual).
//   - Cada tipo activa solo los bloques que le hacen sentido: granizo NO pide
//     conductor ni tercero, solo daños; robo de ruedas NO pide tercero.
// ============================================================================

// ────────────────────────────────────────────────────────────
// Tipos base
// ────────────────────────────────────────────────────────────

/** Grupos reusables de campos que se activan en varios tipos. */
export type BloqueId =
  | 'vehiculo_estacionado'
  | 'conductor'
  | 'tercero'
  | 'testigos'
  | 'lesionados'
  | 'danos_propios'
  | 'selector_rueda'

export interface CampoEspecifico {
  key: string
  label: string
  tipo: 'text' | 'textarea' | 'select' | 'number' | 'date' | 'checkbox' | 'radio'
  requerido: boolean
  placeholder?: string
  /** Para select/radio. Array o string separado por comas. */
  opciones?: string[] | string
  /** Texto de ayuda debajo del campo. */
  ayuda?: string
  ancho?: 'completo' | 'mitad'
}

export interface TipoSiniestroConfig {
  /** Identificador interno (ej: 'ACCIDENTE_TRANSITO'). */
  value: string
  /** Label visible al usuario. */
  label: string
  /** Emoji opcional para mostrar en el selector. */
  icono?: string
  /** Bloques reusables que activa este tipo, en orden de aparición. */
  bloques: BloqueId[]
  /** Campos específicos adicionales de este tipo. */
  campos: CampoEspecifico[]
}

// ────────────────────────────────────────────────────────────
// Definición de bloques reusables
// ────────────────────────────────────────────────────────────

export const CATEGORIAS_TERCERO = [
  { value: 'vehiculo', label: 'Otro vehículo (auto, camioneta)' },
  { value: 'moto', label: 'Moto' },
  { value: 'bici', label: 'Bicicleta' },
  { value: 'peaton', label: 'Peatón' },
  { value: 'objeto_fijo', label: 'Objeto fijo (árbol, poste, etc.)' },
  { value: 'persona', label: 'Otra persona (sin vehículo)' },
  { value: 'otro', label: 'Otro' },
] as const

export const RELACIONES_CONDUCTOR = [
  'Titular',
  'Cónyuge',
  'Hijo/a',
  'Padre/Madre',
  'Empleado',
  'Familiar',
  'Amigo',
  'Otro',
] as const

/**
 * Los campos que compone cada bloque. La UI decide layout — este archivo solo
 * define QUÉ campos tiene cada bloque, no cómo se dibujan.
 */
export const CAMPOS_POR_BLOQUE: Record<BloqueId, CampoEspecifico[]> = {
  vehiculo_estacionado: [
    {
      key: 'vehiculo_estacionado',
      label: '¿El vehículo estaba estacionado?',
      tipo: 'checkbox',
      requerido: false,
      ayuda: 'Marcá esta opción si nadie estaba conduciendo al momento del siniestro.',
    },
  ],

  conductor: [
    {
      key: 'otra_persona_conduce',
      label: '¿Conducía otra persona?',
      tipo: 'checkbox',
      requerido: false,
      ayuda: 'Marcá si al momento del siniestro conducía alguien distinto al asegurado.',
    },
    { key: 'nombre', label: 'Nombre', tipo: 'text', requerido: true, ancho: 'mitad' },
    { key: 'apellido', label: 'Apellido', tipo: 'text', requerido: true, ancho: 'mitad' },
    { key: 'dni', label: 'DNI', tipo: 'text', requerido: true, ancho: 'mitad' },
    { key: 'telefono', label: 'Teléfono', tipo: 'text', requerido: false, ancho: 'mitad' },
    {
      key: 'relacion',
      label: 'Relación con el asegurado',
      tipo: 'select',
      requerido: false,
      opciones: [...RELACIONES_CONDUCTOR],
      ancho: 'mitad',
    },
    { key: 'registro', label: 'Nro. de registro', tipo: 'text', requerido: false, ancho: 'mitad' },
  ],

  tercero: [
    {
      key: 'hubo_tercero',
      label: '¿Hubo un tercero involucrado?',
      tipo: 'checkbox',
      requerido: false,
    },
    {
      key: 'tercero_fuga',
      label: 'El tercero se dio a la fuga',
      tipo: 'checkbox',
      requerido: false,
      ayuda: 'Marcá si el tercero no se identificó o abandonó el lugar.',
    },
    {
      key: 'categoria',
      label: '¿Qué era el tercero?',
      tipo: 'select',
      requerido: true,
      opciones: CATEGORIAS_TERCERO.map(c => c.label),
      ancho: 'completo',
    },
    { key: 'nombre', label: 'Nombre y apellido', tipo: 'text', requerido: false, ancho: 'mitad' },
    { key: 'dni', label: 'DNI', tipo: 'text', requerido: false, ancho: 'mitad' },
    { key: 'telefono', label: 'Teléfono', tipo: 'text', requerido: false, ancho: 'mitad' },
    { key: 'compania', label: 'Compañía aseguradora', tipo: 'text', requerido: false, ancho: 'mitad' },
    { key: 'poliza', label: 'Nro. de póliza del tercero', tipo: 'text', requerido: false, ancho: 'mitad' },
    { key: 'patente', label: 'Patente', tipo: 'text', requerido: false, ancho: 'mitad' },
    { key: 'marca', label: 'Marca', tipo: 'text', requerido: false, ancho: 'mitad' },
    { key: 'modelo', label: 'Modelo', tipo: 'text', requerido: false, ancho: 'mitad' },
    { key: 'anio', label: 'Año', tipo: 'text', requerido: false, ancho: 'mitad' },
    {
      key: 'danos',
      label: 'Daños del tercero',
      tipo: 'textarea',
      requerido: false,
      placeholder: 'Describí los daños en el vehículo/objeto del tercero...',
      ancho: 'completo',
    },
  ],

  testigos: [
    {
      key: 'hubo_testigos',
      label: '¿Hubo testigos?',
      tipo: 'checkbox',
      requerido: false,
      ayuda: 'Podés cargar hasta 3 testigos.',
    },
    // Los campos de cada testigo individual se manejan como array en la UI.
    // Acá solo definimos qué pide por testigo.
    { key: 'nombre', label: 'Nombre y apellido', tipo: 'text', requerido: true, ancho: 'mitad' },
    { key: 'dni', label: 'DNI', tipo: 'text', requerido: false, ancho: 'mitad' },
    { key: 'telefono', label: 'Teléfono', tipo: 'text', requerido: false, ancho: 'completo' },
  ],

  lesionados: [
    {
      key: 'hubo_lesionados',
      label: '¿Hubo lesionados?',
      tipo: 'select',
      requerido: true,
      opciones: ['No', 'Sí — leves', 'Sí — graves'],
      ancho: 'mitad',
    },
    {
      key: 'detalle_lesiones',
      label: 'Detalle de las lesiones',
      tipo: 'textarea',
      requerido: false,
      placeholder: 'Quién resultó lesionado, gravedad, atención médica recibida...',
      ancho: 'completo',
    },
  ],

  danos_propios: [
    {
      key: 'danos_propios',
      label: 'Daños del vehículo asegurado',
      tipo: 'textarea',
      requerido: false,
      placeholder: 'Describí los daños visibles del vehículo asegurado...',
      ancho: 'completo',
    },
  ],

  selector_rueda: [
    // El "campo" rueda_robada usa un componente custom (SelectorRueda) que
    // renderea el SVG del auto. La UI lo detecta por el key 'rueda_robada'.
    {
      key: 'rueda_robada',
      label: '¿Qué rueda robaron?',
      tipo: 'radio',
      requerido: true,
      opciones: [
        'Delantera izquierda',
        'Delantera derecha',
        'Trasera izquierda',
        'Trasera derecha',
        'Auxilio',
      ],
      ayuda: 'Tocá la rueda que falta en el dibujo.',
    },
    {
      key: 'marca_ruedas',
      label: 'Marca de las ruedas',
      tipo: 'text',
      requerido: true,
      placeholder: 'Ej: Pirelli, Michelin, Bridgestone...',
      ancho: 'mitad',
    },
    {
      key: 'medida_ruedas',
      label: 'Medida de las ruedas',
      tipo: 'text',
      requerido: true,
      placeholder: 'Ej: 195/65 R15',
      ancho: 'mitad',
    },
    {
      key: 'tipo_llanta',
      label: 'Tipo de llanta',
      tipo: 'select',
      requerido: true,
      opciones: ['Chapa', 'Aleación'],
      ancho: 'mitad',
    },
  ],
}

// ────────────────────────────────────────────────────────────
// Matriz principal: tipos de siniestro por tipo de riesgo
// ────────────────────────────────────────────────────────────

/**
 * Tipos de siniestro válidos por cada tipo_riesgo del catálogo de ramos.
 * Un ramo con `metadata.tipo_riesgo = "automotor"` va a ofrecer los tipos
 * de TIPOS_POR_TIPO_RIESGO.automotor.
 */
export const TIPOS_POR_TIPO_RIESGO: Record<string, TipoSiniestroConfig[]> = {
  // ─────────── AUTOMOTOR (auto, camioneta, camión) ───────────
  automotor: [
    {
      value: 'ACCIDENTE_TRANSITO',
      label: 'Accidente de tránsito',
      icono: '🚗',
      bloques: ['vehiculo_estacionado', 'conductor', 'tercero', 'testigos', 'lesionados', 'danos_propios'],
      campos: [],
    },
    {
      value: 'ROBO_TOTAL',
      label: 'Robo total del vehículo',
      icono: '🔒',
      bloques: [],
      campos: [
        {
          key: 'lugar_habitual_guarda',
          label: 'Lugar habitual de guarda',
          tipo: 'text',
          requerido: false,
          placeholder: 'Cochera, calle, garage privado...',
        },
        {
          key: 'con_llaves',
          label: '¿Se lo llevaron con las llaves?',
          tipo: 'select',
          requerido: false,
          opciones: ['No', 'Sí', 'No sé'],
        },
      ],
    },
    {
      value: 'ROBO_PARCIAL',
      label: 'Robos parciales',
      icono: '🔓',
      bloques: [],
      campos: [
        {
          key: 'objetos_robados',
          label: 'Detallar objetos robados',
          tipo: 'textarea',
          requerido: true,
          placeholder: 'Radio, GPS, herramientas...',
        },
        {
          key: 'como_ingresaron',
          label: '¿Cómo ingresaron al vehículo?',
          tipo: 'text',
          requerido: false,
          placeholder: 'Rompieron vidrio, forzaron cerradura...',
        },
      ],
    },
    {
      value: 'ROBO_RUEDAS',
      label: 'Robo de ruedas',
      icono: '🛞',
      bloques: ['selector_rueda'],
      campos: [],
    },
    {
      value: 'GRANIZO',
      label: 'Granizo',
      icono: '🌨️',
      bloques: ['danos_propios'],
      campos: [
        {
          key: 'lugar_hecho_granizo',
          label: '¿Dónde estaba el vehículo?',
          tipo: 'text',
          requerido: false,
          placeholder: 'Vía pública, cochera descubierta, garage...',
        },
      ],
    },
    {
      value: 'ROTURA_CRISTALES',
      label: 'Rotura de cristales',
      icono: '🪟',
      bloques: [],
      campos: [
        {
          key: 'cristal_afectado',
          label: '¿Qué cristal se rompió?',
          tipo: 'select',
          requerido: true,
          opciones: ['Parabrisas', 'Luneta trasera', 'Cristal lateral', 'Espejo', 'Otro'],
          ancho: 'mitad',
        },
        {
          key: 'tipo_intervencion',
          label: '¿Reemplazo o reparación?',
          tipo: 'select',
          requerido: false,
          opciones: ['Reemplazo', 'Reparación', 'A definir'],
          ancho: 'mitad',
        },
      ],
    },
    {
      value: 'INCENDIO',
      label: 'Incendio del vehículo',
      icono: '🔥',
      bloques: ['danos_propios'],
      campos: [
        {
          key: 'causa_probable',
          label: 'Causa probable',
          tipo: 'text',
          requerido: false,
          placeholder: 'Cortocircuito, fuego externo, sin determinar...',
        },
        {
          key: 'hubo_bomberos',
          label: '¿Intervinieron bomberos?',
          tipo: 'select',
          requerido: false,
          opciones: ['No', 'Sí'],
        },
      ],
    },
    {
      value: 'OTRO',
      label: 'Otro',
      icono: '📋',
      bloques: [],
      campos: [
        {
          key: 'tipo_otro_descripcion',
          label: 'Especificá el tipo de siniestro',
          tipo: 'text',
          requerido: true,
          placeholder: 'Describí brevemente...',
        },
      ],
    },
  ],

  // ─────────── HOGAR / INTEGRALES ───────────
  integrales: [
    {
      value: 'ROBO',
      label: 'Robo',
      icono: '🔒',
      bloques: ['lesionados'],
      campos: [
        {
          key: 'objetos_robados',
          label: 'Objetos robados',
          tipo: 'textarea',
          requerido: true,
          placeholder: 'Detallá los objetos robados con valor estimado...',
        },
        {
          key: 'como_ingresaron',
          label: '¿Cómo ingresaron?',
          tipo: 'text',
          requerido: false,
          placeholder: 'Forzaron puerta, rompieron ventana, ingresaron por techo...',
        },
        {
          key: 'medidas_forzadas',
          label: 'Medidas de seguridad afectadas',
          tipo: 'text',
          requerido: false,
          placeholder: 'Alarma, rejas, cerradura...',
        },
      ],
    },
    {
      value: 'INCENDIO',
      label: 'Incendio',
      icono: '🔥',
      bloques: ['lesionados'],
      campos: [
        {
          key: 'ambiente_afectado',
          label: 'Ambiente / sector afectado',
          tipo: 'text',
          requerido: true,
          placeholder: 'Cocina, dormitorio, sala, garage...',
        },
        {
          key: 'causa_probable',
          label: 'Causa probable',
          tipo: 'text',
          requerido: false,
          placeholder: 'Cortocircuito, plancha, cocina...',
        },
        {
          key: 'hubo_bomberos',
          label: '¿Intervinieron bomberos?',
          tipo: 'select',
          requerido: false,
          opciones: ['No', 'Sí'],
        },
      ],
    },
    {
      value: 'DANO_POR_AGUA',
      label: 'Daño por agua',
      icono: '💧',
      bloques: [],
      campos: [
        {
          key: 'causa',
          label: 'Causa',
          tipo: 'select',
          requerido: true,
          opciones: ['Rotura de cañería', 'Filtración de terraza', 'Filtración del vecino', 'Otro'],
        },
        {
          key: 'ambiente_afectado',
          label: 'Ambientes afectados',
          tipo: 'text',
          requerido: true,
          placeholder: 'Baño, cocina, dormitorio...',
        },
        {
          key: 'danos_estructurales',
          label: 'Daños estructurales',
          tipo: 'textarea',
          requerido: false,
          placeholder: 'Pintura, cielorraso, humedad, revestimientos...',
        },
        {
          key: 'danos_muebles',
          label: 'Daños en muebles / electrodomésticos',
          tipo: 'textarea',
          requerido: false,
        },
      ],
    },
    {
      value: 'GRANIZO',
      label: 'Granizo',
      icono: '🌨️',
      bloques: [],
      campos: [
        {
          key: 'ambiente_afectado',
          label: 'Sector afectado',
          tipo: 'text',
          requerido: true,
          placeholder: 'Techo, patio, terraza...',
        },
        {
          key: 'danos_visibles',
          label: 'Daños visibles',
          tipo: 'textarea',
          requerido: true,
          placeholder: 'Techo, vidrios, canaletas...',
        },
      ],
    },
    {
      value: 'TORMENTA',
      label: 'Tormenta / viento fuerte',
      icono: '🌪️',
      bloques: [],
      campos: [
        {
          key: 'ambiente_afectado',
          label: 'Sector afectado',
          tipo: 'text',
          requerido: true,
        },
        {
          key: 'danos_visibles',
          label: 'Daños visibles',
          tipo: 'textarea',
          requerido: true,
          placeholder: 'Caída de árboles, voladura de techo, roturas...',
        },
      ],
    },
    {
      value: 'RC_TERCEROS',
      label: 'Responsabilidad civil a terceros',
      icono: '⚖️',
      bloques: ['tercero', 'lesionados'],
      campos: [
        {
          key: 'reclamo_descripcion',
          label: 'Descripción del reclamo',
          tipo: 'textarea',
          requerido: true,
          placeholder: '¿Qué daño reclama el tercero?',
        },
        {
          key: 'monto_reclamado',
          label: 'Monto reclamado',
          tipo: 'text',
          requerido: false,
          placeholder: 'Si el tercero especificó monto',
        },
      ],
    },
    {
      value: 'OTRO',
      label: 'Otro',
      icono: '📋',
      bloques: [],
      campos: [
        {
          key: 'tipo_otro_descripcion',
          label: 'Especificá el tipo de siniestro',
          tipo: 'text',
          requerido: true,
        },
      ],
    },
  ],

  // ─────────── PERSONAS (vida, AP, sepelio, salud) ───────────
  personas: [
    {
      value: 'ACCIDENTE',
      label: 'Accidente',
      icono: '🚑',
      bloques: [],
      campos: [
        {
          key: 'lugar_hecho_persona',
          label: 'Lugar donde ocurrió',
          tipo: 'text',
          requerido: false,
          placeholder: 'Ej: Domicilio, vía pública, lugar de trabajo...',
        },
        {
          key: 'actividad_realizando',
          label: '¿Qué estaba haciendo?',
          tipo: 'text',
          requerido: false,
          placeholder: 'Ej: Practicando deporte, transitando por la vía pública...',
        },
        {
          key: 'prestador',
          label: 'Prestador / sanatorio que atendió',
          tipo: 'text',
          requerido: false,
        },
        {
          key: 'diagnostico',
          label: 'Diagnóstico',
          tipo: 'textarea',
          requerido: false,
        },
        {
          key: 'fecha_internacion',
          label: 'Fecha de internación (si aplica)',
          tipo: 'date',
          requerido: false,
        },
      ],
    },
    {
      value: 'ENFERMEDAD',
      label: 'Enfermedad',
      icono: '🏥',
      bloques: [],
      campos: [
        {
          key: 'prestador',
          label: 'Prestador / sanatorio',
          tipo: 'text',
          requerido: true,
        },
        {
          key: 'diagnostico',
          label: 'Diagnóstico',
          tipo: 'textarea',
          requerido: true,
        },
        {
          key: 'fecha_diagnostico',
          label: 'Fecha del diagnóstico',
          tipo: 'date',
          requerido: false,
        },
      ],
    },
    {
      value: 'FALLECIMIENTO',
      label: 'Fallecimiento',
      icono: '🕊️',
      bloques: [],
      campos: [
        {
          key: 'fecha_fallecimiento',
          label: 'Fecha del fallecimiento',
          tipo: 'date',
          requerido: true,
        },
        {
          key: 'lugar_fallecimiento',
          label: 'Lugar del fallecimiento',
          tipo: 'text',
          requerido: false,
        },
        {
          key: 'causa_fallecimiento',
          label: 'Causa',
          tipo: 'text',
          requerido: false,
          placeholder: 'Según certificado médico',
        },
        {
          key: 'beneficiario',
          label: 'Beneficiario que cobra',
          tipo: 'text',
          requerido: false,
        },
      ],
    },
    {
      value: 'OTRO',
      label: 'Otro',
      icono: '📋',
      bloques: [],
      campos: [
        {
          key: 'tipo_otro_descripcion',
          label: 'Especificá el tipo de siniestro',
          tipo: 'text',
          requerido: true,
        },
      ],
    },
  ],

  // ─────────── TRANSPORTE (mercadería en tránsito) ───────────
  transporte: [
    {
      value: 'ROBO_TOTAL',
      label: 'Robo total de la mercadería',
      icono: '🔒',
      bloques: [],
      campos: [
        { key: 'remito', label: 'Nro. de remito / guía', tipo: 'text', requerido: false },
        { key: 'origen', label: 'Origen del envío', tipo: 'text', requerido: false, ancho: 'mitad' },
        { key: 'destino', label: 'Destino del envío', tipo: 'text', requerido: false, ancho: 'mitad' },
      ],
    },
    {
      value: 'ROBO_PARCIAL',
      label: 'Robo parcial',
      icono: '🔓',
      bloques: [],
      campos: [
        { key: 'remito', label: 'Nro. de remito / guía', tipo: 'text', requerido: false },
        { key: 'valor_faltante', label: 'Valor estimado del faltante', tipo: 'text', requerido: false },
        {
          key: 'detalle_faltante',
          label: 'Detalle de lo faltante',
          tipo: 'textarea',
          requerido: true,
        },
      ],
    },
    {
      value: 'DANO_EN_TRANSITO',
      label: 'Daño en tránsito',
      icono: '📦',
      bloques: [],
      campos: [
        { key: 'remito', label: 'Nro. de remito / guía', tipo: 'text', requerido: false },
        {
          key: 'causa',
          label: 'Causa probable',
          tipo: 'text',
          requerido: false,
          placeholder: 'Choque, mal manipuleo, lluvia...',
        },
      ],
    },
    {
      value: 'PERDIDA',
      label: 'Pérdida de la mercadería',
      icono: '❓',
      bloques: [],
      campos: [
        { key: 'remito', label: 'Nro. de remito / guía', tipo: 'text', requerido: false },
        {
          key: 'ultimo_lugar_visto',
          label: 'Último lugar donde se vio',
          tipo: 'text',
          requerido: false,
        },
      ],
    },
    {
      value: 'OTRO',
      label: 'Otro',
      icono: '📋',
      bloques: [],
      campos: [{ key: 'tipo_otro_descripcion', label: 'Especificá', tipo: 'text', requerido: true }],
    },
  ],

  // ─────────── EMBARCACIÓN ───────────
  embarcacion: [
    {
      value: 'DANO',
      label: 'Daño',
      icono: '🛥️',
      bloques: [],
      campos: [
        {
          key: 'condiciones_clima',
          label: 'Condiciones del clima',
          tipo: 'text',
          requerido: false,
        },
      ],
    },
    {
      value: 'HUNDIMIENTO',
      label: 'Hundimiento',
      icono: '🌊',
      bloques: ['lesionados'],
      campos: [
        { key: 'ubicacion', label: 'Ubicación', tipo: 'text', requerido: true },
        { key: 'condiciones_clima', label: 'Condiciones del clima', tipo: 'text', requerido: false },
        {
          key: 'personas_a_bordo',
          label: 'Cantidad de personas a bordo',
          tipo: 'number',
          requerido: false,
        },
      ],
    },
    {
      value: 'COLISION',
      label: 'Colisión',
      icono: '💥',
      bloques: ['tercero', 'lesionados'],
      campos: [
        { key: 'condiciones_clima', label: 'Condiciones del clima', tipo: 'text', requerido: false },
      ],
    },
    {
      value: 'ROBO',
      label: 'Robo',
      icono: '🔒',
      bloques: [],
      campos: [{ key: 'lugar_amarra', label: 'Lugar de amarra', tipo: 'text', requerido: false }],
    },
    {
      value: 'INCENDIO',
      label: 'Incendio',
      icono: '🔥',
      bloques: [],
      campos: [
        { key: 'origen_probable', label: 'Origen probable del fuego', tipo: 'text', requerido: false },
      ],
    },
    {
      value: 'OTRO',
      label: 'Otro',
      icono: '📋',
      bloques: [],
      campos: [{ key: 'tipo_otro_descripcion', label: 'Especificá', tipo: 'text', requerido: true }],
    },
  ],

  // ─────────── RESPONSABILIDAD CIVIL ───────────
  responsabilidad_civil: [
    {
      value: 'RECLAMO_TERCERO',
      label: 'Reclamo de un tercero',
      icono: '⚖️',
      bloques: ['tercero', 'lesionados'],
      campos: [
        {
          key: 'reclamo_descripcion',
          label: 'Descripción del reclamo',
          tipo: 'textarea',
          requerido: true,
          placeholder: '¿Qué reclama el tercero? Contexto del hecho...',
        },
        {
          key: 'monto_reclamado',
          label: 'Monto reclamado',
          tipo: 'text',
          requerido: false,
          placeholder: 'Si el tercero especificó',
        },
      ],
    },
    {
      value: 'OTRO',
      label: 'Otro',
      icono: '📋',
      bloques: [],
      campos: [{ key: 'tipo_otro_descripcion', label: 'Especificá', tipo: 'text', requerido: true }],
    },
  ],

  // ─────────── INCENDIO (ramo específico) ───────────
  incendio: [
    {
      value: 'INCENDIO',
      label: 'Incendio',
      icono: '🔥',
      bloques: ['lesionados'],
      campos: [
        { key: 'sector_afectado', label: 'Sector afectado', tipo: 'text', requerido: true },
        { key: 'causa_probable', label: 'Causa probable', tipo: 'text', requerido: false },
        {
          key: 'hubo_bomberos',
          label: '¿Intervinieron bomberos?',
          tipo: 'select',
          requerido: false,
          opciones: ['No', 'Sí'],
        },
        {
          key: 'bomberos_actuacion',
          label: 'Nro. de actuación de bomberos',
          tipo: 'text',
          requerido: false,
        },
      ],
    },
    {
      value: 'OTRO',
      label: 'Otro',
      icono: '📋',
      bloques: [],
      campos: [{ key: 'tipo_otro_descripcion', label: 'Especificá', tipo: 'text', requerido: true }],
    },
  ],

  // ─────────── ROBO (ramo específico para objetos: bicicleta, celular, etc.) ───────────
  robo: [
    {
      value: 'ROBO',
      label: 'Robo',
      icono: '🔒',
      bloques: [],
      campos: [
        {
          key: 'fiscalia_comisaria',
          label: 'Fiscalía / comisaría interviniente',
          tipo: 'text',
          requerido: false,
        },
        {
          key: 'otros_bienes',
          label: 'Otros bienes robados en el mismo hecho',
          tipo: 'textarea',
          requerido: false,
        },
      ],
    },
    {
      value: 'OTRO',
      label: 'Otro',
      icono: '📋',
      bloques: [],
      campos: [{ key: 'tipo_otro_descripcion', label: 'Especificá', tipo: 'text', requerido: true }],
    },
  ],

  // ─────────── ART ───────────
  art: [
    {
      value: 'ACCIDENTE_TRABAJO',
      label: 'Accidente de trabajo',
      icono: '👷',
      bloques: [],
      campos: [
        { key: 'trabajador_nombre', label: 'Nombre y apellido del trabajador', tipo: 'text', requerido: true },
        { key: 'trabajador_dni', label: 'DNI del trabajador', tipo: 'text', requerido: true, ancho: 'mitad' },
        { key: 'trabajador_puesto', label: 'Puesto / actividad', tipo: 'text', requerido: false, ancho: 'mitad' },
        { key: 'diagnostico', label: 'Diagnóstico / lesión', tipo: 'textarea', requerido: false },
        { key: 'centro_medico', label: 'Centro médico que atendió', tipo: 'text', requerido: false },
      ],
    },
    {
      value: 'IN_ITINERE',
      label: 'Accidente in itinere',
      icono: '🚌',
      bloques: [],
      campos: [
        { key: 'trabajador_nombre', label: 'Nombre y apellido del trabajador', tipo: 'text', requerido: true },
        { key: 'trabajador_dni', label: 'DNI del trabajador', tipo: 'text', requerido: true, ancho: 'mitad' },
        { key: 'origen', label: 'Origen del trayecto', tipo: 'text', requerido: false, ancho: 'mitad' },
        { key: 'destino', label: 'Destino del trayecto', tipo: 'text', requerido: false, ancho: 'mitad' },
        { key: 'diagnostico', label: 'Diagnóstico / lesión', tipo: 'textarea', requerido: false },
        { key: 'centro_medico', label: 'Centro médico', tipo: 'text', requerido: false },
      ],
    },
    {
      value: 'ENFERMEDAD_PROFESIONAL',
      label: 'Enfermedad profesional',
      icono: '🏥',
      bloques: [],
      campos: [
        { key: 'trabajador_nombre', label: 'Nombre y apellido del trabajador', tipo: 'text', requerido: true },
        { key: 'trabajador_dni', label: 'DNI del trabajador', tipo: 'text', requerido: true, ancho: 'mitad' },
        { key: 'trabajador_puesto', label: 'Puesto / actividad', tipo: 'text', requerido: false, ancho: 'mitad' },
        { key: 'primera_manifestacion', label: 'Fecha de la primera manifestación', tipo: 'date', requerido: false },
        { key: 'diagnostico', label: 'Diagnóstico', tipo: 'textarea', requerido: true },
        { key: 'centro_medico', label: 'Centro médico', tipo: 'text', requerido: false },
      ],
    },
    {
      value: 'OTRO',
      label: 'Otro',
      icono: '📋',
      bloques: [],
      campos: [{ key: 'tipo_otro_descripcion', label: 'Especificá', tipo: 'text', requerido: true }],
    },
  ],

  // ─────────── AGROPECUARIO ───────────
  agropecuario: [
    {
      value: 'GRANIZO',
      label: 'Granizo',
      icono: '🌨️',
      bloques: [],
      campos: [
        { key: 'cultivo', label: 'Cultivo afectado', tipo: 'text', requerido: false },
        { key: 'lote_afectado', label: 'Lote / sector', tipo: 'text', requerido: false, ancho: 'mitad' },
        { key: 'hectareas_afectadas', label: 'Hectáreas afectadas', tipo: 'text', requerido: false, ancho: 'mitad' },
        { key: 'perdida_estimada', label: 'Pérdida estimada (%)', tipo: 'text', requerido: false },
      ],
    },
    {
      value: 'INUNDACION',
      label: 'Inundación',
      icono: '💧',
      bloques: [],
      campos: [
        { key: 'cultivo', label: 'Cultivo afectado', tipo: 'text', requerido: false },
        { key: 'lote_afectado', label: 'Lote / sector', tipo: 'text', requerido: false, ancho: 'mitad' },
        { key: 'hectareas_afectadas', label: 'Hectáreas afectadas', tipo: 'text', requerido: false, ancho: 'mitad' },
        { key: 'perdida_estimada', label: 'Pérdida estimada (%)', tipo: 'text', requerido: false },
      ],
    },
    {
      value: 'SEQUIA',
      label: 'Sequía',
      icono: '☀️',
      bloques: [],
      campos: [
        { key: 'cultivo', label: 'Cultivo afectado', tipo: 'text', requerido: false },
        { key: 'lote_afectado', label: 'Lote / sector', tipo: 'text', requerido: false, ancho: 'mitad' },
        { key: 'hectareas_afectadas', label: 'Hectáreas afectadas', tipo: 'text', requerido: false, ancho: 'mitad' },
        { key: 'perdida_estimada', label: 'Pérdida estimada (%)', tipo: 'text', requerido: false },
      ],
    },
    {
      value: 'HELADA',
      label: 'Helada',
      icono: '❄️',
      bloques: [],
      campos: [
        { key: 'cultivo', label: 'Cultivo afectado', tipo: 'text', requerido: false },
        { key: 'lote_afectado', label: 'Lote / sector', tipo: 'text', requerido: false, ancho: 'mitad' },
        { key: 'hectareas_afectadas', label: 'Hectáreas afectadas', tipo: 'text', requerido: false, ancho: 'mitad' },
        { key: 'perdida_estimada', label: 'Pérdida estimada (%)', tipo: 'text', requerido: false },
      ],
    },
    {
      value: 'INCENDIO',
      label: 'Incendio',
      icono: '🔥',
      bloques: [],
      campos: [
        { key: 'lote_afectado', label: 'Lote / sector', tipo: 'text', requerido: false, ancho: 'mitad' },
        { key: 'hectareas_afectadas', label: 'Hectáreas afectadas', tipo: 'text', requerido: false, ancho: 'mitad' },
        { key: 'causa_probable', label: 'Causa probable', tipo: 'text', requerido: false },
      ],
    },
    {
      value: 'ENFERMEDAD_ANIMAL',
      label: 'Enfermedad animal',
      icono: '🐄',
      bloques: [],
      campos: [
        { key: 'especie', label: 'Especie afectada', tipo: 'text', requerido: true },
        { key: 'cantidad_afectada', label: 'Cantidad de animales afectados', tipo: 'number', requerido: false },
        { key: 'tipo_enfermedad', label: 'Enfermedad / diagnóstico', tipo: 'text', requerido: false },
      ],
    },
    {
      value: 'OTRO',
      label: 'Otro',
      icono: '📋',
      bloques: [],
      campos: [{ key: 'tipo_otro_descripcion', label: 'Especificá', tipo: 'text', requerido: true }],
    },
  ],

  // ─────────── GENÉRICO (fallback) ───────────
  generico: [
    {
      value: 'OTRO',
      label: 'Siniestro',
      icono: '📋',
      bloques: [],
      campos: [
        {
          key: 'tipo_otro_descripcion',
          label: 'Tipo de siniestro',
          tipo: 'text',
          requerido: true,
          placeholder: 'Describí brevemente qué tipo de siniestro es',
        },
      ],
    },
  ],
}

// ────────────────────────────────────────────────────────────
// Aliases: normaliza tipos de riesgo del catálogo a las keys de la matriz.
// ────────────────────────────────────────────────────────────

/**
 * Mapea el `metadata.tipo_riesgo` del catálogo de ramos a la key que usa la
 * matriz. Necesario porque el catálogo tiene 11 tipos y algunos comparten
 * config (ej: moto y automotor comparten los mismos tipos de siniestro).
 */
const ALIAS_TIPO_RIESGO: Record<string, string> = {
  automotor: 'automotor',
  moto: 'automotor', // moto usa los mismos tipos que auto
  integrales: 'integrales',
  hogar: 'integrales', // alias legacy
  personas: 'personas',
  vida: 'personas', // alias legacy
  transporte: 'transporte',
  embarcacion: 'embarcacion',
  responsabilidad_civil: 'responsabilidad_civil',
  incendio: 'incendio',
  robo: 'robo',
  art: 'art',
  agropecuario: 'agropecuario',
  generico: 'generico',
}

// ────────────────────────────────────────────────────────────
// Helpers públicos
// ────────────────────────────────────────────────────────────

/**
 * Devuelve la lista de tipos de siniestro válidos para un tipo_riesgo del
 * catálogo. Si no encuentra, cae al genérico.
 */
export function tiposDeSiniestroPorRamo(tipoRiesgo: string | null | undefined): TipoSiniestroConfig[] {
  const key = ALIAS_TIPO_RIESGO[tipoRiesgo ?? 'generico'] ?? 'generico'
  return TIPOS_POR_TIPO_RIESGO[key] ?? TIPOS_POR_TIPO_RIESGO.generico
}

/**
 * Devuelve la config completa de un tipo específico dentro de un ramo.
 * Si no se encuentra, devuelve null.
 */
export function obtenerConfigTipoSiniestro(
  tipoRiesgo: string | null | undefined,
  tipoSiniestro: string | null | undefined,
): TipoSiniestroConfig | null {
  if (!tipoSiniestro) return null
  const lista = tiposDeSiniestroPorRamo(tipoRiesgo)
  return lista.find(t => t.value === tipoSiniestro) ?? null
}

/**
 * Devuelve los bloques + campos que deben renderearse para una combinación
 * (ramo, tipo). Lo que consumen los formularios.
 */
export function camposDeSiniestro(
  tipoRiesgo: string | null | undefined,
  tipoSiniestro: string | null | undefined,
): { bloques: BloqueId[]; campos: CampoEspecifico[] } {
  const config = obtenerConfigTipoSiniestro(tipoRiesgo, tipoSiniestro)
  if (!config) return { bloques: [], campos: [] }
  return { bloques: config.bloques, campos: config.campos }
}

/**
 * Normaliza el value de `tercero.categoria` (label legible) a un value corto
 * para persistir. Los forms guardan el label bruto porque así fue histórico;
 * este helper devuelve la key normalizada si un consumer la necesita.
 */
export function normalizarCategoriaTercero(labelOValue: string | null | undefined): string {
  if (!labelOValue) return 'otro'
  const match = CATEGORIAS_TERCERO.find(
    c => c.label === labelOValue || c.value === labelOValue,
  )
  return match?.value ?? 'otro'
}
