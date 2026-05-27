/**
 * GET /api/actualizaciones/disponible
 *
 * Consulta GitHub por el último release publicado y compara con la versión
 * del CRM actual. Si hay versión nueva, devuelve el release info para que
 * el frontend muestre el banner "Actualizar a vX".
 *
 * Query params:
 *   - forzar=1  → ignora el cache de 1 hora y consulta GitHub al toque.
 *
 * Admin-only.
 */

import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { consultarUltimaActualizacion } from '@/lib/updater'
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

  const url = new URL(request.url)
  const forzar = url.searchParams.get('forzar') === '1'

  const resultado = await consultarUltimaActualizacion({ forzar })
  return respuestaExito(resultado)
}, { modulo: 'actualizaciones' })
