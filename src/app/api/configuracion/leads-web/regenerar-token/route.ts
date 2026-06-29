/**
 * POST /api/configuracion/leads-web/regenerar-token
 * Regenera el token único del endpoint público. Invalida la URL anterior
 * inmediatamente — cualquier formulario que la siga usando empezará a fallar
 * con 404 TOKEN_INVALIDO.
 *
 * Solo admin. Sin body.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import {
  manejarErrores,
  respuestaExito,
  respuestaError,
  ERRORES,
} from '@/lib/errores'
import { regenerarToken } from '@/lib/leads-web'

export const POST = manejarErrores(
  async (request: NextRequest) => {
    const auth = await requireAdmin(request)
    if (auth instanceof NextResponse) return auth

    try {
      const nuevoToken = await regenerarToken()
      return respuestaExito({ token: nuevoToken })
    } catch (e) {
      return respuestaError(ERRORES.DB_ERROR_ESCRITURA, {
        detalle: String(e),
      })
    }
  },
  { modulo: 'configuracion-leads-web' },
)
