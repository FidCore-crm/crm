// ============================================================================
// Catálogo de campos soportados por el importador.
//
// Vive en un archivo separado sin imports de server-only (supabase admin,
// anthropic-client, etc.) para que el bundle del cliente pueda importarlo
// desde `/crm/importar/[id]/plan/page.tsx` sin arrastrar nodemailer.
// ============================================================================

import { TIPOS_RIESGO } from '@/lib/tipos-riesgo'

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
  'fecha_inicio',
  'fecha_fin',
  'moneda',
  'suma_asegurada',
  'estado',
  'observaciones',
] as const

/**
 * Campos estructurales del riesgo — los que NO van al JSONB `detalle_tecnico`
 * sino a columnas top-level de la tabla `riesgos`.
 */
export const CAMPOS_RIESGO_ESTRUCTURALES = [
  'tipo_riesgo',
  'descripcion_corta',
  'suma_asegurada',
] as const

/**
 * Campos del riesgo que la IA puede proponer al PAS para mapear columnas
 * del archivo. Combina los 12 campos históricos (automotor + hogar + vida,
 * mantienen retrocompat con importaciones viejas) con los `campos_poliza`
 * de todos los tipos de riesgo definidos en `tipos-riesgo.ts`. La generación
 * dinámica garantiza que agregar un tipo nuevo a la lib automáticamente lo
 * exponga al importador sin tocar este archivo.
 */
function generarCamposRiesgo(): string[] {
  const conjunto = new Set<string>([
    // Estructurales
    'tipo_riesgo',
    'descripcion_corta',
    // Históricos (mantienen compat con importaciones viejas + alias
    // legibles para el PAS aunque algunos no estén en TIPOS_RIESGO actuales)
    'patente', 'marca', 'modelo', 'anio', 'motor', 'chasis', 'color', 'uso',
    'direccion_riesgo',
    'tipo_construccion', 'superficie', 'capital_asegurado', 'beneficiarios',
  ])
  // Sumar campos_poliza de todos los tipos
  for (const t of TIPOS_RIESGO) {
    for (const c of t.campos_poliza) {
      conjunto.add(c.key)
    }
  }
  return Array.from(conjunto)
}

export const CAMPOS_RIESGO = generarCamposRiesgo()
