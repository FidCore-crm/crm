/**
 * Helper para construir las opciones de la cookie de sesión `crm_session`.
 *
 * Detecta dinámicamente si el request entra por HTTPS (cuando está detrás de
 * un proxy como Cloudflare Tunnel) o HTTP plano (LAN / dev), y setea
 * `secure: true` solo cuando corresponde — un `secure: true` en HTTP plano
 * hace que el navegador descarte la cookie y el login parezca "no funciona".
 *
 * Confiamos en el header `X-Forwarded-Proto` que setea cloudflared. En
 * producción el container de Next no expone su puerto al exterior — solo
 * cloudflared se le conecta vía la red Docker interna — por lo que un
 * atacante no puede engañar el header desde afuera.
 *
 * No seteamos `domain`: queremos que la cookie quede atada al hostname
 * exacto del CRM (ej: `<cliente>.pulzar.com.ar`) y NO se filtre a otros
 * subdominios que pudieran existir (ej: `denuncia.<cliente>.pulzar.com.ar`).
 */

export function detectarHttps(request: Request): boolean {
  const proto = request.headers.get('x-forwarded-proto')
  if (proto) return proto.toLowerCase().split(',')[0].trim() === 'https'
  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
}

export interface OpcionesCookieSesion {
  httpOnly: true
  secure: boolean
  sameSite: 'lax'
  path: '/'
  maxAge: number
}

export function opcionesCookieSesion(
  request: Request,
  opcionesExtra?: { maxAge?: number },
): OpcionesCookieSesion {
  return {
    httpOnly: true,
    secure: detectarHttps(request),
    sameSite: 'lax',
    path: '/',
    maxAge: opcionesExtra?.maxAge ?? 86400,
  }
}

/** Default: refresh_token vive 30 días, access_token 1 hora.
 *  Concuerda con la config default de GoTrue (refresh_token_lifetime
 *  default 30d, JWT_EXPIRY 3600s). */
export const REFRESH_TOKEN_MAX_AGE = 30 * 24 * 3600 // 30 días
export const ACCESS_TOKEN_MAX_AGE = 3600 // 1 hora

import type { NextResponse } from 'next/server'

/** Setea las cookies de sesión Supabase Auth en el response:
 *    - `crm_session` (refresh_token, 30d, HttpOnly) — duradera, para backend
 *    - `crm_access`  (access_token, 1h, HttpOnly)   — rápida, para backend
 *    - `pulzar_jwt`  (access_token, 1h, NO-HttpOnly) — para el cliente Supabase
 *                                                      en el browser
 *
 *  ¿Por qué tres cookies? Las primeras dos son HttpOnly (no accesibles desde
 *  JS) para que XSS no pueda robarlas. Pero el cliente Supabase del browser
 *  necesita el JWT para que `auth.uid()` funcione en RLS — esa es la tercera.
 *
 *  Riesgo XSS limitado: el access_token dura solo 1h y el refresh_token
 *  (que permite renovar indefinidamente) sigue HttpOnly.
 */
export function setearCookiesSesion(
  response: NextResponse,
  request: Request,
  tokens: { access_token: string; refresh_token: string },
): void {
  const secure = detectarHttps(request)

  response.cookies.set('crm_session', tokens.refresh_token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: REFRESH_TOKEN_MAX_AGE,
  })

  response.cookies.set('crm_access', tokens.access_token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_TOKEN_MAX_AGE,
  })

  // No-HttpOnly: para que el cliente Supabase del browser pueda agregar
  // el JWT como header Authorization en cada query (RLS necesita auth.uid()).
  response.cookies.set('pulzar_jwt', tokens.access_token, {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_TOKEN_MAX_AGE,
  })
}

/** Limpia las cookies de sesión (para logout). */
export function limpiarCookiesSesion(response: NextResponse): void {
  response.cookies.set('crm_session', '', { path: '/', maxAge: 0 })
  response.cookies.set('crm_access', '', { path: '/', maxAge: 0 })
  response.cookies.set('pulzar_jwt', '', { path: '/', maxAge: 0 })
}
