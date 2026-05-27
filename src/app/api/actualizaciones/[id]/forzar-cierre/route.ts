/**
 * POST /api/actualizaciones/[id]/forzar-cierre
 *
 * Marca una actualización en estado EJECUTANDO como FALLIDA manualmente.
 * Sirve para desbloquear filas stuck cuando el script del host crasheó
 * sin limpiar (escenario raro pero posible: OOM, kill -9, panic kernel).
 *
 * Defensas:
 *   - Solo admite filas en estado EJECUTANDO o PROGRAMADA.
 *   - Borra el trigger file si existe (para que el cron del host no
 *     re-dispare un script abortado).
 *   - Borra el progress.json si existe (limpieza visual).
 *
 * Admin-only.
 */

import path from 'path'
import { promises as fs } from 'fs'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import {
  respuestaError,
  respuestaExito,
  manejarErrores,
  ERRORES,
} from '@/lib/errores'

export const dynamic = 'force-dynamic'

export const POST = manejarErrores(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)
  if (usuario.rol !== 'ADMIN') return respuestaError(ERRORES.PERM_SIN_PERMISO)

  const { id } = await params
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    return respuestaError(ERRORES.VALID_FORMATO_INVALIDO, { campos: { id: 'UUID inválido' } })
  }

  const supabase = getSupabaseAdmin()

  const { data: act } = await supabase
    .from('actualizaciones')
    .select('id, estado')
    .eq('id', id)
    .maybeSingle()

  if (!act) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)

  const estado = (act as any).estado as string
  if (estado !== 'EJECUTANDO' && estado !== 'PROGRAMADA') {
    return respuestaError(ERRORES.NEG_OPERACION_INVALIDA, {
      detalle: `No se puede forzar cierre de una actualización en estado ${estado}.`,
    })
  }

  // Marcar como FALLIDA
  const { error } = await (supabase.from('actualizaciones') as any)
    .update({
      estado: 'FALLIDA',
      fecha_fin_ejecucion: new Date().toISOString(),
      error_mensaje: `Cerrado manualmente por el administrador (${usuario.email ?? usuario.id}). La actualización quedó stuck y se forzó el cierre desde la UI.`,
      cancelada_por_usuario_id: usuario.id,
    })
    .eq('id', id)

  if (error) {
    return respuestaError(ERRORES.DB_NO_DISPONIBLE, { detalle: error.message })
  }

  // Limpiar archivos trigger/progress si existen
  const updatesDir = path.resolve(process.cwd(), 'tmp/updates')
  for (const f of ['pending.json', 'progress.json', '.in-progress']) {
    try {
      await fs.unlink(path.join(updatesDir, f))
    } catch {
      // No existen → no es un problema
    }
  }

  return respuestaExito({ id, estado: 'FALLIDA', forzado: true })
}, { modulo: 'actualizaciones' })
