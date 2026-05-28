/**
 * GET /api/health
 *
 * Healthcheck robusto para que `aplicar-actualizacion.sh` verifique que el
 * CRM nuevo realmente arrancó bien — no solo que Next.js responda 200.
 *
 * Chequea:
 *   - DB accesible (query trivial a `configuracion`)
 *   - Filesystem accesible (escribir + leer + borrar archivo temporal)
 *
 * Devuelve 200 si todo OK, 503 si algo falló (para que el script reaccione).
 *
 * Público (no requiere auth) — necesario porque el script del host no tiene
 * tokens del CRM. No expone info sensible: solo flags ok/no-ok.
 */

import path from 'path'
import { promises as fs } from 'fs'
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import packageJson from '../../../../package.json'

export const dynamic = 'force-dynamic'

export async function GET() {
  const checks = {
    db: false,
    filesystem: false,
  }

  // Check DB
  try {
    const supabase = getSupabaseAdmin()
    const { error } = await supabase.from('configuracion').select('id').limit(1)
    checks.db = !error
  } catch {
    checks.db = false
  }

  // Check filesystem (escribir + leer + borrar en tmp/)
  try {
    const tmpFile = path.resolve(process.cwd(), 'tmp', `.health-${Date.now()}`)
    await fs.writeFile(tmpFile, 'ok', 'utf-8')
    const back = await fs.readFile(tmpFile, 'utf-8')
    await fs.unlink(tmpFile)
    checks.filesystem = back === 'ok'
  } catch {
    checks.filesystem = false
  }

  const ok = checks.db && checks.filesystem

  return NextResponse.json(
    {
      ok,
      version: packageJson.version,
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  )
}
