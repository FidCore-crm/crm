import { NextRequest, NextResponse } from 'next/server'
import { unlink } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-auth'
import { logger } from '@/lib/errores'
import { checkLicenciaActiva } from '@/lib/licencia-guard'

const STORAGE_ROOT = path.join(process.cwd(), 'storage')

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof NextResponse) return auth
  const usuario = auth
  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo
  try {
    const { archivo_id, tabla } = await req.json()
    if (!archivo_id) {
      return NextResponse.json({ ok: false, error: 'Falta archivo_id' }, { status: 400 })
    }

    const tablaDB = tabla === 'siniestro_archivos' ? 'siniestro_archivos' : 'poliza_archivos'

    const supabase = getSupabaseAdmin()

    // Obtener el archivo con la FK necesaria para el ownership check
    const selectFields = tablaDB === 'siniestro_archivos' ? 'ruta, siniestro_id' : 'ruta, poliza_id'
    const { data, error } = await supabase
      .from(tablaDB)
      .select(selectFields)
      .eq('id', archivo_id)
      .single()

    if (error || !data) {
      return NextResponse.json({ ok: false, error: 'Archivo no encontrado' }, { status: 404 })
    }

    // ── Verificación de cartera ──────────────────────────────
    if ((usuario as any).acceso_cartera === 'PROPIA') {
      let personaUserId: string | null = null

      if (tablaDB === 'poliza_archivos' && (data as any).poliza_id) {
        const { data: poliza } = await supabase
          .from('polizas')
          .select('asegurado_id')
          .eq('id', (data as any).poliza_id)
          .maybeSingle()
        if (poliza) {
          const { data: persona } = await supabase
            .from('personas')
            .select('usuario_id')
            .eq('id', (poliza as any).asegurado_id)
            .maybeSingle()
          if (persona) personaUserId = (persona as any).usuario_id
        }
      } else if (tablaDB === 'siniestro_archivos' && (data as any).siniestro_id) {
        const { data: siniestro } = await supabase
          .from('siniestros')
          .select('persona_id')
          .eq('id', (data as any).siniestro_id)
          .maybeSingle()
        if (siniestro) {
          const { data: persona } = await supabase
            .from('personas')
            .select('usuario_id')
            .eq('id', (siniestro as any).persona_id)
            .maybeSingle()
          if (persona) personaUserId = (persona as any).usuario_id
        }
      }

      if (personaUserId && personaUserId !== (usuario as any).id) {
        return NextResponse.json({ ok: false, error: 'Archivo no encontrado' }, { status: 404 })
      }
    }

    // Eliminar archivo físico
    const absolutePath = path.join(STORAGE_ROOT, data.ruta)
    if (absolutePath.startsWith(STORAGE_ROOT) && existsSync(absolutePath)) {
      await unlink(absolutePath)
    }

    // Eliminar registro de DB
    const { error: delError } = await supabase
      .from(tablaDB)
      .delete()
      .eq('id', archivo_id)

    if (delError) {
      logger.error({ modulo: 'storage', mensaje: 'Error al eliminar registro de DB', contexto: { error: delError.message } })
      return NextResponse.json({ ok: false, error: 'Error al eliminar el archivo' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    logger.error({ modulo: 'storage', mensaje: 'Error inesperado en delete', contexto: { error: err.message } })
    return NextResponse.json({ ok: false, error: 'Error al eliminar el archivo' }, { status: 500 })
  }
}
