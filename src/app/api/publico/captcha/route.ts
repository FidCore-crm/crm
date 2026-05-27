import { NextRequest, NextResponse } from 'next/server'
import { generarCaptcha, checkRateLimit, getClientIp } from '@/lib/rate-limit'

/**
 * GET /api/publico/captcha
 * Genera un captcha matemático simple (suma o resta de 1 dígito).
 * Retorna { token, pregunta }. El token es uso único y expira en 10 minutos.
 * Rate-limited a 30/min por IP para prevenir flooding.
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request)
  const rl = await checkRateLimit({ identifier: ip, endpoint: 'captcha', maxRequests: 30, windowSeconds: 60 })
  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000)
    return NextResponse.json(
      { ok: false, error: 'Demasiadas solicitudes' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }
  const { token, pregunta } = generarCaptcha()
  return NextResponse.json({ ok: true, token, pregunta })
}
