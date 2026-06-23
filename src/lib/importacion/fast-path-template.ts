/**
 * Fast-path para archivos que matchean exactamente el modelo .xls que el CRM
 * genera desde `/api/importar/modelo-excel`. Cuando los headers coinciden,
 * NO llamamos a Claude — el mapeo es 1:1 trivial y la IA no aporta nada.
 *
 * Beneficios:
 *   - Tiempo: ~70s (Sonnet) → < 1s.
 *   - Costo: $0.05-0.10 por importación → $0.
 *   - Determinismo: el mapeo es siempre el mismo, no depende de cómo la IA
 *     interprete los headers.
 *
 * Solo aplica si TODOS los archivos subidos matchean exactamente el template.
 * Si hay aunque sea un archivo con headers raros, cae al flujo IA tradicional
 * para no degradar la calidad del mapeo.
 *
 * El plan generado por este fast-path es indistinguible del que devuelve la IA
 * — usa el mismo shape (`PlanImportacion`). Las siguientes etapas (procesarLote,
 * importacionFinal) no se enteran de la diferencia.
 */

import type {
  ArchivoAnalizado,
  CalidadEstimada,
  ColumnaAnalizada,
  MapeoColumnas,
  PlanImportacion,
  TipoContenidoArchivo,
  VinculacionEntreArchivos,
} from '@/lib/importacion/types'
import type { ArchivoImportacion } from '@/lib/importacion/analisis-estructural'

// ----------------------------------------------------------------------------
// Headers de las 2 hojas del template (espejo de `/api/importar/modelo-excel`).
// ----------------------------------------------------------------------------
//
// REGLA: si tocás los headers del template, sincronizá esta constante.
// Tener una verdad duplicada es feo pero evitamos un import circular con
// el route file (que es server-only) y mantener esto en sync es manual y
// raro de cambiar.

const HEADERS_CLIENTES = [
  'tipo_persona',
  'dni_cuil',
  'apellido',
  'nombre',
  'razon_social',
  'email',
  'email_secundario',
  'telefono',
  'telefono_secundario',
  'whatsapp',
  'calle',
  'numero',
  'piso_depto',
  'barrio',
  'localidad',
  'provincia',
  'codigo_postal',
  'pais',
  'estado',
  'origen',
  'segmento',
] as const

const HEADERS_POLIZAS = [
  'dni_cuil',
  'numero_poliza',
  'numero_certificado',
  'numero_endoso',
  'compania',
  'ramo',
  'cobertura',
  'refacturacion',
  'fecha_inicio',
  'fecha_fin',
  'moneda',
  'suma_asegurada',
  'estado',
  'observaciones',
  'patente',
  'marca',
  'modelo',
  'anio',
  'color',
  'uso',
  'calle_riesgo',
  'localidad_riesgo',
  'superficie',
  'capital_asegurado',
] as const

// Mapeo header → campo_crm para CLIENTES.
const MAPEO_CLIENTES: Record<string, string> = Object.fromEntries(
  HEADERS_CLIENTES.map((h) => [h, `persona.${h}`]),
)

// Mapeo header → campo_crm para PÓLIZAS. Los campos del bien asegurado
// (patente/marca/modelo/etc.) caen a `riesgo.*`; el resto a `poliza.*` o
// `persona.dni_cuil` (la columna de vinculación).
const MAPEO_POLIZAS: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  const CAMPOS_RIESGO_EN_POLIZAS = new Set([
    'patente', 'marca', 'modelo', 'anio', 'color', 'uso',
    'calle_riesgo', 'localidad_riesgo', 'superficie', 'capital_asegurado',
  ])
  for (const h of HEADERS_POLIZAS) {
    if (h === 'dni_cuil') {
      m[h] = 'persona.dni_cuil'
    } else if (CAMPOS_RIESGO_EN_POLIZAS.has(h)) {
      // calle_riesgo y localidad_riesgo se mapean a direccion_riesgo lógicamente
      // pero el procesador los guarda en detalle_tecnico tal cual, así que dejamos
      // el nombre original.
      m[h] = `riesgo.${h}`
    } else {
      m[h] = `poliza.${h}`
    }
  }
  return m
})()

// ----------------------------------------------------------------------------
// Detección
// ----------------------------------------------------------------------------

function normalizarHeader(h: string): string {
  return String(h ?? '').trim().toLowerCase().replace(/\s+/g, '_')
}

/**
 * True si el set de headers del archivo es exactamente el del template.
 * Tolerante a:
 *   - Diferencias de case ("DNI_CUIL" vs "dni_cuil").
 *   - Headers en otro orden.
 *   - Whitespace trailing.
 * NO tolera:
 *   - Headers faltantes o de más (sería un Excel diferente).
 *   - Headers con typos (sería un Excel diferente).
 */
function headersCoincidenExactamente(
  archivoHeaders: string[],
  templateHeaders: readonly string[],
): boolean {
  if (archivoHeaders.length !== templateHeaders.length) return false
  const setArchivo = new Set(archivoHeaders.map(normalizarHeader))
  for (const h of templateHeaders) {
    if (!setArchivo.has(h)) return false
  }
  return true
}

/**
 * Identifica el tipo de hoja del template (CLIENTES o POLIZAS) por matching
 * exacto de headers. Devuelve null si no es ninguna.
 */
function identificarHojaTemplate(
  headers: string[],
): 'CLIENTES' | 'POLIZAS' | null {
  if (headersCoincidenExactamente(headers, HEADERS_CLIENTES)) return 'CLIENTES'
  if (headersCoincidenExactamente(headers, HEADERS_POLIZAS)) return 'POLIZAS'
  return null
}

// ----------------------------------------------------------------------------
// Construcción del plan
// ----------------------------------------------------------------------------

function construirArchivoAnalizado(
  archivo: ArchivoImportacion,
  tipoHoja: 'CLIENTES' | 'POLIZAS',
): ArchivoAnalizado {
  const mapeo = tipoHoja === 'CLIENTES' ? MAPEO_CLIENTES : MAPEO_POLIZAS

  const columnas: ColumnaAnalizada[] = archivo.headers_detectados.map(
    (header, indice) => ({
      indice,
      header,
      campo_crm: mapeo[normalizarHeader(header)] ?? 'ignorar',
      confianza: 1.0,
      nota: 'Matcheado por template del CRM (sin IA)',
    }),
  )

  // Detección de compañías/ramos desde los valores de las columnas
  // correspondientes (solo aplica a la hoja Pólizas).
  const companiasSet = new Set<string>()
  const ramosSet = new Set<string>()
  if (tipoHoja === 'POLIZAS') {
    const idxCompania = archivo.headers_detectados.findIndex(
      (h) => normalizarHeader(h) === 'compania',
    )
    const idxRamo = archivo.headers_detectados.findIndex(
      (h) => normalizarHeader(h) === 'ramo',
    )
    for (const fila of archivo.filas) {
      if (idxCompania >= 0) {
        const v = fila[idxCompania]
        if (v) companiasSet.add(String(v).trim())
      }
      if (idxRamo >= 0) {
        const v = fila[idxRamo]
        if (v) ramosSet.add(String(v).trim())
      }
    }
  }

  return {
    nombre: archivo.nombre,
    tipo_contenido: tipoHoja as TipoContenidoArchivo,
    columnas,
    compania_detectada: null, // múltiples en mismo archivo
    ramos_detectados: Array.from(ramosSet),
    advertencias: [],
  }
}

function detectarVinculacion(
  archivosAnalizados: ArchivoAnalizado[],
): VinculacionEntreArchivos | null {
  // Necesitamos una hoja CLIENTES y una hoja POLIZAS para vincular por DNI.
  const clientes = archivosAnalizados.find((a) => a.tipo_contenido === 'CLIENTES')
  const polizas = archivosAnalizados.find((a) => a.tipo_contenido === 'POLIZAS')
  if (!clientes || !polizas) return null

  return {
    tipo: 'DNI',
    archivo_maestro: clientes.nombre,
    archivo_hijo: polizas.nombre,
    campo_vinculacion_maestro: 'dni_cuil',
    campo_vinculacion_hijo: 'dni_cuil',
    confianza: 1.0,
  }
}

// ----------------------------------------------------------------------------
// API pública
// ----------------------------------------------------------------------------

export interface ResultadoFastPath {
  aplica: boolean
  plan?: PlanImportacion
  razon_descarte?: string
}

/**
 * Intenta construir el `PlanImportacion` sin llamar a la IA.
 * Devuelve `{ aplica: false, razon_descarte }` si los archivos no encajan
 * con el template; en ese caso el caller debe usar el flujo IA tradicional.
 */
export function intentarFastPathTemplate(
  archivos: ArchivoImportacion[],
): ResultadoFastPath {
  if (archivos.length === 0) {
    return { aplica: false, razon_descarte: 'Sin archivos' }
  }

  const archivosAnalizados: ArchivoAnalizado[] = []
  let totalRegistros = 0

  for (const archivo of archivos) {
    const tipo = identificarHojaTemplate(archivo.headers_detectados)
    if (!tipo) {
      return {
        aplica: false,
        razon_descarte: `Archivo "${archivo.nombre}" no matchea el template del CRM`,
      }
    }
    archivosAnalizados.push(construirArchivoAnalizado(archivo, tipo))
    totalRegistros += archivo.filas.length
  }

  const mapeoPorArchivo: Record<string, ArchivoAnalizado> = {}
  for (const a of archivosAnalizados) {
    mapeoPorArchivo[a.nombre] = a
  }
  const mapeo_propuesto: MapeoColumnas = { por_archivo: mapeoPorArchivo }

  const companiasDetectadas = new Set<string>()
  for (const a of archivosAnalizados) {
    for (const r of a.ramos_detectados) companiasDetectadas.add(r)
  }

  const plan: PlanImportacion = {
    archivos_analizados: archivosAnalizados,
    vinculacion_detectada: detectarVinculacion(archivosAnalizados),
    mapeo_propuesto,
    campos_a_ignorar: [],
    total_registros_estimado: totalRegistros,
    calidad_estimada: 'EXCELENTE' as CalidadEstimada,
    advertencias: [
      'Mapeo automático sin IA (archivo matchea el modelo del CRM).',
    ],
    companias_detectadas: Array.from(companiasDetectadas),
    tipo_importacion_sugerida: 'INICIAL',
    tokens_usados: 0,
    costo_usd: 0,
  }

  return { aplica: true, plan }
}
