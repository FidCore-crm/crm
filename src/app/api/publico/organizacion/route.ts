import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

export async function GET(request: NextRequest) {
  // Endpoint público sin auth — protegemos con rate limit por IP para que
  // alguien no pueda hacer DoS bombardeando este endpoint o scrapear datos.
  const ip = getClientIp(request)
  const rl = await checkRateLimit({
    identifier: ip,
    endpoint: 'publico-organizacion',
    maxRequests: 60,
    windowSeconds: 60,
  })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas solicitudes' },
      { status: 429 },
    )
  }

  try {
    const supabase = getSupabaseAdmin()
    const { data } = await supabase
      .from('configuracion')
      .select('nombre, logo_path, color_marca, usar_logo')
      .limit(1)
      .maybeSingle()

    const mostrarLogo = data?.usar_logo !== false && !!data?.logo_path
    return NextResponse.json({
      nombre: data?.nombre || 'Productor de Seguros',
      logo_url: mostrarLogo ? `/api/storage/${data?.logo_path}` : null,
      color_marca: data?.color_marca || null,
    })
  } catch {
    return NextResponse.json({
      nombre: 'Productor de Seguros',
      logo_url: null,
      color_marca: null,
    })
  }
}
