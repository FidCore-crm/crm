// ============================================================================
// POST /api/auth/solicitar-blanqueo
//
// Endpoint público (sin sesión). Crea una solicitud de blanqueo de contraseña
// para el email enviado.
//
// Comportamiento:
//   - Si el email no existe → respuesta genérica (no leak).
//   - Si el email es de un usuario común → crea solicitud PENDIENTE +
//     notifica al admin (in-app + email).
//   - Si el email es de un admin → crea solicitud PENDIENTE con token de
//     auto-confirmación + manda email al SMTP del CRM (= su propia casilla)
//     con el link "Confirmar blanqueo".
//
// Rate limiting: 1 solicitud por email cada 1h (cualquiera puede llegar al
// endpoint pero no genera spam masivo). Más 5 por IP por hora.
// ============================================================================

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { logger } from '@/lib/errores'
import { obtenerSolicitudActiva, crearSolicitud } from '@/lib/blanqueo-password'
import { encolarEmail, encolarEmailSistema } from '@/lib/comunicaciones-sender'
import { obtenerUrlCRM } from '@/lib/urls-publicas'

const RESPUESTA_GENERICA = {
  ok: true,
  mensaje: 'Si tu cuenta existe, le avisamos al administrador. Aguardá su confirmación para definir una nueva contraseña.',
}

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request)

    // Rate-limit por IP: 5 por hora
    const rlIp = await checkRateLimit({
      identifier: ip,
      endpoint: 'solicitar-blanqueo-ip',
      maxRequests: 5,
      windowSeconds: 3600,
    })
    if (!rlIp.allowed) {
      return NextResponse.json(
        { ok: false, error: 'Demasiadas solicitudes. Intentá en una hora.' },
        { status: 429 },
      )
    }

    const body = await request.json().catch(() => ({}))
    const email = String(body?.email ?? '').toLowerCase().trim()

    if (!email) {
      return NextResponse.json({ ok: false, error: 'Email es obligatorio' }, { status: 400 })
    }

    // Rate-limit por email: 1 por hora.
    // Esto evita que alguien dispare múltiples solicitudes del mismo email
    // (que generarían múltiples notificaciones al admin).
    const rlEmail = await checkRateLimit({
      identifier: email,
      endpoint: 'solicitar-blanqueo-email',
      maxRequests: 1,
      windowSeconds: 3600,
    })
    if (!rlEmail.allowed) {
      // Respuesta genérica para no leak.
      return NextResponse.json(RESPUESTA_GENERICA)
    }

    const supabase = getSupabaseAdmin()
    const { data: perfilArr } = await supabase.rpc('fn_obtener_perfil_por_email', {
      p_email: email,
    })
    const usuario = Array.isArray(perfilArr) && perfilArr.length > 0 ? perfilArr[0] : null

    if (!usuario || !(usuario as any).activo) {
      // Respuesta genérica.
      return NextResponse.json(RESPUESTA_GENERICA)
    }

    const u = usuario as {
      id: string
      email: string
      nombre: string
      apellido: string
      rol: 'ADMIN' | 'USUARIO'
      activo: boolean
    }

    // Si ya hay una solicitud activa, no creamos otra. Devolvemos genérico.
    const activa = await obtenerSolicitudActiva(u.id)
    if (activa) {
      return NextResponse.json(RESPUESTA_GENERICA)
    }

    const userAgent = request.headers.get('user-agent') ?? null
    const esAdmin = u.rol === 'ADMIN'

    const resultado = await crearSolicitud({
      usuario_id: u.id,
      ip_origen: ip,
      user_agent: userAgent,
      con_token_admin: esAdmin,
    })

    if (!resultado.ok) {
      logger.warn({
        modulo: 'blanqueo-password',
        mensaje: 'No se pudo crear solicitud de blanqueo',
        contexto: { usuario_id: u.id, error: resultado.error },
      })
      // El error puede ser por race con el unique constraint si dos requests
      // entraron casi a la vez. Devolvemos genérico igual.
      return NextResponse.json(RESPUESTA_GENERICA)
    }

    const fechaSolicitud = new Date().toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })

    if (esAdmin && resultado.token_plano) {
      // Auto-confirmación: link al SMTP del admin.
      const urlCrm = (await obtenerUrlCRM()) ?? 'http://localhost:3000'
      const urlConfirmacion = `${urlCrm}/api/auth/confirmar-blanqueo-admin/${resultado.token_plano}`

      // Enviamos directo (no por encolarEmailSistema porque ese va a TODOS
      // los admins; queremos solo a este admin específico que pidió el reset).
      await encolarEmail({
        plantilla_codigo: 'sistema_blanqueo_admin_confirmacion',
        destinatario: { email: u.email, nombre: `${u.nombre} ${u.apellido}` },
        tipo_envio: 'SISTEMA_BLANQUEO_ADMIN_CONFIRMACION',
        prioridad: 'ALTA',
        bypass_email_bajas: true,
        anti_spam: false,
        variables_extra: {
          nombre_admin: u.nombre,
          url_confirmacion: urlConfirmacion,
          fecha_solicitud: fechaSolicitud,
          ip_origen: ip,
        },
      }).catch((err) => {
        logger.error({
          modulo: 'blanqueo-password',
          mensaje: 'Error encolando email de auto-confirmación admin',
          contexto: { admin_id: u.id, error: String(err) },
        })
      })
    } else {
      // Usuario común: notificar al admin (in-app + email)
      await crearNotificacionParaAdmins(supabase, {
        usuario_nombre: `${u.nombre} ${u.apellido}`,
        usuario_id: u.id,
      })

      await encolarEmailSistema({
        tipo_evento: 'SOLICITUD_BLANQUEO_PASSWORD',
        variables_extra: {
          usuario_nombre_completo: `${u.nombre} ${u.apellido}`,
          usuario_email: u.email,
          fecha_solicitud: fechaSolicitud,
          ip_origen: ip,
        },
      }).catch((err) => {
        logger.error({
          modulo: 'blanqueo-password',
          mensaje: 'Error encolando email al admin',
          contexto: { error: String(err) },
        })
      })
    }

    return NextResponse.json(RESPUESTA_GENERICA)
  } catch (e: any) {
    logger.error({
      modulo: 'blanqueo-password',
      mensaje: 'Error inesperado en solicitar-blanqueo',
      contexto: { error: e?.message ?? String(e) },
    })
    // Siempre genérico para no leak info.
    return NextResponse.json(RESPUESTA_GENERICA)
  }
}

async function crearNotificacionParaAdmins(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  params: { usuario_nombre: string; usuario_id: string },
) {
  const { data: admins } = await supabase
    .from('usuarios_perfil')
    .select('id')
    .eq('rol', 'ADMIN')
    .eq('activo', true)

  const adminsArray = (admins as { id: string }[] | null) ?? []
  if (adminsArray.length === 0) return

  const inserts = adminsArray.map((a) => ({
    tipo: 'SOLICITUD_BLANQUEO_PASSWORD',
    prioridad: 'ADVERTENCIA',
    titulo: 'Solicitud de blanqueo de contraseña',
    mensaje: `${params.usuario_nombre} solicitó el blanqueo de su contraseña. Habilitalo desde la pantalla de Usuarios.`,
    entidad_tipo: 'usuario',
    entidad_id: params.usuario_id,
    url: '/crm/configuracion/usuarios',
    leida: false,
    usuario_id: a.id,
  }))

  await supabase.from('notificaciones').insert(inserts)
}
