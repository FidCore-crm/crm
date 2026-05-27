// ============================================================================
// Catálogo de campos soportados por el importador.
//
// Vive en un archivo separado sin imports de server-only (supabase admin,
// anthropic-client, etc.) para que el bundle del cliente pueda importarlo
// desde `/crm/importar/[id]/plan/page.tsx` sin arrastrar nodemailer.
// ============================================================================

// NOTA: `cuil_formateado` NO está en esta lista intencionalmente — es una
// GENERATED COLUMN en la DB que Postgres calcula sola desde `dni_cuil`.
// Incluirla permitiría que la IA sugiera mapearla y generaría un error
// "cannot insert a non-DEFAULT value" al hacer el INSERT.
export const CAMPOS_PERSONA = [
  'apellido',
  'nombre',
  'razon_social',
  'tipo_persona',
  'dni_cuil',
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

export const CAMPOS_POLIZA = [
  'numero_poliza',
  'numero_certificado',
  'numero_endoso',
  'compania',
  'ramo',
  'cobertura',
  'refacturacion',
  'vigencia_tipo',
  'fecha_inicio',
  'fecha_fin',
  'moneda',
  'suma_asegurada',
  'estado',
  'observaciones',
] as const

export const CAMPOS_RIESGO = [
  'tipo_riesgo',
  'descripcion_corta',
  'patente',
  'marca',
  'modelo',
  'anio',
  'motor',
  'chasis',
  'color',
  'uso',
  'direccion_riesgo',
  'tipo_construccion',
  'superficie',
  'capital_asegurado',
  'beneficiarios',
] as const
