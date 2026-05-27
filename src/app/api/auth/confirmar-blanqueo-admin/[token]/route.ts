// ============================================================================
// GET /api/auth/confirmar-blanqueo-admin/[token]
//
// Endpoint público al que el admin llega haciendo click en el link de su
// email de confirmación. Habilita su solicitud PENDIENTE y redirige al login
// con un mensaje de éxito.
//
// Si el token no existe o expiró, redirige al login con un mensaje de error.
// ============================================================================

import { NextResponse } from 'next/server'
import { habilitarPorTokenAdmin } from '@/lib/blanqueo-password'
import { logger } from '@/lib/errores'
import { obtenerUrlCRM } from '@/lib/urls-publicas'

export async function GET(
  request: Request,
  { params }: { params: { token: string } },
) {
  const token = params.token

  // Resolver la URL del login para hacer redirects.
  const urlBase = (await obtenerUrlCRM()) ?? new URL(request.url).origin

  if (!token || token.length < 20) {
    return NextResponse.redirect(`${urlBase}/login?motivo=blanqueo_token_invalido`)
  }

  try {
    const resultado = await habilitarPorTokenAdmin(token)
    if (!resultado.ok) {
      return NextResponse.redirect(
        `${urlBase}/login?motivo=blanqueo_token_invalido`,
      )
    }
    return NextResponse.redirect(
      `${urlBase}/login?motivo=blanqueo_admin_confirmado`,
    )
  } catch (e: any) {
    logger.error({
      modulo: 'blanqueo-password',
      mensaje: 'Error procesando confirmación admin',
      contexto: { error: e?.message ?? String(e) },
    })
    return NextResponse.redirect(
      `${urlBase}/login?motivo=blanqueo_token_invalido`,
    )
  }
}
