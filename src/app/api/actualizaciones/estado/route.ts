/**
 * GET /api/actualizaciones/estado
 *
 * Devuelve la actualización activa (PROGRAMADA o EJECUTANDO) si la hay.
 * El frontend lo consulta cada 5s durante un update para mostrar progreso.
 *
 * Admin-only.
 */

import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import {
  obtenerActualizacionActiva,
  obtenerVersionActual,
  obtenerUltimaCompletada,
  leerProgreso,
} from '@/lib/updater'
import {
  respuestaError,
  respuestaExito,
  manejarErrores,
  ERRORES,
} from '@/lib/errores'

export const dynamic = 'force-dynamic'

export const GET = manejarErrores(async (request: Request) => {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)
  if (usuario.rol !== 'ADMIN') return respuestaError(ERRORES.PERM_SIN_PERMISO)

  const [activa, ultima_completada, progreso] = await Promise.all([
    obtenerActualizacionActiva(),
    obtenerUltimaCompletada(),
    leerProgreso(),
  ])

  return respuestaExito({
    version_actual: obtenerVersionActual(),
    actualizacion_activa: activa,
    ultima_completada,
    progreso,
  })
}, { modulo: 'actualizaciones' })
