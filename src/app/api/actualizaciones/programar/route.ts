/**
 * POST /api/actualizaciones/programar
 *
 * Programa una actualización (o la dispara inmediatamente).
 *
 * Body:
 *   {
 *     version_nueva: "1.2.0",
 *     changelog: "...",
 *     programada_para: "2026-05-28T22:00:00.000Z" | null   // null = ahora
 *   }
 *
 * Admin-only. Falla con 409 si ya hay una actualización activa.
 */

import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { programarActualizacion } from '@/lib/updater'
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

  if (!body.version_nueva || typeof body.version_nueva !== 'string') {
    return respuestaError(ERRORES.VALID_CAMPO_REQUERIDO, {
      campos: { version_nueva: 'requerido' },
    })
  }

  // Parsear programada_para
  let programada_para: Date | null = null
  if (body.programada_para != null) {
    const parsed = new Date(body.programada_para)
    if (isNaN(parsed.getTime())) {
      return respuestaError(ERRORES.VALID_FORMATO_INVALIDO, {
        campos: { programada_para: 'fecha inválida' },
      })
    }
    // Validar que sea futuro (con margen de 1 min para tolerar latencia de UI)
    if (parsed.getTime() < Date.now() - 60_000) {
      return respuestaError(ERRORES.VALID_FORMATO_INVALIDO, {
        campos: { programada_para: 'la fecha debe ser futura' },
      })
    }
    programada_para = parsed
  }

  const resultado = await programarActualizacion({
    version_nueva: body.version_nueva,
    changelog: body.changelog ?? '',
    programada_para,
    usuario_id: usuario.id,
  })

  if (!resultado.ok) {
    throw new ErrorAplicacion(ERRORES.NEG_OPERACION_INVALIDA, {
      detalle: resultado.error,
    })
  }

  return respuestaExito(resultado.actualizacion)
}, { modulo: 'actualizaciones' })
