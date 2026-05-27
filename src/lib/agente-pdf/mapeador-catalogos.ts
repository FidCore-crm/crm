// ============================================================
// Mapea los textos crudos extraídos por la IA a IDs reales del
// catálogo del CRM (compañía, ramo, cobertura, refacturación,
// vigencia). No hace llamadas a la IA — búsqueda determinística.
// ============================================================

import { getSupabaseAdmin } from '@/lib/supabase/server'
import type { DatosExtraidosPoliza, MapeosCatalogos, InfoCoberturaBloqueante } from './types'

function norm(s: string | null | undefined): string {
  return (s || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

interface FilaCatalogo {
  id: string
  nombre: string
  metadata: any
  tipo_id: number
}

async function cargarTiposCatalogo(): Promise<Record<string, number>> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase.from('tipo_catalogo').select('id, codigo')
  const res: Record<string, number> = {}
  for (const t of (data || []) as any[]) res[t.codigo] = t.id
  return res
}

async function cargarCatalogo(tipoId: number): Promise<FilaCatalogo[]> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('catalogos')
    .select('id, nombre, metadata, tipo_id')
    .eq('tipo_id', tipoId)
    .eq('activo', true)
  return (data || []) as FilaCatalogo[]
}

function buscarPorNombreOEquivalencia(
  filas: FilaCatalogo[],
  texto: string | null | undefined
): FilaCatalogo | null {
  if (!texto) return null
  const t = norm(texto)
  if (!t) return null

  // 1. Match exacto por nombre. Si hay más de uno (ramos homónimos con
  // casing distinto), preferimos el primero alfabéticamente para que el
  // mapeo sea reproducible entre corridas.
  const exactos = filas.filter(f => norm(f.nombre) === t)
  if (exactos.length > 0) {
    exactos.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    return exactos[0]
  }

  // 2. Match parcial por nombre — ordenado determinísticamente. Preferimos el
  // match cuyo largo normalizado esté más cerca del largo de `t`: eso
  // tiende a elegir el catálogo más "específico" (p.ej. t="auto" con
  // ["Auto", "Automotor", "Autopartes"] → Auto), y en empate de cercanía
  // ordenamos alfabéticamente.
  const parciales = filas.filter(f => {
    const n = norm(f.nombre)
    return n.includes(t) || t.includes(n)
  })
  if (parciales.length > 0) {
    parciales.sort((a, b) => {
      const diffA = Math.abs(norm(a.nombre).length - t.length)
      const diffB = Math.abs(norm(b.nombre).length - t.length)
      if (diffA !== diffB) return diffA - diffB
      return a.nombre.localeCompare(b.nombre, 'es')
    })
    return parciales[0]
  }

  // 3. Buscar en metadata.equivalencias (array o map). Orden determinístico:
  // iteramos las filas ordenadas alfabéticamente por nombre.
  const filasOrdenadas = [...filas].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, 'es'),
  )
  for (const f of filasOrdenadas) {
    const eqs = (f.metadata as any)?.equivalencias
    if (!eqs) continue
    if (Array.isArray(eqs)) {
      for (const eq of eqs) {
        const nc = norm(eq?.nombre_comercial || eq?.nombre || eq?.texto)
        if (nc && (nc === t || nc.includes(t) || t.includes(nc))) return f
      }
    } else if (typeof eqs === 'object') {
      for (const v of Object.values(eqs as Record<string, any>)) {
        const nc = norm(typeof v === 'string' ? v : v?.nombre_comercial || v?.nombre)
        if (nc && (nc === t || nc.includes(t) || t.includes(nc))) return f
      }
    }
  }

  return null
}

export async function mapearCatalogos(
  datos: DatosExtraidosPoliza
): Promise<MapeosCatalogos> {
  const tipos = await cargarTiposCatalogo()

  const [companias, ramos, coberturas, refacturaciones, vigencias] = await Promise.all([
    tipos.COMPANIA ? cargarCatalogo(tipos.COMPANIA) : Promise.resolve([]),
    tipos.RAMO ? cargarCatalogo(tipos.RAMO) : Promise.resolve([]),
    tipos.COBERTURA ? cargarCatalogo(tipos.COBERTURA) : Promise.resolve([]),
    tipos.REFACTURACION ? cargarCatalogo(tipos.REFACTURACION) : Promise.resolve([]),
    tipos.VIGENCIA ? cargarCatalogo(tipos.VIGENCIA) : Promise.resolve([]),
  ])

  const compania = buscarPorNombreOEquivalencia(companias, datos.catalogos_pdf?.compania_texto)
  const ramo = buscarPorNombreOEquivalencia(ramos, datos.catalogos_pdf?.ramo_texto)

  // Coberturas: filtrar por ramo si se encontró
  let coberturasFiltradas = coberturas
  if (ramo) {
    coberturasFiltradas = coberturas.filter(c => {
      const ramoIds = (c.metadata as any)?.ramo_ids
      if (Array.isArray(ramoIds) && ramoIds.length > 0) {
        return ramoIds.includes(ramo.id)
      }
      return true
    })
  }

  // Coberturas: match estricto por equivalencia contra la compañía identificada,
  // o por nombre dentro del mismo ramo. Si nada matchea → REQUIERE_CONFIGURACION.
  const textoCobertura = datos.catalogos_pdf?.cobertura_texto || null
  let coberturaMatch: FilaCatalogo | null = null

  if (textoCobertura) {
    // 1. Match por equivalencia explícita para la compañía
    if (compania) {
      const t = norm(textoCobertura)
      for (const c of coberturasFiltradas) {
        const eqs = (c.metadata as any)?.equivalencias
        if (!eqs) continue
        // Array: [{ compania_id, nombre_comercial }]
        if (Array.isArray(eqs)) {
          const match = eqs.find((eq: any) =>
            eq?.compania_id === compania.id && norm(eq?.nombre_comercial || eq?.nombre) === t
          )
          if (match) { coberturaMatch = c; break }
        } else if (typeof eqs === 'object') {
          // Map: { [compania_id]: "nombre comercial" }
          const v = (eqs as Record<string, any>)[compania.id]
          if (v && norm(typeof v === 'string' ? v : v?.nombre_comercial || v?.nombre) === t) {
            coberturaMatch = c
            break
          }
        }
      }
    }
    // 2. Fallback: match por nombre exacto dentro del ramo
    if (!coberturaMatch) {
      coberturaMatch = buscarPorNombreOEquivalencia(coberturasFiltradas, textoCobertura)
    }
  }

  let coberturaEstado: 'MAPEADA' | 'REQUIERE_CONFIGURACION' = 'MAPEADA'
  let coberturaInfoConfig: InfoCoberturaBloqueante | null = null
  if (!coberturaMatch && textoCobertura) {
    coberturaEstado = 'REQUIERE_CONFIGURACION'
    const companiaNombre = compania?.nombre || datos.catalogos_pdf?.compania_texto || 'la compañía'
    const ramoNombre = ramo?.nombre || datos.catalogos_pdf?.ramo_texto || 'el ramo'
    coberturaInfoConfig = {
      texto_pdf: textoCobertura,
      compania_id: compania?.id || null,
      compania_nombre: companiaNombre,
      ramo_id: ramo?.id || null,
      ramo_nombre: ramoNombre,
      sugerencia_accion: `La cobertura "${textoCobertura}" de ${companiaNombre} no está configurada en tu catálogo. Antes de continuar, necesitás configurarla en Catálogos > Coberturas (agregá la equivalencia para esta compañía dentro del ramo ${ramoNombre}).`,
    }
  }

  const refacturacion = buscarPorNombreOEquivalencia(
    refacturaciones,
    datos.catalogos_pdf?.refacturacion_texto
  )
  const vigencia = buscarPorNombreOEquivalencia(
    vigencias,
    datos.catalogos_pdf?.vigencia_tipo_texto
  )

  return {
    compania_id: compania?.id || null,
    compania_propuesta: compania ? null : datos.catalogos_pdf?.compania_texto || null,
    ramo_id: ramo?.id || null,
    ramo_propuesto: ramo ? null : datos.catalogos_pdf?.ramo_texto || null,
    cobertura_id: coberturaMatch?.id || null,
    cobertura_propuesta: coberturaMatch ? null : textoCobertura,
    cobertura_estado: coberturaEstado,
    cobertura_info_config: coberturaInfoConfig,
    refacturacion_id: refacturacion?.id || null,
    vigencia_tipo_id: vigencia?.id || null,
  }
}
