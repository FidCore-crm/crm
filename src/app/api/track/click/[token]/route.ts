import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { logger } from '@/lib/errores/logger'

function parseUrl(str: string): URL | null {
  try {
    const url = new URL(str)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url
  } catch {
    return null
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const ip = getClientIp(request)
  const rl = await checkRateLimit({ identifier: ip, endpoint: 'track-click', maxRequests: 100, windowSeconds: 60 })
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: 'Demasiadas solicitudes' }, { status: 429 })
  }
  const { token } = await params
  const rawUrl = request.nextUrl.searchParams.get('url') || ''

  const parsed = parseUrl(rawUrl)
  const propioHost = request.nextUrl.host
  const esMismoOrigen = parsed?.host === propioHost
  // URL inválida → siempre va al home del propio sitio (jamás a un destino externo no validado).
  const fallbackSeguro = `${request.nextUrl.protocol}//${propioHost}/`

  try {
    const supabase = getSupabaseAdmin()
    const { data: envio } = await supabase
      .from('email_envios')
      .select('id, fecha_primer_click, cantidad_clicks')
      .eq('token_tracking', token)
      .maybeSingle()

    if (envio) {
      const envioData = envio as any

      // Registrar click (incluso si después redirigimos al fallback por URL inválida)
      await supabase.from('email_clicks').insert({
        envio_id: envioData.id,
        url_destino: parsed?.toString() ?? null,
        ip_origen: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      })

      // Actualizar contadores
      const updates: Record<string, any> = {
        cantidad_clicks: (envioData.cantidad_clicks || 0) + 1,
      }
      if (!envioData.fecha_primer_click) {
        updates.fecha_primer_click = new Date().toISOString()
      }
      await supabase
        .from('email_envios')
        .update(updates)
        .eq('id', envioData.id)

      // Token válido + URL válida → redirigir al destino. Si el destino es
      // externo (otro host), confiamos en el token: solo el sistema firmó
      // ese link con un token válido.
      if (parsed) return NextResponse.redirect(parsed.toString(), 302)
      return NextResponse.redirect(fallbackSeguro, 302)
    }

    // Token NO válido → solo redirigimos si la URL es del mismo origen.
    // Sino, es un intento de open redirect (un atacante usando nuestro
    // endpoint para enmascarar un link malicioso).
    if (parsed && esMismoOrigen) {
      return NextResponse.redirect(parsed.toString(), 302)
    }
    return NextResponse.redirect(fallbackSeguro, 302)
  } catch (error) {
    logger.warn({
      modulo: 'tracking',
      endpoint: '/api/track/click',
      mensaje: 'Error al registrar click de tracking',
      contexto: { token, error: error instanceof Error ? error.message : String(error) },
    })
    // En caso de error, política conservadora: fallback al home.
    if (parsed && esMismoOrigen) return NextResponse.redirect(parsed.toString(), 302)
    return NextResponse.redirect(fallbackSeguro, 302)
  }
}
