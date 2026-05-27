// ============================================================================
// POST /api/auth/blanquear
//
// Endpoint público (sin sesión). Define la nueva contraseña cuando el user
// tiene una solicitud HABILITADA.
//
// Body: { email, password_nueva }
//
// Tras hashear y guardar el password en auth.users via fn_setear_password_directo,
// marca la solicitud como CONSUMIDA, invalida todas las sesiones activas del
// user en GoTrue y crea una sesión nueva.
// ============================================================================

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { hashPassword, loginConSupabase } from '@/lib/auth'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { logger } from '@/lib/errores'
import { obtenerSolicitudActiva, consumirSolicitud } from '@/lib/blanqueo-password'
import { setearCookiesSesion } from '@/lib/auth/cookie-options'

const ERROR_GENERICO = 'No se pudo definir la contraseña. Verificá con el administrador.'

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request)

    const rl = await checkRateLimit({
      identifier: ip,
      endpoint: 'blanquear-password',
      maxRequests: 5,
      windowSeconds: 3600,
    })
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, error: 'Demasiados intentos. Esperá unos minutos.' },
        { status: 429 },
      )
    }

    const body = await request.json().catch(() => ({}))
    const email = String(body?.email ?? '').toLowerCase().trim()
    const passwordNueva = String(body?.password_nueva ?? '')

    if (!email || !passwordNueva) {
      return NextResponse.json({ ok: false, error: 'Datos incompletos' }, { status: 400 })
    }
    if (passwordNueva.length < 6) {
      return NextResponse.json(
        { ok: false, error: 'La contraseña debe tener al menos 6 caracteres' },
        { status: 400 },
      )
    }

    const supabase = getSupabaseAdmin()

    // Buscar usuario por email via RPC
    const { data: perfilArr } = await supabase.rpc('fn_obtener_perfil_por_email', {
      p_email: email,
    })
    const perfil = Array.isArray(perfilArr) && perfilArr.length > 0 ? perfilArr[0] : null

    if (!perfil || !(perfil as any).activo) {
      return NextResponse.json({ ok: false, error: ERROR_GENERICO }, { status: 400 })
    }

    const userId = (perfil as any).id as string

    const solicitud = await obtenerSolicitudActiva(userId)
    if (!solicitud || solicitud.estado !== 'HABILITADA') {
      return NextResponse.json({ ok: false, error: ERROR_GENERICO }, { status: 400 })
    }

    // Hashear y persistir directo en auth.users via RPC
    const passwordHash = await hashPassword(passwordNueva)
    const { error: errSet } = await supabase.rpc('fn_setear_password_directo', {
      p_usuario_id: userId,
      p_password_hash: passwordHash,
    })

    if (errSet) {
      logger.error({
        modulo: 'blanqueo-password',
        mensaje: 'Error actualizando password en auth.users',
        contexto: { usuario_id: userId, error: errSet.message },
      })
      return NextResponse.json(
        { ok: false, error: 'Error al guardar la contraseña' },
        { status: 500 },
      )
    }

    // Resetear intentos en usuarios_perfil
    await supabase
      .from('usuarios_perfil')
      .update({
        intentos_fallidos: 0,
        bloqueado_hasta: null,
        ultimo_acceso: new Date().toISOString(),
      })
      .eq('id', userId)

    // Marcar solicitud como CONSUMIDA
    const consumo = await consumirSolicitud(solicitud.id)
    if (!consumo.ok) {
      logger.warn({
        modulo: 'blanqueo-password',
        mensaje: 'Pass actualizada pero no se pudo marcar la solicitud como CONSUMIDA',
        contexto: { solicitud_id: solicitud.id, error: consumo.error },
      })
    }

    // Invalidar todas las sesiones del user en GoTrue (defensivo — los otros
    // browsers del usuario deberían volver a loguearse con la pass nueva)
    await supabase.auth.admin.signOut(userId).catch(() => {})

    // Login automático con la nueva pass
    const login = await loginConSupabase(email, passwordNueva)
    if (!login.ok) {
      return NextResponse.json({ ok: false, error: 'Contraseña guardada pero login falló. Intentá ingresar manualmente.' }, { status: 500 })
    }

    const response = NextResponse.json({
      ok: true,
      usuario: {
        id: userId,
        nombre: (perfil as any).nombre,
        apellido: (perfil as any).apellido,
        email: (perfil as any).email,
        rol: (perfil as any).rol,
        acceso_cartera: (perfil as any).acceso_cartera,
      },
    })

    setearCookiesSesion(response, request, {
      access_token: login.sesion.access_token,
      refresh_token: login.sesion.refresh_token,
    })

    return response
  } catch (e: any) {
    logger.error({
      modulo: 'blanqueo-password',
      mensaje: 'Error inesperado en blanquear',
      contexto: { error: e?.message ?? String(e) },
    })
    return NextResponse.json({ ok: false, error: 'Error interno' }, { status: 500 })
  }
}
