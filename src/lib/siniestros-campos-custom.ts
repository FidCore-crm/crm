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
 * Resuelve el label de una key sola — convención para el render de "Detalle del
 * ramo" en la ficha. Cae al fallback formateado si la key no está en el catálogo.
 */
export function labelDeCampo(
  key: string,
  mapa: Record<string, string>
): string {
  if (mapa[key]) return mapa[key]
  // Fallback: convertir "lugar_hecho" → "Lugar hecho"
  const txt = key.replace(/_/g, ' ').trim()
  if (!txt) return key
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
