/**
 * Helper para armar el catálogo de coberturas de una compañía específica,
 * que se inyecta al prompt del comparador de renovaciones para que la IA
 * resuelva códigos comerciales de la compañía a nombres canónicos del CRM
 * sin inventar equivalencias.
 *
 * La fuente de verdad es la tabla `catalogos` (tipo COBERTURA) con la key
 * `metadata.equivalencias`, que ya usa el mapeador de PDFs y el import.
 */

import type { EquivalenciaCoberturaCompania } from './extractor'

interface EquivalenciaMetadata {
  compania_id: string
  nombre_comercial: string
}

/**
 * Devuelve el nombre de la compañía y las equivalencias `código_compañía → cobertura canónica`
 * disponibles en el catálogo del CRM para la compañía dada. Si la compañía no existe o no tiene
 * coberturas configuradas, devuelve `equivalencias: []` (el comparador va a razonar sin catálogo).
 */
export async function obtenerCatalogoCoberturasCompania(
  supabase: any,
  companiaId: string | null | undefined,
): Promise<{ companiaNombre: string | null; equivalencias: EquivalenciaCoberturaCompania[] }> {
  if (!companiaId) return { companiaNombre: null, equivalencias: [] }

  const [{ data: comp }, { data: cobs }] = await Promise.all([
    supabase.from('catalogos').select('nombre').eq('id', companiaId).maybeSingle(),
    supabase
      .from('catalogos')
      .select('nombre, metadata, tipo:tipo_catalogo!inner(codigo)')
      .eq('tipo.codigo', 'COBERTURA')
      .eq('activo', true),
  ])

  const companiaNombre = (comp as { nombre?: string } | null)?.nombre ?? null

  const equivalencias: EquivalenciaCoberturaCompania[] = []
  for (const c of (cobs as Array<{ nombre: string; metadata: any }> | null) ?? []) {
    const eqs: EquivalenciaMetadata[] = Array.isArray(c.metadata?.equivalencias)
      ? c.metadata.equivalencias
      : []
    for (const e of eqs) {
      if (e.compania_id === companiaId && e.nombre_comercial) {
        equivalencias.push({
          codigo_compania: e.nombre_comercial,
          nombre_canonico: c.nombre,
        })
      }
    }
  }

  // Ordeno por código para que el prompt sea determinístico entre corridas
  // (mismo output del catálogo → mismo cache-friendliness del proveedor).
  equivalencias.sort((a, b) => a.codigo_compania.localeCompare(b.codigo_compania))

  return { companiaNombre, equivalencias }
}
