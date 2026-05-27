import { NextResponse } from 'next/server'
import { validarCronSecret } from '@/lib/cron-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import * as fs from 'fs/promises'
import * as path from 'path'

export const dynamic = 'force-dynamic'

const STORAGE_ROOT = path.resolve(process.cwd(), 'storage', 'importaciones')
const DIAS = 30

export async function GET(request: Request) {
  const authError = await validarCronSecret(request)
  if (authError) return authError

  const supabase = getSupabaseAdmin()
  const corte = new Date(Date.now() - DIAS * 24 * 60 * 60 * 1000).toISOString()

  const { data: rows, error } = await supabase
    .from('importaciones')
    .select('id')
    .lt('fecha_inicio', corte)
    .not('archivos_metadata', 'is', null)

  if (error) {
    return NextResponse.json({ ok: false, error: 'Error al obtener los datos' }, { status: 500 })
  }

  let limpiadas = 0
  for (const row of (rows ?? []) as any[]) {
    const carpeta = path.join(STORAGE_ROOT, row.id)
    try {
      await fs.rm(carpeta, { recursive: true, force: true })
    } catch {
      // ignoramos errores individuales
    }
    await supabase
      .from('importaciones')
      .update({ archivos_metadata: null })
      .eq('id', row.id)
    limpiadas++
  }

  return NextResponse.json({ ok: true, limpiadas })
}
