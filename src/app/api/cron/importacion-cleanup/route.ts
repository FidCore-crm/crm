import { NextResponse } from 'next/server'
import { validarCronSecret } from '@/lib/cron-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import * as fs from 'fs/promises'
import * as path from 'path'

export const dynamic = 'force-dynamic'

const STORAGE_ROOT = path.resolve(process.cwd(), 'storage', 'importaciones')
const DIAS_ARCHIVOS = 30
// Las filas técnicas (jobs, lotes, dudosos) las mantenemos un poco más
// que los archivos físicos para que el listado del historial siga
// mostrando los conteos sin tener que recalcularlos.
const DIAS_FILAS_TECNICAS = 60

export async function GET(request: Request) {
  const authError = await validarCronSecret(request)
  if (authError) return authError

  const supabase = getSupabaseAdmin()
  const corteArchivos = new Date(Date.now() - DIAS_ARCHIVOS * 24 * 60 * 60 * 1000).toISOString()
  const corteFilas = new Date(Date.now() - DIAS_FILAS_TECNICAS * 24 * 60 * 60 * 1000).toISOString()

  // 1. Limpiar archivos físicos de importaciones >30 días.
  const { data: rowsArchivos, error: errArchivos } = await supabase
    .from('importaciones')
    .select('id')
    .lt('fecha_inicio', corteArchivos)
    .not('archivos_metadata', 'is', null)

  if (errArchivos) {
    return NextResponse.json({ ok: false, error: 'Error al obtener importaciones para limpiar archivos' }, { status: 500 })
  }

  let archivosLimpiados = 0
  for (const row of (rowsArchivos ?? []) as { id: string }[]) {
    const carpeta = path.join(STORAGE_ROOT, row.id)
    try {
      await fs.rm(carpeta, { recursive: true, force: true })
    } catch {
      // ignoramos errores individuales (carpeta ya borrada, permisos, etc.)
    }
    await supabase
      .from('importaciones')
      .update({ archivos_metadata: null })
      .eq('id', row.id)
    archivosLimpiados++
  }

  // 2. Limpiar filas técnicas de importaciones >60 días: jobs, lotes,
  // registros dudosos. Sin esto, una instalación con uso normal acumula
  // miles de filas que ralentizan queries del listado y el detalle.
  const { data: rowsTecnicas, error: errTecnicas } = await supabase
    .from('importaciones')
    .select('id')
    .lt('fecha_inicio', corteFilas)

  if (errTecnicas) {
    return NextResponse.json({
      ok: false,
      error: 'Error al obtener importaciones para limpiar filas técnicas',
    }, { status: 500 })
  }

  const idsViejos = ((rowsTecnicas ?? []) as { id: string }[]).map((r) => r.id)
  let jobsBorrados = 0
  let lotesBorrados = 0
  let dudososBorrados = 0

  if (idsViejos.length > 0) {
    // Procesamos en chunks de 500 para evitar queries gigantes con .in().
    const CHUNK = 500
    for (let i = 0; i < idsViejos.length; i += CHUNK) {
      const chunk = idsViejos.slice(i, i + CHUNK)
      const [resJobs, resLotes, resDud] = await Promise.all([
        supabase.from('importacion_jobs').delete({ count: 'estimated' }).in('importacion_id', chunk),
        supabase.from('importacion_lotes').delete({ count: 'estimated' }).in('importacion_id', chunk),
        supabase.from('importacion_registros_dudosos').delete({ count: 'estimated' }).in('importacion_id', chunk),
      ])
      jobsBorrados += resJobs.count ?? 0
      lotesBorrados += resLotes.count ?? 0
      dudososBorrados += resDud.count ?? 0
    }
  }

  return NextResponse.json({
    ok: true,
    archivos_limpiados: archivosLimpiados,
    jobs_borrados: jobsBorrados,
    lotes_borrados: lotesBorrados,
    dudosos_borrados: dudososBorrados,
    importaciones_afectadas_filas_tecnicas: idsViejos.length,
  })
}
