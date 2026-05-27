import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { logger } from '@/lib/errores'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  try {
    // Rate limiting: 20 errores por IP por hora
    const ip = getClientIp(request)
    const rl = await checkRateLimit({ identifier: ip, endpoint: 'errores-sistema-cliente', maxRequests: 20, windowSeconds: 3600 })
    if (!rl.allowed) {
      return NextResponse.json({ ok: false }, { status: 429 })
    }

    // Validar tamaño del payload (max 10 KB)
    const contentLength = request.headers.get('content-length')
    if (contentLength && parseInt(contentLength) > 10240) {
      return NextResponse.json({ ok: false }, { status: 413 })
    }

    const body = await request.json()

    const codigo = typeof body?.codigo === 'string' ? body.codigo.slice(0, 50) : 'ERR_SYS_001'
    const mensaje = typeof body?.mensaje === 'string' ? body.mensaje.slice(0, 500) : 'Error en frontend'
    const stack_trace = typeof body?.stack_trace === 'string' ? body.stack_trace.slice(0, 10000) : undefined
    const componente = typeof body?.componente === 'string' ? body.componente.slice(0, 200) : undefined
    const url = typeof body?.url === 'string' ? body.url.slice(0, 500) : undefined

    logger.error({
      codigo,
      mensaje,
      modulo: 'frontend',
      endpoint: url,
      stack_trace,
      contexto: { componente },
    })

    try {
      const supabase = getSupabaseAdmin()
      await supabase.from('errores_sistema').insert({
        codigo,
        mensaje,
        modulo: 'frontend',
        endpoint: url,
        stack_trace,
        contexto_extra: componente ? { componente } : null,
      })
    } catch {
      // Si falla la persistencia, al menos queda el log
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
