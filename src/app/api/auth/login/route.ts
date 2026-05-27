import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { loginConSupabase } from '@/lib/auth'
import { checkRateLimit, incrementRateLimit, getClientIp } from '@/lib/rate-limit'
import { logger } from '@/lib/errores'
import { obtenerSolicitudActiva } from '@/lib/blanqueo-password'
import { setearCookiesSesion } from '@/lib/auth/cookie-options'

const RL_LOGIN_MAX_FALLOS = 20
const RL_LOGIN_VENTANA_SEG = 3600

export async function POST(request: Request) {
  try {
    // Rate limiting por IP: solo cuenta intentos FALLIDOS. Logins exitosos no
    // consumen cuota — un PAS legítimo loguéandose varias veces seguidas no
    // tiene por qué quedar bloqueado.
    const ip = getClientIp(request)
    const rl = await checkRateLimit({
      identifier: ip,
      endpoint: 'auth-login',
      maxRequests: RL_LOGIN_MAX_FALLOS,
      windowSeconds: RL_LOGIN_VENTANA_SEG,
      consume: false,
    })
    if (!rl.allowed) {
      return NextResponse.json({ ok: false, error: 'Demasiados intentos fallidos. Esperá unos minutos.' }, { status: 429 })
    }

    const { email, password } = await request.json()

    if (!email) {
      return NextResponse.json({ ok: false, error: 'Email es obligatorio' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    // Buscar perfil del usuario via RPC (auth.users no está expuesto via PostgREST)
    const { data: perfilArr } = await supabase.rpc('fn_obtener_perfil_por_email', {
      p_email: email,
    })
    const perfil = Array.isArray(perfilArr) && perfilArr.length > 0 ? perfilArr[0] : null

    if (!perfil) {
      await incrementRateLimit({ identifier: ip, endpoint: 'auth-login', windowSeconds: RL_LOGIN_VENTANA_SEG })
      return NextResponse.json({ ok: false, error: 'Credenciales inválidas' }, { status: 401 })
    }

    const p: any = perfil
    const userId = p.id as string

    if (!p.activo) {
      return NextResponse.json({ ok: false, error: 'Usuario desactivado. Contactá al administrador.' }, { status: 401 })
    }

    // Verificar bloqueo temporal (campo en usuarios_perfil)
    if (p.bloqueado_hasta && new Date(p.bloqueado_hasta) > new Date()) {
      const minutos = Math.ceil((new Date(p.bloqueado_hasta).getTime() - Date.now()) / 60000)
      return NextResponse.json({ ok: false, error: `Usuario bloqueado temporalmente. Intentá en ${minutos} minutos.` }, { status: 401 })
    }

    // Antes de validar password, chequear si hay blanqueo en proceso para este user.
    const solicitudBlanqueo = await obtenerSolicitudActiva(userId)
    if (solicitudBlanqueo) {
      if (solicitudBlanqueo.estado === 'PENDIENTE') {
        return NextResponse.json({
          ok: false,
          estado: 'BLANQUEO_PENDIENTE',
          error: 'Hay una solicitud de blanqueo de contraseña pendiente. Aguardá la confirmación del administrador.',
        }, { status: 403 })
      }
      if (solicitudBlanqueo.estado === 'HABILITADA') {
        return NextResponse.json({
          ok: false,
          estado: 'BLANQUEO_HABILITADA',
          error: 'El administrador habilitó tu blanqueo. Definí una nueva contraseña.',
          solicitud_id: solicitudBlanqueo.id,
        }, { status: 403 })
      }
    }

    if (!password) {
      return NextResponse.json({ ok: false, error: 'Contraseña es obligatoria' }, { status: 400 })
    }

    // Auth real contra GoTrue
    const resultado = await loginConSupabase(email, password)

    if (!resultado.ok) {
      const intentos = (p.intentos_fallidos ?? 0) + 1
      const update: any = { intentos_fallidos: intentos }

      if (intentos >= 5) {
        const bloqueadoHasta = new Date()
        bloqueadoHasta.setMinutes(bloqueadoHasta.getMinutes() + 15)
        update.bloqueado_hasta = bloqueadoHasta.toISOString()
      }

      await supabase.from('usuarios_perfil').update(update).eq('id', userId)
      await incrementRateLimit({ identifier: ip, endpoint: 'auth-login', windowSeconds: RL_LOGIN_VENTANA_SEG })
      return NextResponse.json({ ok: false, error: 'Credenciales inválidas' }, { status: 401 })
    }

    // Login exitoso — reset intentos + ultimo_acceso
    await supabase.from('usuarios_perfil').update({
      intentos_fallidos: 0,
      bloqueado_hasta: null,
      ultimo_acceso: new Date().toISOString(),
    }).eq('id', userId)

    const response = NextResponse.json({
      ok: true,
      usuario: {
        id: userId,
        nombre: p.nombre,
        apellido: p.apellido,
        email: p.email,
        rol: p.rol,
        acceso_cartera: p.acceso_cartera,
      },
    })

    setearCookiesSesion(response, request, {
      access_token: resultado.sesion.access_token,
      refresh_token: resultado.sesion.refresh_token,
    })

    return response
  } catch (e: any) {
    logger.error({ modulo: 'auth', mensaje: 'Error en /api/auth/login', contexto: { error: String(e?.message ?? e) } })
    return NextResponse.json({ ok: false, error: 'Error interno del servidor' }, { status: 500 })
  }
}
