/**
 * Purga definitiva de un siniestro del sistema.
 *
 * Borra físicamente el siniestro y toda su cascada (bitácora, archivos en
 * disco). Es el paso final del soft-delete: primero `DELETE
 * /api/siniestros/[id]` marca `deleted_at`, y después de 30 días el cron
 * `/api/cron/siniestros-purgar` invoca esta función.
 *
 * No verifica permisos — asume que el caller (cron o flujo administrativo)
 * ya hizo esas validaciones.
 */

import { rm } from 'fs/promises'
import path from 'path'
import { ERRORES, ErrorAplicacion, logger } from '@/lib/errores'

const STORAGE_ROOT = path.join(process.cwd(), 'storage')

function safePath(base: string, ...segments: string[]): string {
  const full = path.join(base, ...segments)
  // base + sep evita que /foo/storage matchee como prefijo de /foo/storage2/
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error('Path traversal detected')
  }
  return full
}

export async function purgarSiniestroDefinitivamente(
  siniestroId: string,
  supabase: any,
): Promise<{ numero_caso: string | null; carpeta_eliminada: boolean }> {
  const { data: siniestro } = await supabase
    .from('siniestros')
    .select('id, numero_caso')
    .eq('id', siniestroId)
    .single()

  if (!siniestro) {
    return { numero_caso: null, carpeta_eliminada: false }
  }

  const numCaso = (siniestro as any).numero_caso as string | null
  let carpetaEliminada = false

  // 1. Borrar carpeta física del siniestro (no crítico si falla).
  if (numCaso) {
    try {
      await rm(safePath(STORAGE_ROOT, 'siniestros', numCaso), { recursive: true, force: true })
      carpetaEliminada = true
    } catch (err) {
      logger.warn({
        modulo: 'siniestros-purga',
        mensaje: 'Error eliminando carpeta de siniestro',
        contexto: { numero_caso: numCaso, error: String(err) },
      })
    }
  }

  // 2. Borrar notificaciones vinculadas.
  await supabase
    .from('notificaciones')
    .delete()
    .eq('entidad_tipo', 'siniestro')
    .eq('entidad_id', siniestroId)

  // 3. Borrar siniestro (CASCADE elimina bitácora y archivos en DB).
  const { error: delError } = await supabase
    .from('siniestros')
    .delete()
    .eq('id', siniestroId)

  if (delError) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
      detalle: delError.message,
      contexto: { tabla: 'siniestros', operacion: 'delete', id: siniestroId },
    })
  }

  return { numero_caso: numCaso, carpeta_eliminada: carpetaEliminada }
}
