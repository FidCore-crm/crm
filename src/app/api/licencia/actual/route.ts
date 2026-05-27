/**
 * GET /api/licencia/actual
 *
 * Devuelve el estado actual del sistema de licencias:
 *   - Modo (ACTIVA / GRACIA / BLOQUEADA / SIN_LICENCIA)
 *   - Licencia activa con días restantes
 *   - Licencias encoladas (cargadas para activarse en el futuro)
 *   - Días de gracia restantes (si aplica)
 *   - instalacion_id (lo necesita el admin para pedirle a Pulzar la licencia)
 *
 * Visible para cualquier usuario autenticado — los módulos del CRM lo consultan
 * para saber si están en modo solo lectura. La info devuelta NO es sensible.
 */

import type { NextRequest } from 'next/server'
import { manejarErrores, respuestaExito, respuestaError, ERRORES } from '@/lib/errores'
import { requireAuth } from '@/lib/api-auth'
import { obtenerEstadoLicencia } from '@/lib/licencia'
import { obtenerInstalacionId } from '@/lib/instalacion-id'
import { esLicenciaPublicKeyPlaceholder } from '@/lib/licencia-public-key'

export const GET = manejarErrores(async (request: NextRequest) => {
  const auth = await requireAuth(request)
  if (auth instanceof Response) {
    return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)
  }

  const estado = await obtenerEstadoLicencia()

  return respuestaExito({
    ...estado,
    instalacion_id: obtenerInstalacionId(),
    sistema_configurado: !esLicenciaPublicKeyPlaceholder(),
  })
}, { modulo: 'licencia' })
