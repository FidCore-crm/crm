// ============================================================================
// POST /api/auth/refrescar-token
//
// Endpoint que el cliente Supabase del browser llama cuando recibe 401 en una
// query (porque el JWT en la cookie `fidcore_jwt` venció).
//
// Usa el refresh_token de la cookie HttpOnly `crm_session` para obtener un
// nuevo par de tokens via GoTrue. Setea las 3 cookies actualizadas
// (`crm_session`, `crm_access`, `fidcore_jwt`) y devuelve OK.
//
// No expone el access_token en el body — el cliente lo va a leer desde
// `fidcore_jwt` automáticamente.
//
// Si no hay refresh_token válido, devuelve 401 — el cliente debería
// redirigir a /login.
// ============================================================================

import { NextResponse } from 'next/server'
import { refrescarSesion } from '@/lib/auth'
import { setearCookiesSesion, limpiarCookiesSesion } from '@/lib/auth/cookie-options'

export async function POST(request: Request) {
  const cookieHeader = request.headers.get('cookie') ?? ''
  const match = cookieHeader.match(/crm_session=([^;]+)/)

  if (!match) {
    const response = NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
    limpiarCookiesSesion(response)
    return response
  }

  const refresh_token = decodeURIComponent(match[1])
  const tokens = await refrescarSesion(refresh_token)

  if (!tokens) {
    // Refresh token inválido o expirado — limpiar todo
    const response = NextResponse.json({ ok: false, error: 'Sesión expirada' }, { status: 401 })
    limpiarCookiesSesion(response)
    return response
  }

  const response = NextResponse.json({ ok: true })
  setearCookiesSesion(response, request, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  })

  return response
}
