// ============================================================================
// POST /api/auth/setear-nueva-password
//
// Endpoint público (sin sesión de cookie todavía). Recibe los tokens que
// GoTrue puso en el URL fragment después de verificar el link de recovery,
// junto con la nueva password elegida por el usuario.
//
// Body: { access_token, refresh_token, password_nueva }
//
// Flujo:
//   1. Valida el access_token (firma + expiración)
//   2. Llama a auth.admin.updateUserById(sub, { password }) para cambiar
//   3. Resetea intentos_fallidos + ultimo_acceso del perfil
//   4. Setea las cookies de sesión usando los mismos tokens (la sesión
//      sigue válida) y devuelve datos del usuario para que el frontend
//      pueda redirigir.
//
// Rate limiting: 5 por IP por hora.
// ============================================================================

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { logger } from '@/lib/errores'
import { setearCookiesSesion } from '@/lib/auth/cookie-options'

interface JwtPayloadMin {
  sub: string
  email?: string
  exp: number
  iat: number
}

function decodificarJwt(token: string): JwtPayloadMin | null {
  try {
    const partes = token.split('.')
    if (partes.length !== 3) return null
    const payloadBase64 = partes[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = Buffer.from(payloadBase64, 'base64').toString('utf-8')
    return JSON.parse(json) as JwtPayloadMin
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request)
    const rl = await checkRateLimit({
      identifier: ip,
      endpoint: 'auth-setear-pass',
      maxRequests: 5,
      windowSeconds: 3600,
    })
    if (!rl.allowed) {
      return NextResponse.json({ ok: false, error: 'Demasiados intentos. Esperá una hora.' }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const accessToken = String(body?.access_token ?? '')
    const refreshToken = String(body?.refresh_token ?? '')
    const passwordNueva = String(body?.password_nueva ?? '')

    if (!accessToken || !refreshToken || !passwordNueva) {
      return NextResponse.json({ ok: false, error: 'Datos incompletos' }, { status: 400 })
    }
    if (passwordNueva.length < 6) {
      return NextResponse.json({ ok: false, error: 'La contraseña debe tener al menos 6 caracteres' }, { status: 400 })
    }

    const payload = decodificarJwt(accessToken)
    if (!payload || !payload.sub) {
      return NextResponse.json({ ok: false, error: 'Token inválido' }, { status: 401 })
    }
    if (Date.now() / 1000 >= payload.exp) {
      return NextResponse.json({ ok: false, error: 'El link de recuperación expiró. Pedí uno nuevo.' }, { status: 401 })
    }

    const supabase = getSupabaseAdmin()

    // Verificar que el usuario existe + tiene perfil activo
    const { data: perfil } = await supabase
      .from('usuarios_perfil')
      .select('id, nombre, apellido, rol, acceso_cartera, activo')
      .eq('id', payload.sub)
      .single()

    if (!perfil || !(perfil as any).activo) {
      return NextResponse.json({ ok: false, error: 'Usuario no encontrado o desactivado' }, { status: 401 })
    }

    // Actualizar password via admin API
    const { error: errUpd } = await supabase.auth.admin.updateUserById(payload.sub, { password: passwordNueva })
    if (errUpd) {
      logger.error({
        modulo: 'auth',
        mensaje: 'Error actualizando password tras recovery',
        contexto: { usuario_id: payload.sub, error: errUpd.message },
      })
      return NextResponse.json({ ok: false, error: 'No se pudo guardar la nueva contraseña' }, { status: 500 })
    }

    // Resetear intentos + ultimo_acceso
    await supabase
      .from('usuarios_perfil')
      .update({
        intentos_fallidos: 0,
        bloqueado_hasta: null,
        ultimo_acceso: new Date().toISOString(),
      })
      .eq('id', payload.sub)

    // Resolver email para el response
    const { data: authUser } = await supabase.auth.admin.getUserById(payload.sub)
    const email = authUser?.user?.email ?? payload.email ?? ''

    const p: any = perfil

    const response = NextResponse.json({
      ok: true,
      usuario: {
        id: p.id,
        nombre: p.nombre,
        apellido: p.apellido,
        email,
        rol: p.rol,
        acceso_cartera: p.acceso_cartera,
      },
    })

    // Setear cookies con los tokens del fragment (válidos durante 1h y 30d)
    setearCookiesSesion(response, request, {
      access_token: accessToken,
      refresh_token: refreshToken,
    })

    return response
  } catch (e: any) {
    logger.error({
      modulo: 'auth',
      mensaje: 'Error inesperado en setear-nueva-password',
      contexto: { error: e?.message ?? String(e) },
    })
    return NextResponse.json({ ok: false, error: 'Error interno' }, { status: 500 })
  }
}
