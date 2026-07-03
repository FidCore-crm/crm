// ============================================================
// Tipos del módulo IA — parser de PDFs de pólizas/endosos
// ============================================================

export type TipoOperacionPDF = 'POLIZA_NUEVA' | 'RENOVACION' | 'ENDOSO'

export type EstadoProcesamientoPDF =
  | 'PENDIENTE'
  | 'PROCESANDO'
  | 'EXTRAIDO'
  | 'APROBADO'
  | 'CANCELADO'
  | 'FALLIDO'

// ────────────────────────────────────────────────────────────
// Datos extraídos
// ────────────────────────────────────────────────────────────

export interface DomicilioExtraido {
  calle?: string | null
  numero?: string | null
  localidad?: string | null
  provincia?: string | null
  codigo_postal?: string | null
}

export interface PersonaExtraida {
  nombre_completo?: string | null
  apellido?: string | null
  nombre?: string | null
  razon_social?: string | null
  tipo_persona: 'FISICA' | 'JURIDICA'
  dni_cuil: string | null
  email?: string | null
  telefono?: string | null
  domicilio?: DomicilioExtraido | null
}

export interface DatosExtraidosPoliza {
  asegurado: PersonaExtraida
  tomador?: PersonaExtraida | null

  poliza: {
    numero_poliza: string | null
    numero_endoso?: string | null
    fecha_inicio: string | null
    fecha_fin: string | null
    moneda?: 'ARS' | 'USD' | null
    suma_asegurada?: number | null
  }

  // Textos crudos del PDF antes del mapeo a catálogos del CRM
  catalogos_pdf: {
    compania_texto: string | null
    ramo_texto: string | null
    cobertura_texto: string | null
    refacturacion_texto?: string | null
    medio_pago_texto?: string | null
  }

  riesgo: {
    tipo_riesgo: string // "automotor" / "hogar" / "vida" / "generico" / ...
    descripcion_corta?: string | null
    detalle_tecnico: Record<string, any>
    suma_asegurada?: number | null
  }

  advertencias_ia?: string[]
}

export interface DatosExtraidosEndoso {
  numero_endoso?: string | null
  fecha_endoso?: string | null
  motivo: string
  observaciones?: string | null
  cambios_detectados?: string[]
  advertencias_ia?: string[]
}

// ────────────────────────────────────────────────────────────
// Mapeo contra catálogos del CRM
// ────────────────────────────────────────────────────────────

export type EstadoCobertura = 'MAPEADA' | 'SUGERIDO_CREAR'

/**
 * Info que acompaña al estado `SUGERIDO_CREAR`: el PDF trajo un texto de
 * cobertura que no matchea ninguno del catálogo. En vez de bloquear, el modal
 * ofrece crear la cobertura al vuelo con equivalencia auto-sembrada para la
 * compañía identificada.
 *
 * Nombre viejo `InfoCoberturaBloqueante` reexportado como alias para no romper
 * el resto del código que ya lo importa.
 */
export interface InfoCoberturaSugerida {
  texto_pdf: string
  compania_id: string | null
  compania_nombre: string | null
  ramo_id: string | null
  ramo_nombre: string | null
  sugerencia_accion: string
}

export type InfoCoberturaBloqueante = InfoCoberturaSugerida

export interface MapeosCatalogos {
  compania_id: string | null
  compania_propuesta?: string | null
  ramo_id: string | null
  ramo_propuesto?: string | null
  cobertura_id: string | null
  cobertura_propuesta?: string | null
  cobertura_estado?: EstadoCobertura
  cobertura_info_config?: InfoCoberturaSugerida | null
  refacturacion?: string | null // Valor normalizado del enum REFACTURACIONES (no es FK)
  medio_pago?: string | null // Valor normalizado del enum MEDIOS_PAGO (no es FK)
}

// ────────────────────────────────────────────────────────────
// Campos dudosos — requieren decisión del PAS
// ────────────────────────────────────────────────────────────

export type TipoProblemaPDF =
  | 'DNI_INVALIDO'
  | 'DNI_FALTANTE'
  | 'EMAIL_INVALIDO'
  | 'FECHA_INVALIDA'
  | 'MONTO_INVALIDO'
  | 'COMPANIA_NO_RECONOCIDA'
  | 'RAMO_NO_RECONOCIDO'
  | 'COBERTURA_NO_RECONOCIDA'
  | 'RIESGO_INCOMPLETO'
  | 'DATOS_FALTANTES'
  | 'ASEGURADO_DIFERENTE_A_ORIGEN'
  | 'NUMERO_POLIZA_DUPLICADO'
  | 'INCONSISTENCIA_LOGICA'
  | 'OTROS'

export interface CampoDudoso {
  campo: string
  tipo_problema: TipoProblemaPDF
  valor_extraido: string | null
  motivo: string
  sugerencia?: string | null
  opciones?: Array<{ id: string; label: string }>
  bloqueante?: boolean
}
