// ============================================================================
// POST /api/auth/aceptar-invitacion
//
// Endpoint público (sin sesión). Lo llama la página /auth/aceptar-invitacion
// con los tokens que GoTrue puso en el fragment del URL después de validar
// el link de invitación.
//
// Body: { access_token, refresh_token, password_nueva }
//
// Flujo:
//   1. Decodifica access_token, extrae user_id
//   2. Setea el password con auth.admin.updateUserById(id, { password })
//   3. Marca el perfil como activo=true (estaba false desde la invitación)
//   4. Devuelve datos del usuario + setea cookies de sesión
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
      endpoint: 'auth-aceptar-invitacion',
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
      return NextResponse.json({ ok: false, error: 'El link de invitación expiró. Pedile al administrador que te invite de nuevo.' }, { status: 401 })
    }

    const supabase = getSupabaseAdmin()

    // Verificar que el perfil exista
    const { data: perfil } = await supabase
      .from('usuarios_perfil')
      .select('id, nombre, apellido, rol, acceso_cartera')
      .eq('id', payload.sub)
      .single()

    if (!perfil) {
      return NextResponse.json({ ok: false, error: 'Usuario no encontrado' }, { status: 401 })
    }

    // Setear password via admin API
    const { error: errPwd } = await supabase.auth.admin.updateUserById(payload.sub, {
      password: passwordNueva,
      email_confirm: true,
    })
    if (errPwd) {
      logger.error({
        modulo: 'auth',
        mensaje: 'Error seteando password al aceptar invitación',
        contexto: { usuario_id: payload.sub, error: errPwd.message },
      })
      return NextResponse.json({ ok: false, error: 'No se pudo activar la cuenta' }, { status: 500 })
    }

    // Activar perfil (estaba activo=false desde la invitación)
    await supabase
      .from('usuarios_perfil')
      .update({
        activo: true,
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

    setearCookiesSesion(response, request, {
      access_token: accessToken,
      refresh_token: refreshToken,
    })

    return response
  } catch (e: any) {
    logger.error({
      modulo: 'auth',
      mensaje: 'Error inesperado en aceptar-invitacion',
      contexto: { error: e?.message ?? String(e) },
    })
    return NextResponse.json({ ok: false, error: 'Error interno' }, { status: 500 })
  }
}
