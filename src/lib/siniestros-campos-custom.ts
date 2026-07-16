/**
 * Helpers para los campos custom de siniestros que el PAS configura por ramo.
 *
 * Cada ramo tiene en su metadata un array `campos_siniestro` con la forma:
 *   { key, label, tipo: 'text'|'textarea'|'select'|'date', requerido, placeholder?, opciones? }
 *
 * Esos campos:
 * - aparecen en el form de alta del CRM (/crm/siniestros/nuevo)
 * - aparecen en el formulario público de denuncia (/denuncia)
 * - aparecen en la ficha del siniestro (/crm/siniestros/[id])
 *
 * Hasta v1.0.18 la ficha del CRM mostraba las keys "feas" del JSONB
 * (`lugar_hecho` → "lugar hecho"). Este helper centraliza la extracción
 * de la lista de campos y permite mapear `key → label` para mostrar
 * siempre el texto que el PAS definió.
 */

import type { CampoSiniestro } from './tipos-riesgo'

export type { CampoSiniestro }

interface RamoMetadataLike {
  campos_siniestro?: unknown
  [k: string]: unknown
}

/**
 * Extrae la lista de campos custom desde el metadata de un ramo. Tolera
 * cualquier estructura inesperada — si no hay `campos_siniestro` o no es
 * un array, devuelve `[]`.
 */
export function extraerCamposCustom(
  metadata: RamoMetadataLike | null | undefined
): CampoSiniestro[] {
  if (!metadata) return []
  const raw = metadata.campos_siniestro
  if (!Array.isArray(raw)) return []
  return raw
    .filter((c): c is CampoSiniestro => {
      if (!c || typeof c !== 'object') return false
      const obj = c as Record<string, unknown>
      return typeof obj.key === 'string' && typeof obj.label === 'string'
    })
    .map((c) => ({
      key: c.key,
      label: c.label,
      tipo: (c.tipo ?? 'text') as CampoSiniestro['tipo'],
      requerido: Boolean(c.requerido),
      placeholder: c.placeholder,
      opciones: c.opciones,
    }))
}

/**
 * Devuelve un mapa `key → label` para resolver el label legible de cualquier
 * clave guardada en `detalle_siniestro`. Si una key no está en el catálogo
 * (porque el PAS la sacó después de cargar el siniestro), devuelve la key
 * formateada como fallback ("lugar_hecho" → "Lugar hecho").
 */
export function mapaLabelsPorKey(campos: CampoSiniestro[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const c of campos) map[c.key] = c.label
  return map
}

/**
 * Diccionario de labels humanos para las keys estándar que emite el formulario
 * público de denuncia (matriz `siniestros-catalogo.ts` y bloques
 * `CAMPOS_POR_BLOQUE`). Se aplica ANTES del fallback snake_case → title case.
 *
 * Motivo: keys como `hubo_tercero`, `vehiculo_estacionado`, `otra_persona_conduce`
 * salían del fallback como "Hubo tercero", "Vehiculo estacionado", "Otra persona
 * conduce" — texto pobre y sin signo de pregunta. Este diccionario garantiza
 * labels legibles y contextuales para el PAS.
 */
const LABELS_ESTANDAR: Record<string, string> = {
  // Automotor — bloques generales
  vehiculo_estacionado:    '¿El vehículo estaba estacionado?',
  otra_persona_conduce:    '¿Conducía otra persona?',
  conductor:               'Datos del conductor',
  hubo_tercero:            '¿Hubo un tercero involucrado?',
  tercero_fuga:            '¿El tercero se dio a la fuga?',
  tercero:                 'Datos del tercero',
  hubo_testigos:           '¿Hubo testigos?',
  testigos:                'Testigos',
  hubo_lesionados:         '¿Hubo lesionados?',
  detalle_lesiones:        'Detalle de las lesiones',
  danos_propios:           'Daños al vehículo propio',

  // Automotor — robo/rueda
  objetos_robados:         'Objetos robados',
  como_ingresaron:         '¿Cómo ingresaron al vehículo?',
  rueda_robada:            'Rueda(s) robada(s)',
  marca_ruedas:            'Marca de las ruedas',
  medida_ruedas:           'Medida de las ruedas',
  tipo_llanta:             'Tipo de llanta',

  // Automotor — otros tipos
  lugar_hecho_granizo:     'Lugar donde estaba el vehículo',

  // Hogar / Integrales
  tipo_vivienda:           'Tipo de vivienda',
  que_paso:                '¿Qué pasó?',
  ambiente_afectado:       'Ambiente afectado',
  causa_siniestro:         'Causa del siniestro',

  // Denuncia policial (común a varios tipos)
  denuncia_policial:       '¿Hay denuncia policial?',
  numero_denuncia_policial: 'Número de denuncia policial',
  acta_policial:           'Número de acta policial',

  // Meta
  tipo_riesgo:             'Tipo de bien',
}

/**
 * Diccionario de labels humanos para SUB-keys de objetos anidados
 * (conductor, tercero, testigos). Aplica cuando el renderValor recursivo
 * de la ficha imprime las entries de un objeto.
 */
export const LABELS_SUB_KEYS: Record<string, string> = {
  // Persona (aplica a conductor + tercero + testigos)
  nombre:              'Nombre',
  apellido:            'Apellido',
  dni:                 'DNI',
  telefono:            'Teléfono',
  email:               'Email',
  direccion:           'Dirección',
  edad:                'Edad',
  // Tercero
  patente:             'Patente',
  marca:               'Marca',
  modelo:              'Modelo',
  anio:                'Año',
  color:               'Color',
  compania:            'Compañía',
  numero_poliza:       'Número de póliza',
  categoria:           'Tipo de tercero',
  danos:               'Daños',
  observaciones:       'Observaciones',
  // Conductor
  relacion_asegurado:  'Relación con el asegurado',
  licencia:            'N° de licencia',
  vencimiento_licencia: 'Vencimiento de licencia',
}

/**
 * Resuelve el label de una key sola — convención para el render de "Detalles
 * del siniestro" en la ficha. Prioridad:
 *   1. Catálogo custom del ramo (lo que el PAS configuró).
 *   2. Diccionario estándar del form público (`LABELS_ESTANDAR`).
 *   3. Fallback: snake_case → title case.
 */
export function labelDeCampo(
  key: string,
  mapa: Record<string, string>
): string {
  if (mapa[key]) return mapa[key]
  if (LABELS_ESTANDAR[key]) return LABELS_ESTANDAR[key]
  // Fallback: convertir "lugar_hecho" → "Lugar hecho"
  const txt = key.replace(/_/g, ' ').trim()
  if (!txt) return key
  return txt.charAt(0).toUpperCase() + txt.slice(1)
}

/**
 * Resuelve el label de una sub-key (dentro de un objeto anidado como
 * conductor o tercero). Fallback al snake_case → title case.
 */
export function labelDeSubKey(key: string): string {
  if (LABELS_SUB_KEYS[key]) return LABELS_SUB_KEYS[key]
  const txt = key.replace(/_/g, ' ').trim()
  if (!txt) return key
  return txt.charAt(0).toUpperCase() + txt.slice(1)
}

/**
 * Diccionario de valores enum comunes que salen en snake_case desde el
 * formulario público de denuncia. Ejemplo: `categoria: 'auto_particular'`
 * → "Auto particular". Se aplica solo a strings que matcheen exactamente
 * un valor conocido; el resto pasa por el fallback (snake_case → título).
 */
const VALORES_LEGIBLES: Record<string, string> = {
  // Categorías de tercero
  auto_particular:        'Auto particular',
  moto:                   'Moto',
  camion:                 'Camión',
  utilitario:             'Utilitario',
  transporte_publico:     'Transporte público',
  taxi_remis:             'Taxi / Remis',
  peaton:                 'Peatón',
  ciclista:               'Ciclista',
  otro:                   'Otro',
  // Relación con el asegurado
  asegurado:              'El asegurado mismo',
  familiar:               'Familiar',
  amigo:                  'Amigo',
  empleado:               'Empleado',
  desconocido:            'Desconocido',
  // Tipo de llanta
  chapa:                  'Chapa',
  aleacion:               'Aleación',
  // Modo de ingreso
  rotura_vidrio:          'Rotura de vidrio',
  forzado_puerta:         'Puerta forzada',
  llave_maestra:          'Llave maestra',
  sin_rastros:            'Sin rastros de fuerza',
  // Ubicación del vehículo
  via_publica:            'Vía pública',
  cochera_particular:     'Cochera particular',
  garage_pago:            'Garage pago',
  otro_lugar:             'Otro lugar',
  // Tipo de vivienda
  casa:                   'Casa',
  departamento:           'Departamento',
  ph:                     'PH',
  local_comercial:        'Local comercial',
  oficina:                'Oficina',
}

/**
 * Devuelve un string legible para un valor que probablemente venga en
 * snake_case desde un enum del formulario. Si no matchea el diccionario,
 * fallback a snake_case → primera letra en mayúscula.
 */
export function valorLegible(valor: string): string {
  if (VALORES_LEGIBLES[valor]) return VALORES_LEGIBLES[valor]
  // Si no tiene underscore ni es "todo minúsculas de una palabra",
  // asumimos que ya viene bien (ej: "Toyota Etios") y no lo tocamos.
  if (!valor.includes('_')) return valor
  const txt = valor.replace(/_/g, ' ').trim()
  if (!txt) return valor
  return txt.charAt(0).toUpperCase() + txt.slice(1)
}

/**
 * Parsea el string "Opción A,Opción B,Opción C" del catálogo en un array.
 */
export function parsearOpciones(opciones?: string): string[] {
  if (!opciones) return []
  return opciones
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}
