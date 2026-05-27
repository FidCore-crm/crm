/**
 * POST /api/actualizaciones/cancelar
 *
 * Cancela una actualización en estado PROGRAMADA. Una vez EJECUTANDO ya
 * no se puede cancelar.
 *
 * Body: { id: "uuid" }
 *
 * Admin-only.
 */

import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { cancelarActualizacion } from '@/lib/updater'
import {
  respuestaError,
  respuestaExito,
  manejarErrores,
  ERRORES,
  ErrorAplicacion,
} from '@/lib/errores'

export const dynamic = 'force-dynamic'

export const POST = manejarErrores(async (request: Request) => {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)
  if (usuario.rol !== 'ADMIN') return respuestaError(ERRORES.PERM_SIN_PERMISO)

  let body: any
  try {
    body = await request.json()
  } catch {
    return respuestaError(ERRORES.VALID_FORMATO_INVALIDO)
  }

  if (!body.id || typeof body.id !== 'string') {
    return respuestaError(ERRORES.VALID_CAMPO_REQUERIDO, { campos: { id: 'requerido' } })
  }

  const resultado = await cancelarActualizacion(body.id, usuario.id)
  if (!resultado.ok) {
    throw new ErrorAplicacion(ERRORES.NEG_OPERACION_INVALIDA, { detalle: resultado.error })
  }

  return respuestaExito({ id: body.id, cancelada: true })
}, { modulo: 'actualizaciones' })
