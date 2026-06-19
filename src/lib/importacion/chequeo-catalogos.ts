// ============================================================================
// Chequeo bloqueante de catálogos antes de procesar una importación.
//
// Relee los archivos del disco, aplica el mapeo del plan y extrae los valores
// únicos que apuntan a campos de catálogo (compañía, ramo, cobertura,
// refacturación, tipo de vigencia). Devuelve los valores que NO existen en el
// CRM para que el PAS los cree antes de importar.
//
// El comportamiento actual del CRM acepta estos valores como "dudosos" que el
// PAS resuelve en /revisar (crear nuevo, etc.). Este helper es más estricto:
// se usa antes de procesar para bloquear la importación hasta que los
// catálogos estén completos, evitando que queden campos en blanco por falta
// de match cuando diferentes compañías usan nombres distintos para lo mismo.
// ============================================================================

import * as fs from 'fs/promises'
import * as path from 'path'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { leerArchivo } from '@/lib/importacion/file-readers'
import {
  aplicarMapeoAFila,
  extraerColumnasDelMapeo,
} from '@/lib/importacion/procesamiento-lote'
import type {
  ArchivoMetadata,
  HojaVirtual,
  PlanImportacion,
} from '@/lib/importacion/types'

const STORAGE_BASE = path.join(process.cwd(), 'storage', 'importaciones')

export interface CatalogosFaltantes {
  companias: string[]
  ramos: string[]
  coberturas: string[]
  total: number
  // Hay al menos un archivo que no se pudo leer (permisos, borrado, etc.)
  hubo_error_lectura: boolean
}

function normalizar(s: unknown): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

interface CatalogoMin {
  nombre: string
  equivalencias: string[]
}

function matchea(valor: string, catalogo: CatalogoMin[]): boolean {
  const n = normalizar(valor)
  if (!n) return true
  for (const c of catalogo) {
    if (normalizar(c.nombre) === n) return true
    if (c.equivalencias.some((e) => normalizar(e) === n)) return true
  }
  return false
}

async function cargarCatalogos(): Promise<{
  companias: CatalogoMin[]
  ramos: CatalogoMin[]
  coberturas: CatalogoMin[]
}> {
  const supa = getSupabaseAdmin()
  const { data: tipos } = await supa.from('tipo_catalogo').select('id, codigo')
  const idPorCodigo: Record<string, number> = {}
  for (const t of (tipos ?? []) as Array<{ id: number; codigo: string }>) {
    idPorCodigo[t.codigo] = t.id
  }

  const tiposPedidos = ['COMPANIA', 'RAMO', 'COBERTURA']
  const idsFiltro = tiposPedidos.map((c) => idPorCodigo[c]).filter(Boolean) as number[]

  const { data: catRows } = await supa
    .from('catalogos')
    .select('tipo_id, nombre, metadata')
    .in('tipo_id', idsFiltro.length > 0 ? idsFiltro : [-1])
    .eq('activo', true)

  type CatRow = { tipo_id: number; nombre: string; metadata: Record<string, unknown> | null }

  const vacio: CatalogoMin[] = []
  const result: Record<string, CatalogoMin[]> = {
    COMPANIA: [], RAMO: [], COBERTURA: [],
  }

  for (const row of ((catRows ?? []) as CatRow[])) {
    const codigoTipo = Object.keys(idPorCodigo).find((k) => idPorCodigo[k] === row.tipo_id)
    if (!codigoTipo || !(codigoTipo in result)) continue
    const meta = row.metadata ?? {}
    let eqs: string[] = []
    const raw = (meta as Record<string, unknown>).equivalencias
    if (Array.isArray(raw)) {
      eqs = raw.map((x) => String(x))
    } else if (raw && typeof raw === 'object') {
      eqs = Object.values(raw as Record<string, unknown>).map((x) => String(x))
    }
    result[codigoTipo].push({ nombre: row.nombre, equivalencias: eqs })
  }

  return {
    companias: result.COMPANIA ?? vacio,
    ramos: result.RAMO ?? vacio,
    coberturas: result.COBERTURA ?? vacio,
  }
}

export async function chequearCatalogosFaltantes(
  importacion_id: string,
): Promise<CatalogosFaltantes> {
  const supa = getSupabaseAdmin()
  const { data: imp } = await supa
    .from('importaciones')
    .select('plan_importacion, archivos_metadata')
    .eq('id', importacion_id)
    .maybeSingle()

  const faltantes: CatalogosFaltantes = {
    companias: [],
    ramos: [],
    coberturas: [],
    total: 0,
    hubo_error_lectura: false,
  }

  if (!imp) return faltantes

  type ImpRow = {
    plan_importacion: PlanImportacion | null
    archivos_metadata: ArchivoMetadata[] | null
  }
  const impRow = imp as ImpRow
  const plan = impRow.plan_importacion ?? ({} as PlanImportacion)
  const archivosMeta: ArchivoMetadata[] = Array.isArray(impRow.archivos_metadata)
    ? impRow.archivos_metadata
    : []

  const catalogos = await cargarCatalogos()

  // Sets de valores únicos por campo (preservando la primera forma vista para
  // mostrarle al PAS el texto real del archivo, no el normalizado).
  const vistos = {
    compania: new Map<string, string>(),
    ramo: new Map<string, string>(),
    cobertura: new Map<string, string>(),
  }

  // Cuando un xlsx multi-solapa se expande en hojas virtuales, los nombres
  // con los que está mapeado el plan son los virtuales ("archivo :: Hoja"), y
  // para leer del disco hay que resolver a archivo físico + hoja_preferida.
  // En el caso clásico sin expansión, el nombre virtual coincide con el
  // archivo físico y no hay hoja preferida.
  const hojasVirtuales: HojaVirtual[] = Array.isArray(plan.hojas_virtuales)
    ? plan.hojas_virtuales
    : []
  const archivosAnalizados = Array.isArray(plan.archivos_analizados)
    ? plan.archivos_analizados
    : []
  const nombresVirtuales: string[] =
    archivosAnalizados.length > 0
      ? archivosAnalizados.map((a) => a.nombre).filter((n): n is string => !!n)
      : archivosMeta
          .map((m) => m.nombre || m.nombre_archivo || m.filename || '')
          .filter((n) => !!n)

  for (const nombreVirtual of nombresVirtuales) {
    const hv = hojasVirtuales.find((h) => h.nombre_virtual === nombreVirtual)
    const nombreFisico = hv?.nombre_archivo ?? nombreVirtual
    const hojaPreferida = hv?.hoja_origen
    const meta = archivosMeta.find(
      (m) => (m.nombre || m.nombre_archivo || m.filename) === nombreFisico,
    )
    const mime = hv?.mime_type || meta?.mime_type || 'application/octet-stream'

    try {
      const rutaAbs = path.join(STORAGE_BASE, importacion_id, nombreFisico)
      const buffer = await fs.readFile(rutaAbs)
      const lectura = await leerArchivo(buffer, mime, nombreFisico, {
        hoja_preferida: hojaPreferida,
      })
      const columnas = extraerColumnasDelMapeo(plan, nombreVirtual, lectura.headers_detectados)

      for (const fila of lectura.filas) {
        const ent = aplicarMapeoAFila(fila, columnas)
        const pol = ent.poliza
        if (!pol) continue
        for (const campo of ['compania', 'ramo', 'cobertura'] as const) {
          const valor = (pol as Record<string, unknown>)[campo]
          if (valor == null || valor === '') continue
          const texto = String(valor).trim()
          const clave = normalizar(texto)
          if (!clave) continue
          const mapa = vistos[campo]
          if (!mapa.has(clave)) mapa.set(clave, texto)
        }
      }
    } catch {
      faltantes.hubo_error_lectura = true
      // seguir con los demás archivos
    }
  }

  vistos.compania.forEach((texto, clave) => {
    if (!matchea(clave, catalogos.companias)) faltantes.companias.push(texto)
  })
  vistos.ramo.forEach((texto, clave) => {
    if (!matchea(clave, catalogos.ramos)) faltantes.ramos.push(texto)
  })
  vistos.cobertura.forEach((texto, clave) => {
    if (!matchea(clave, catalogos.coberturas)) faltantes.coberturas.push(texto)
  })

  faltantes.companias.sort((a, b) => a.localeCompare(b, 'es'))
  faltantes.ramos.sort((a, b) => a.localeCompare(b, 'es'))
  faltantes.coberturas.sort((a, b) => a.localeCompare(b, 'es'))

  faltantes.total =
    faltantes.companias.length +
    faltantes.ramos.length +
    faltantes.coberturas.length

  return faltantes
}
