import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { obtenerUsuarioDesdeRequest, generarLinkAdmin } from '@/lib/auth'
import { encolarEmail } from '@/lib/comunicaciones-sender'
import { obtenerUrlCRM } from '@/lib/urls-publicas'
import { generarBotonHtml } from '@/lib/email-templates/botones'
import { logger } from '@/lib/errores'

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const admin = await obtenerUsuarioDesdeRequest(request)
  if (!admin) return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  if (admin.rol !== 'ADMIN') return NextResponse.json({ ok: false, error: 'Sin permisos' }, { status: 403 })

  const supabase = getSupabaseAdmin()
  const { id } = params

  const { data: perfil } = await supabase.from('usuarios_perfil').select('*').eq('id', id).single()
  if (!perfil) return NextResponse.json({ ok: false, error: 'Usuario no encontrado' }, { status: 404 })
  const u: any = perfil

  try {
    const body = await request.json()
    const update: any = {}

    if (body.nombre !== undefined) update.nombre = body.nombre.trim()
    if (body.apellido !== undefined) update.apellido = body.apellido.trim()

    // Cambio de email: NO se aplica directamente. Envía un email de
    // confirmación al nuevo email. El cambio efectivo ocurre cuando el
    // usuario hace click en el link (GoTrue lo aplica automáticamente).
    // Hasta entonces, sigue logueando con el email viejo.
    let emailPendienteEnviado = false
    if (body.email !== undefined) {
      const emailNorm = body.email.toLowerCase().trim()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
        return NextResponse.json({ ok: false, error: 'El email no tiene formato válido' }, { status: 400 })
      }

      // Resolver email actual
      const { data: authActual } = await supabase.auth.admin.getUserById(id)
      const emailActual = authActual?.user?.email ?? ''

      // Si es el mismo email, no hacemos nada
      if (emailNorm !== emailActual.toLowerCase()) {
        // Verificar unicidad
        const { data: yaExiste } = await supabase.rpc('fn_obtener_perfil_por_email', { p_email: emailNorm })
        const existeArr = Array.isArray(yaExiste) ? yaExiste : []
        if (existeArr.length > 0 && (existeArr[0] as any).id !== id) {
          return NextResponse.json({ ok: false, error: 'Ya existe un usuario con ese email' }, { status: 400 })
        }

        // Generar link de confirmación con GoTrue (no aplica el cambio aún)
        const urlCrm = (await obtenerUrlCRM()) ?? new URL(request.url).origin
        const redirectTo = `${urlCrm}/auth/email-confirmado`

        const linkResult = await generarLinkAdmin({
          type: 'email_change_new',
          email: emailActual,
          newEmail: emailNorm,
          redirectTo,
        })

        if (!linkResult.ok) {
          logger.error({
            modulo: 'auth',
            mensaje: 'Error generando link de cambio de email',
            contexto: { usuario_id: id, error: linkResult.error },
          })
          return NextResponse.json({ ok: false, error: 'No se pudo generar el link de confirmación' }, { status: 500 })
        }

        const { data: configOrganizacion } = await supabase
          .from('configuracion')
          .select('color_marca')
          .limit(1)
          .maybeSingle()

        const botonHtml = generarBotonHtml({
          url: linkResult.action_link,
          texto: 'Confirmar nuevo email',
          color_marca: (configOrganizacion as any)?.color_marca ?? null,
        })

        await encolarEmail({
          plantilla_codigo: 'auth_confirmacion_email',
          destinatario: { email: emailNorm, nombre: `${u.nombre} ${u.apellido}` },
          tipo_envio: 'AUTH_CONFIRMACION_EMAIL',
          prioridad: 'ALTA',
          bypass_email_bajas: true,
          anti_spam: false,
          variables_extra: {
            nombre: u.nombre,
            apellido: u.apellido,
            email_nuevo: emailNorm,
            email_anterior: emailActual,
            boton_accion: botonHtml,
            url_accion: linkResult.action_link,
          },
        })

        emailPendienteEnviado = true
      }
    }

    // Cambio de rol
    if (body.rol !== undefined && body.rol !== u.rol) {
      if (u.rol === 'ADMIN' && body.rol === 'USUARIO') {
        const { count } = await supabase
          .from('usuarios_perfil')
          .select('id', { count: 'exact', head: true })
          .eq('rol', 'ADMIN')
          .eq('activo', true)
          .neq('id', id)
        if ((count ?? 0) === 0) {
          return NextResponse.json({ ok: false, error: 'No se puede cambiar el rol. Es el último administrador.' }, { status: 400 })
        }
      }
      update.rol = body.rol
      if (body.rol === 'ADMIN') update.acceso_cartera = 'TOTAL'
    }

    // Cambio de acceso a cartera (solo si no es admin)
    if (body.acceso_cartera !== undefined) {
      const rolFinal = update.rol ?? u.rol
      if (rolFinal === 'ADMIN') {
        update.acceso_cartera = 'TOTAL'
      } else {
        update.acceso_cartera = body.acceso_cartera
      }
    }

    // Cambio de estado activo
    if (body.activo !== undefined && body.activo !== u.activo) {
      update.activo = body.activo
      if (!body.activo) {
        // Cerrar todas sus sesiones en GoTrue
        await supabase.auth.admin.signOut(id).catch(() => {})
      }
    }

    if (Object.keys(update).length > 0) {
      const { error } = await supabase
        .from('usuarios_perfil')
        .update(update)
        .eq('id', id)

      if (error) return NextResponse.json({ ok: false, error: 'Error al actualizar los datos' }, { status: 500 })
    }

    // Releer perfil + email para devolver
    const { data: actualizado } = await supabase
      .from('usuarios_perfil')
      .select('id, nombre, apellido, rol, acceso_cartera, activo, ultimo_acceso, intentos_fallidos, bloqueado_hasta, created_at')
      .eq('id', id)
      .single()

    const { data: authUser } = await supabase.auth.admin.getUserById(id)
    const email = authUser?.user?.email ?? u.email ?? ''

    return NextResponse.json({
      ok: true,
      usuario: { ...actualizado, email },
      email_pendiente_confirmacion: emailPendienteEnviado ? body.email : undefined,
      mensaje: emailPendienteEnviado
        ? 'Cambios guardados. Le enviamos un email al nuevo address para que confirme el cambio.'
        : undefined,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'Error interno' }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const admin = await obtenerUsuarioDesdeRequest(request)
  if (!admin) return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  if (admin.rol !== 'ADMIN') return NextResponse.json({ ok: false, error: 'Sin permisos' }, { status: 403 })

  const supabase = getSupabaseAdmin()
  const { id } = params

  const { data: perfil } = await supabase.from('usuarios_perfil').select('id, rol').eq('id', id).single()
  if (!perfil) return NextResponse.json({ ok: false, error: 'Usuario no encontrado' }, { status: 404 })

  if (id === admin.id) {
    return NextResponse.json({ ok: false, error: 'No podés eliminarte a vos mismo' }, { status: 400 })
  }

  if ((perfil as any).rol === 'ADMIN') {
    const { count } = await supabase
      .from('usuarios_perfil')
      .select('id', { count: 'exact', head: true })
      .eq('rol', 'ADMIN')
      .eq('activo', true)
      .neq('id', id)
    if ((count ?? 0) === 0) {
      return NextResponse.json({ ok: false, error: 'No se puede eliminar al último administrador' }, { status: 400 })
    }
  }

  // Verificar registros asignados
  const [{ count: c1 }, { count: c2 }, { count: c3 }, { count: c4 }, { count: c5 }] = await Promise.all([
    supabase.from('personas').select('id', { count: 'exact', head: true }).eq('usuario_id', id),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('usuario_id', id),
    supabase.from('oportunidades').select('id', { count: 'exact', head: true }).eq('usuario_id', id),
    supabase.from('cotizaciones').select('id', { count: 'exact', head: true }).eq('usuario_id', id),
    supabase.from('tareas').select('id', { count: 'exact', head: true }).eq('usuario_id', id),
  ])

  const total = (c1 ?? 0) + (c2 ?? 0) + (c3 ?? 0) + (c4 ?? 0) + (c5 ?? 0)
  if (total > 0) {
    return NextResponse.json({
      ok: false,
      error: `Este usuario tiene ${total} registro(s) asignado(s). Reasignalos antes de eliminar.`,
      detalle: { clientes: c1 ?? 0, leads: c2 ?? 0, oportunidades: c3 ?? 0, cotizaciones: c4 ?? 0, tareas: c5 ?? 0 },
    }, { status: 400 })
  }

  // Eliminar de auth.users (cascade borra usuarios_perfil por la FK)
  const { error } = await supabase.auth.admin.deleteUser(id)

  if (error) return NextResponse.json({ ok: false, error: 'Error al eliminar los datos' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
