import { NextResponse } from 'next/server'
import { cerrarSesion } from '@/lib/auth'
import { limpiarCookiesSesion } from '@/lib/auth/cookie-options'

export async function POST(request: Request) {
  const cookieHeader = request.headers.get('cookie') ?? ''
  const match = cookieHeader.match(/crm_session=([^;]+)/)

  if (match) {
    // cerrarSesion invalida el refresh_token en GoTrue. No tiramos si falla
    // porque el frontend igual va a borrar las cookies localmente.
    await cerrarSesion(decodeURIComponent(match[1])).catch(() => {})
  }

  const response = NextResponse.json({ ok: true })
  limpiarCookiesSesion(response)

  return response
}
