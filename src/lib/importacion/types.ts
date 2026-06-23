/**
 * Tipos centrales compartidos por todo el módulo de importación.
 * Tanto backend (lib, API routes) como frontend (pages del wizard) deben importar
 * desde acá en vez de re-declarar tipos locales.
 */

// ============================================================================
// Primitivas
// ============================================================================

/** Una celda del archivo original (Excel/CSV). Puede venir como string, número, Date, null, etc. */
export type CeldaValor = string | number | boolean | Date | null | undefined;

/** Una fila del archivo original: arreglo posicional por columna. */
export type FilaOriginal = CeldaValor[];

/** Objeto JSONB genérico (metadata, payloads, etc.). Usar cuando sea realmente dinámico. */
export type JSONObject = Record<string, unknown>;

// ============================================================================
// Enums / literal unions
// ============================================================================

export type TipoEntidad = 'PERSONA' | 'POLIZA' | 'RIESGO';

export type TipoProblema =
  | 'DNI_INVALIDO'
  | 'DNI_FALTANTE'
  | 'EMAIL_INVALIDO'
  | 'FECHA_INVALIDA'
  | 'MONTO_INVALIDO'
  | 'DUPLICADO_EN_CRM'
  | 'DUPLICADO_EN_ARCHIVO'
  | 'DATOS_FALTANTES'
  | 'COMPANIA_NO_RECONOCIDA'
  | 'INCONSISTENCIA_LOGICA'
  | 'RAMO_NO_RECONOCIDO'
  | 'COBERTURA_NO_RECONOCIDA'
  | 'REFACTURACION_NO_RECONOCIDA'
  | 'VIGENCIA_NO_RECONOCIDA'
  | 'RIESGO_INCOMPLETO'
  | 'OTROS';

export type AccionResolucion =
  | 'ACEPTAR_PROPUESTA'
  | 'EDITAR'
  | 'IGNORAR_REGISTRO'
  | 'ACTUALIZAR_EXISTENTE'
  | 'CREAR_NUEVO';

export type EstadoResolucion = 'PENDIENTE' | 'RESUELTO' | 'IGNORADO';

export type TipoImportacion = 'INICIAL' | 'INCREMENTAL';

export type EstadoProcesoImportacion =
  | 'PENDIENTE'
  | 'ANALIZANDO'
  | 'ANALIZADO'
  | 'IMPORTANDO'
  | 'REVISANDO'
  | 'COMPLETADA'
  | 'FALLIDA'
  | 'CANCELADA'
  | 'PAUSADA';

export type EstadoLote = 'PENDIENTE' | 'PROCESANDO' | 'COMPLETADO' | 'FALLIDO';

export type EstadoJob =
  | 'PENDIENTE'
  | 'EJECUTANDO'
  | 'COMPLETADO'
  | 'FALLIDO'
  | 'REINTENTANDO'
  | 'CANCELADO';

export type TipoJob =
  | 'ANALISIS_ESTRUCTURAL'
  | 'PROCESAMIENTO_LOTE'
  | 'VALIDACION_LOGICA'
  | 'IMPORTACION_FINAL';

export type CalidadEstimada = 'EXCELENTE' | 'BUENA' | 'REGULAR' | 'BAJA';

export type TipoContenidoArchivo =
  | 'CLIENTES'
  | 'POLIZAS'
  | 'MIXTO'
  | 'RIESGOS'
  | 'DESCONOCIDO';

/** Acción precalculada por registro en importaciones INCREMENTAL. */
export type AccionPersonaIncremental = 'CREAR' | 'ACTUALIZAR' | 'SIN_CAMBIOS';
export type AccionPolizaIncremental =
  | 'CREAR'
  | 'ACTUALIZAR'
  | 'SIN_CAMBIOS'
  | 'RENOVACION_DETECTADA';

// ============================================================================
// Entidades tal como se extraen del archivo (pre-persistencia)
// ============================================================================

/** Campos de persona detectables por el importador. */
export interface PersonaImportada {
  tipo_persona?: string | null;
  dni_cuil?: string | null;
  cuil_formateado?: string | null;
  apellido?: string | null;
  nombre?: string | null;
  razon_social?: string | null;
  email?: string | null;
  email_secundario?: string | null;
  telefono?: string | null;
  telefono_secundario?: string | null;
  whatsapp?: string | null;
  calle?: string | null;
  numero?: string | null;
  piso_depto?: string | null;
  barrio?: string | null;
  localidad?: string | null;
  provincia?: string | null;
  codigo_postal?: string | null;
  pais?: string | null;
  estado?: string | null;
  origen?: string | null;
  segmento?: string | null;
  canal_preferido?: string | null;
  /** Cualquier columna personalizada que no encaje en los campos anteriores. */
  [campoExtra: string]: unknown;
}

/** Campos de póliza detectables por el importador. */
export interface PolizaImportada {
  numero_poliza?: string | null;
  numero_certificado?: string | null;
  numero_endoso?: string | null;
  /** Nombre literal de la compañía tal como vino del archivo. */
  compania?: string | null;
  compania_nombre?: string | null;
  /** Catálogo resuelto tras matching. */
  compania_id?: string | null;
  ramo?: string | null;
  ramo_nombre?: string | null;
  ramo_id?: string | null;
  cobertura?: string | null;
  cobertura_id?: string | null;
  refacturacion?: string | null;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  moneda?: string | null;
  suma_asegurada?: number | string | null;
  estado?: string | null;
  observaciones?: string | null;
  notas?: string | null;
  [campoExtra: string]: unknown;
}

/** Campos de riesgo detectables por el importador. */
export interface RiesgoImportado {
  tipo_riesgo?: string | null;
  descripcion_corta?: string | null;
  suma_asegurada?: number | string | null;
  patente?: string | null;
  marca?: string | null;
  modelo?: string | null;
  anio?: string | number | null;
  motor?: string | null;
  chasis?: string | null;
  color?: string | null;
  uso?: string | null;
  direccion_riesgo?: string | null;
  tipo_construccion?: string | null;
  superficie?: string | number | null;
  capital_asegurado?: string | number | null;
  beneficiarios?: string | null;
  [campoExtra: string]: unknown;
}

export interface EntidadesRegistro {
  persona: PersonaImportada | null;
  poliza: PolizaImportada | null;
  riesgo: RiesgoImportado | null;
}

// ============================================================================
// Problemas detectados y registros procesados
// ============================================================================

export interface ProblemaRegistro {
  tipo_entidad: TipoEntidad;
  tipo_problema: TipoProblema;
  descripcion: string;
  campo?: string;
  valor_original?: unknown;
  valor_propuesto?: unknown;
  sugerencia_ia?: string;
}

/** Comparación de un campo incremental: valor previo vs nuevo. */
export interface CambioCampo {
  antes: unknown;
  despues: unknown;
}

export interface RegistroProcesado {
  numero_fila_archivo: number;
  archivo_origen: string;
  entidades: EntidadesRegistro;
  match_existente?: {
    persona_id?: string;
    poliza_id?: string;
  };
  clasificacion: 'LISTO' | 'DUDOSO';
  problemas: ProblemaRegistro[];
  /** Sólo se llena en importaciones INCREMENTAL. */
  acciones?: {
    persona?: AccionPersonaIncremental;
    poliza?: AccionPolizaIncremental;
    cambios_persona?: Record<string, CambioCampo>;
    cambios_poliza?: Record<string, CambioCampo>;
  };
}

// ============================================================================
// Contexto del CRM para matching
// ============================================================================

export interface CompaniaCtx {
  id: string;
  nombre: string;
  codigo: string;
  equivalencias?: string[];
}

export interface RamoCtx {
  id: string;
  nombre: string;
  codigo: string;
  tipo_riesgo: string;
}

export interface CoberturaCtx {
  id: string;
  nombre: string;
  codigo: string;
  /** Ramos a los que aplica esta cobertura (metadata.ramo_ids del catálogo). */
  ramo_ids: string[];
  /** Nombres comerciales alternativos por compañía (metadata.equivalencias). */
  equivalencias: string[];
}

export interface CatalogoSimpleCtx {
  id: string;
  nombre: string;
  codigo: string;
}

export interface ContextoCRM {
  companias: CompaniaCtx[];
  ramos: RamoCtx[];
  coberturas: CoberturaCtx[];
}

// ============================================================================
// Plan de importación (persistido en importaciones.plan_importacion)
// ============================================================================

export interface ColumnaAnalizada {
  indice: number;
  header: string;
  /** `persona.dni_cuil`, `poliza.numero_poliza`, `riesgo.patente`, `ignorar` o null. */
  campo_crm: string | null;
  confianza?: number;
  nota?: string;
  /** Reservados para modales separar/combinar. */
  accion?: 'SEPARAR' | 'COMBINAR' | null;
  separador?: string;
  campos_destino?: string[];
  columnas_fuente?: number[];
  formato?: string;
}

export interface ArchivoAnalizado {
  nombre: string;
  tipo_contenido: TipoContenidoArchivo;
  columnas: ColumnaAnalizada[];
  compania_detectada: string | null;
  ramos_detectados: string[];
  advertencias: string[];
}

export interface VinculacionEntreArchivos {
  tipo: 'DNI' | 'NUMERO_POLIZA' | 'NINGUNA';
  archivo_maestro: string;
  archivo_hijo: string;
  campo_vinculacion_maestro: string;
  campo_vinculacion_hijo: string;
  confianza: number;
}

export interface MapeoColumnas {
  por_archivo: Record<string, ArchivoAnalizado>;
}

/** Plan de aplicación de una importación INCREMENTAL. */
export interface AplicacionIncremental {
  plan: 'AUTOMATICO' | 'REVISAR_SOSPECHOSOS' | 'SOLO_NUEVOS';
  polizas_no_encontradas: 'NO_TOCAR' | 'MARCAR_BAJAS';
}

/**
 * Controla cuán agresivamente la IA interviene durante el procesamiento de lotes.
 * - NORMAL (default): la IA solo se dispara cuando una heurística conservadora
 *   detecta una celda "compleja" (ej: apellido con varios tokens y nombre vacío).
 * - AGRESIVO (opt-in del PAS): baja umbrales y manda a la IA también celdas que
 *   fallaron validación técnica (fechas, montos, teléfonos) o combinaciones
 *   sospechosas aunque ambos campos tengan contenido. Gasta más tokens pero
 *   limpia archivos desordenados sin que el PAS tenga que preparar el Excel.
 */
export type ModoLimpiezaIA = 'NORMAL' | 'AGRESIVO';

export interface PlanImportacion {
  archivos_analizados: ArchivoAnalizado[];
  vinculacion_detectada: VinculacionEntreArchivos | null;
  mapeo_propuesto: MapeoColumnas;
  campos_a_ignorar: string[];
  total_registros_estimado: number;
  calidad_estimada: CalidadEstimada;
  advertencias: string[];
  // string[] = formato histórico (compat con planes generados antes de v1.0.33).
  // Array<{nombre,existe}> = formato del fast-path desde v1.0.33, marca cuáles
  // están en el catálogo del PAS. La UI debe normalizar ambos shapes.
  companias_detectadas: string[] | Array<{ nombre: string; existe: boolean }>;
  tipo_importacion_sugerida: TipoImportacion;
  tokens_usados: number;
  costo_usd: number;
  /** Solo en incremental: plan de aplicación guardado tras /aplicar-comparacion. */
  aplicacion_incremental?: AplicacionIncremental;
  /** Opt-in del PAS para que la IA intervenga más durante el procesamiento. */
  modo_limpieza_ia?: ModoLimpiezaIA;
  /**
   * Cuando un .xlsx con múltiples solapas-de-datos se expande en varios
   * "archivos virtuales" para que cada solapa se analice y se procese por
   * separado. Los ids virtuales (`nombre_virtual`) son los que aparecen en
   * `lotes.registros_originales.archivo_origen` y en el mapeo propuesto.
   */
  hojas_virtuales?: HojaVirtual[];
}

export interface HojaVirtual {
  nombre_virtual: string;
  nombre_archivo: string;
  hoja_origen: string;
  mime_type: string;
}

// ============================================================================
// Estadísticas acumuladas (importaciones.estadisticas)
// ============================================================================

export interface EstadisticasImportacion {
  total_registros_estimado?: number;
  calidad_estimada?: CalidadEstimada;
  tokens_analisis?: number;
  tokens_procesamiento?: number;
  costo_analisis_usd?: number;
  costo_procesamiento_usd?: number;
  companias_detectadas?: string[];
  catalogos_creados?: {
    companias: string[];
    ramos: string[];
    coberturas?: string[];
  };
  clientes_actualizados?: number;
  polizas_actualizadas?: number;
  [extra: string]: unknown;
}

// ============================================================================
// Metadata de archivos subidos
// ============================================================================

export interface ArchivoMetadata {
  nombre: string;
  nombre_archivo?: string;
  filename?: string;
  mime_type: string;
  mime?: string;
  size_bytes: number;
  /** Variantes históricas vistas en metadata previa. */
  tamano?: number;
  size?: number;
  /** Cantidad de filas del archivo (puede estar en metadata si ya se leyó). */
  filas?: number;
  hash: string;
  ruta_storage?: string;
}

// ============================================================================
// Dudosos
// ============================================================================

export interface DatosOriginalesDudoso {
  entidades?: Partial<EntidadesRegistro>;
  campo?: string | string[] | null;
  valor_original?: unknown;
  match_existente?: { persona_id?: string; poliza_id?: string } | null;
  [extra: string]: unknown;
}

export interface DudosoRow {
  id: string;
  importacion_id: string;
  lote_id?: string | null;
  archivo_origen?: string | null;
  numero_fila_archivo: number;
  tipo_entidad: TipoEntidad;
  tipo_problema: TipoProblema;
  descripcion_problema: string;
  datos_originales: DatosOriginalesDudoso;
  datos_propuestos?: JSONObject | null;
  sugerencia_ia?: string | null;
  estado_resolucion: EstadoResolucion;
  resolucion_accion?: AccionResolucion | null;
  resolucion_datos?: JSONObject | null;
  resuelto_por_usuario_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

// ============================================================================
// Jobs
// ============================================================================

export interface JobPayloadAnalisis {
  // vacío, toda la info se lee de `importaciones`
  [extra: string]: unknown;
}

export interface JobPayloadProcesamientoLote {
  lote_id: string;
  archivo_origen?: string;
  compania_id_default?: string;
  [extra: string]: unknown;
}

export interface JobPayloadImportacionFinal {
  [extra: string]: unknown;
}

export type JobPayload =
  | JobPayloadAnalisis
  | JobPayloadProcesamientoLote
  | JobPayloadImportacionFinal
  | JSONObject;

export interface JobRow {
  id: string;
  importacion_id: string;
  tipo: TipoJob;
  estado: EstadoJob;
  prioridad: number;
  intentos: number;
  max_intentos: number;
  payload: JobPayload;
  resultado?: JSONObject | null;
  error?: string | null;
  worker_id?: string | null;
  fecha_creacion: string;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
}

// ============================================================================
// Importaciones (fila)
// ============================================================================

export interface IdsCreadosActualizados {
  personas: string[];
  polizas: string[];
  riesgos: string[];
}

export interface ImportacionRow {
  id: string;
  usuario_id: string;
  compania_id?: string | null;
  tipo?: TipoImportacion;
  estado_proceso: EstadoProcesoImportacion;
  plan_importacion?: PlanImportacion | null;
  estadisticas?: EstadisticasImportacion | null;
  archivos_metadata: ArchivoMetadata[];
  ids_creados?: IdsCreadosActualizados | null;
  ids_actualizados?: IdsCreadosActualizados | null;
  total_filas?: number | null;
  clientes_creados?: number | null;
  clientes_existentes?: number | null;
  polizas_creadas?: number | null;
  errores?: number | null;
  detalle_errores?: Array<{ fila: number; archivo?: string; error: string; mensaje?: string }> | null;
  estado?: string | null;
  notas?: string | null;
  deshecha?: boolean | null;
  fecha_deshecha?: string | null;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  created_at?: string;
}

// ============================================================================
// Resultado de comparación incremental
// ============================================================================

export interface MuestraComparacion {
  archivo_origen: string;
  numero_fila_archivo: number;
  dni?: string;
  nombre?: string;
  numero_poliza?: string;
  cambios?: Record<string, CambioCampo>;
  [extra: string]: unknown;
}

export interface ResultadoComparacion {
  personas: {
    crear: number;
    actualizar: number;
    sin_cambios: number;
    muestra_crear?: MuestraComparacion[];
    muestra_actualizar?: MuestraComparacion[];
  };
  polizas: {
    crear: number;
    actualizar: number;
    sin_cambios: number;
    renovaciones: number;
    no_encontradas: number;
    muestra_crear?: MuestraComparacion[];
    muestra_actualizar?: MuestraComparacion[];
    muestra_renovaciones?: MuestraComparacion[];
    muestra_no_encontradas?: MuestraComparacion[];
  };
  total_registros: number;
  generado_at: string;
}

// ============================================================================
// Respuesta de Supabase tipada mínimamente para los queries del módulo
// ============================================================================

/** Fila mínima de `tipo_catalogo` usada en el módulo. */
export interface TipoCatalogoRow {
  id: number;
  codigo: string;
}

/** Fila mínima de `catalogos` usada en el módulo. */
export interface CatalogoRow {
  id: string;
  nombre: string;
  codigo?: string;
  metadata?: JSONObject | null;
}
