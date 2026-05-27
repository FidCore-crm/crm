// POST /api/usuarios/[id]/reenviar-invitacion
// Admin reenvía el link de invitación a un usuario que aún no aceptó
// (perfil con activo=false). Genera un link fresco y encola el email.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { obtenerUsuarioDesdeRequest, generarLinkAdmin } from '@/lib/auth'
import { encolarEmail } from '@/lib/comunicaciones-sender'
import { obtenerUrlCRM } from '@/lib/urls-publicas'
import { generarBotonHtml } from '@/lib/email-templates/botones'
import { logger } from '@/lib/errores'

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const admin = await obtenerUsuarioDesdeRequest(request)
  if (!admin) return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  if (admin.rol !== 'ADMIN') return NextResponse.json({ ok: false, error: 'Sin permisos' }, { status: 403 })

  const supabase = getSupabaseAdmin()
  const { id } = params

  const { data: perfil } = await supabase
    .from('usuarios_perfil')
    .select('id, nombre, apellido, activo')
    .eq('id', id)
    .single()

  if (!perfil) return NextResponse.json({ ok: false, error: 'Usuario no encontrado' }, { status: 404 })

  const p: any = perfil

  if (p.activo) {
    return NextResponse.json({ ok: false, error: 'El usuario ya activó su cuenta' }, { status: 400 })
  }

  // Buscar email en auth.users
  const { data: authUser } = await supabase.auth.admin.getUserById(id)
  const email = authUser?.user?.email
  if (!email) {
    return NextResponse.json({ ok: false, error: 'No se pudo resolver el email' }, { status: 500 })
  }

  // Generar nuevo link
  const urlCrm = (await obtenerUrlCRM()) ?? new URL(request.url).origin
  const redirectTo = `${urlCrm}/auth/aceptar-invitacion`

  const linkResult = await generarLinkAdmin({
    type: 'invite',
    email,
    redirectTo,
  })

  if (!linkResult.ok) {
    logger.error({
      modulo: 'auth',
      mensaje: 'Error reenviando invitación',
      contexto: { usuario_id: id, error: linkResult.error },
    })
    return NextResponse.json({ ok: false, error: 'No se pudo generar el link' }, { status: 500 })
  }

  const { data: configOrganizacion } = await supabase
    .from('configuracion')
    .select('color_marca')
    .limit(1)
    .maybeSingle()

  const botonHtml = generarBotonHtml({
    url: linkResult.action_link,
    texto: 'Activar mi cuenta',
    color_marca: (configOrganizacion as any)?.color_marca ?? null,
  })

  await encolarEmail({
    plantilla_codigo: 'auth_invitacion_usuario',
    destinatario: { email, nombre: `${p.nombre} ${p.apellido}` },
    tipo_envio: 'AUTH_INVITACION_USUARIO',
    prioridad: 'ALTA',
    bypass_email_bajas: true,
    anti_spam: false,
    enviado_por_usuario_id: admin.id,
    variables_extra: {
      nombre: p.nombre,
      apellido: p.apellido,
      email_invitado: email,
      admin_nombre: `${admin.nombre} ${admin.apellido}`,
      boton_accion: botonHtml,
      url_accion: linkResult.action_link,
    },
  })

  return NextResponse.json({ ok: true, mensaje: 'Invitación reenviada' })
}
