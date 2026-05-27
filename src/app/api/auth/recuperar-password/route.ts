// ============================================================================
// POST /api/auth/recuperar-password
//
// Endpoint público (sin sesión). Cuando un usuario hace click en
// "Olvidé mi contraseña" en /login, manda su email a este endpoint.
//
// Body: { email }
//
// Comportamiento (privacy-preserving):
//   - Siempre responde 200 con un mensaje genérico, AUN SI el email no existe.
//     Esto evita que alguien pueda enumerar emails válidos del CRM.
//   - Si el email existe y la cuenta está activa, encola un email con la
//     plantilla `auth_recuperar_password` y un link generado con la admin
//     API de GoTrue (`generateLink({type: 'recovery'})`).
//   - El link redirige a `/auth/nueva-password` del CRM con un access_token
//     y refresh_token de un solo uso. Esa página completa el reset.
//
// Rate limiting: 5 por IP por hora + 1 por email por hora.
// ============================================================================

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { generarLinkAdmin } from '@/lib/auth'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { logger } from '@/lib/errores'
import { encolarEmail } from '@/lib/comunicaciones-sender'
import { obtenerUrlCRM } from '@/lib/urls-publicas'
import { generarBotonHtml } from '@/lib/email-templates/botones'

const RESPUESTA_GENERICA = {
  ok: true,
  mensaje: 'Si la cuenta existe, te enviamos un email con los pasos para definir una nueva contraseña.',
}

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request)

    // Rate-limit IP: 5/hora
    const rlIp = await checkRateLimit({
      identifier: ip,
      endpoint: 'auth-recuperar-ip',
      maxRequests: 5,
      windowSeconds: 3600,
    })
    if (!rlIp.allowed) {
      return NextResponse.json(
        { ok: false, error: 'Demasiadas solicitudes. Esperá una hora.' },
        { status: 429 },
      )
    }

    const body = await request.json().catch(() => ({}))
    const email = String(body?.email ?? '').toLowerCase().trim()

    if (!email) {
      return NextResponse.json({ ok: false, error: 'Email es obligatorio' }, { status: 400 })
    }

    // Rate-limit por email: 1/hora (anti-spam de email)
    const rlEmail = await checkRateLimit({
      identifier: email,
      endpoint: 'auth-recuperar-email',
      maxRequests: 1,
      windowSeconds: 3600,
    })
    if (!rlEmail.allowed) {
      return NextResponse.json(RESPUESTA_GENERICA)
    }

    // Buscar usuario via RPC (no leak: si no existe, respondemos genérico)
    const supabase = getSupabaseAdmin()
    const { data: perfilArr } = await supabase.rpc('fn_obtener_perfil_por_email', {
      p_email: email,
    })
    const perfil = Array.isArray(perfilArr) && perfilArr.length > 0 ? perfilArr[0] : null

    if (!perfil || !(perfil as any).activo) {
      return NextResponse.json(RESPUESTA_GENERICA)
    }

    const p = perfil as any

    // Generar link de recovery con GoTrue admin API
    const urlCrm = (await obtenerUrlCRM()) ?? new URL(request.url).origin
    const redirectTo = `${urlCrm}/auth/nueva-password`

    const linkResult = await generarLinkAdmin({
      type: 'recovery',
      email,
      redirectTo,
    })

    if (!linkResult.ok) {
      logger.error({
        modulo: 'auth',
        mensaje: 'Error generando link de recovery',
        contexto: { email, error: linkResult.error },
      })
      // Respondemos genérico para no leak. El admin va a ver el error en logs.
      return NextResponse.json(RESPUESTA_GENERICA)
    }

    // Color de marca para el botón
    const { data: configOrganizacion } = await supabase
      .from('configuracion')
      .select('color_marca')
      .limit(1)
      .maybeSingle()

    const botonHtml = generarBotonHtml({
      url: linkResult.action_link,
      texto: 'Definir nueva contraseña',
      color_marca: (configOrganizacion as any)?.color_marca ?? null,
    })

    // Encolar email
    const enc = await encolarEmail({
      plantilla_codigo: 'auth_recuperar_password',
      destinatario: { email, nombre: `${p.nombre} ${p.apellido}` },
      tipo_envio: 'AUTH_RECUPERAR_PASSWORD',
      prioridad: 'ALTA',
      bypass_email_bajas: true,
      anti_spam: false,
      variables_extra: {
        nombre: p.nombre,
        apellido: p.apellido,
        email,
        boton_accion: botonHtml,
        url_accion: linkResult.action_link,
      },
    })

    if (!enc.ok) {
      logger.error({
        modulo: 'auth',
        mensaje: 'Error encolando email de recovery',
        contexto: { email, error: enc.error },
      })
    }

    return NextResponse.json(RESPUESTA_GENERICA)
  } catch (e: any) {
    logger.error({
      modulo: 'auth',
      mensaje: 'Error inesperado en recuperar-password',
      contexto: { error: e?.message ?? String(e) },
    })
    return NextResponse.json(RESPUESTA_GENERICA)
  }
}
