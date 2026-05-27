import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

export async function GET(request: NextRequest) {
  const ip = getClientIp(request)
  const rl = await checkRateLimit({ identifier: ip, endpoint: 'publico-config', maxRequests: 30, windowSeconds: 60 })
  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000)
    return NextResponse.json(
      { ok: false, error: 'Demasiadas solicitudes' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }
  try {
    const supabase = getSupabaseAdmin()
    const { data } = await supabase
      .from('configuracion_formulario_publico')
      .select('activo, titulo_hero, subtitulo_hero, mensaje_validacion_fallida, mensaje_fuera_servicio, terminos_activos, terminos_titulo, terminos_contenido')
      .limit(1)
      .maybeSingle()

    if (!data) {
      return NextResponse.json({
        activo: true,
        titulo_hero: 'Denunciar Siniestro',
        subtitulo_hero: 'Completá los datos de tu siniestro de forma rápida y segura. Te llegará una constancia por email.',
        mensaje_validacion_fallida: 'Los datos ingresados no coinciden con nuestro sistema. Verificá tu DNI, email y número de póliza, o contactá a tu productor.',
        mensaje_fuera_servicio: 'El formulario de denuncias está temporalmente fuera de servicio. Por favor contactá directamente a tu productor asesor.',
        terminos_activos: false,
        terminos_titulo: 'Términos y Condiciones',
        terminos_contenido: null,
      })
    }

    return NextResponse.json(data)
  } catch {
    return NextResponse.json({
      activo: true,
      titulo_hero: 'Denunciar Siniestro',
      subtitulo_hero: 'Completá los datos de tu siniestro de forma rápida y segura. Te llegará una constancia por email.',
      mensaje_validacion_fallida: 'Los datos ingresados no coinciden con nuestro sistema. Verificá tu DNI, email y número de póliza, o contactá a tu productor.',
      mensaje_fuera_servicio: 'El formulario de denuncias está temporalmente fuera de servicio. Por favor contactá directamente a tu productor asesor.',
      terminos_activos: false,
      terminos_titulo: 'Términos y Condiciones',
      terminos_contenido: null,
    })
  }
}
