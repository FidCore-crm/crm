import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { obtenerUsuarioDesdeRequest, generarLinkAdmin } from '@/lib/auth'
import { ERRORES, respuestaError } from '@/lib/errores'
import { encolarEmail } from '@/lib/comunicaciones-sender'
import { obtenerUrlCRM } from '@/lib/urls-publicas'
import { generarBotonHtml } from '@/lib/email-templates/botones'
import { logger } from '@/lib/errores'

export async function GET(request: Request) {
  const admin = await obtenerUsuarioDesdeRequest(request)
  if (!admin) return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  if (admin.rol !== 'ADMIN') return NextResponse.json({ ok: false, error: 'Sin permisos' }, { status: 403 })

  const supabase = getSupabaseAdmin()

  // Listamos los perfiles del CRM y traemos el email de auth.users via RPC
  const { data: perfiles } = await supabase
    .from('usuarios_perfil')
    .select('id, nombre, apellido, rol, acceso_cartera, activo, ultimo_acceso, intentos_fallidos, bloqueado_hasta, created_at')
    .order('rol', { ascending: false })
    .order('apellido', { ascending: true })

  // Resolver email para cada perfil con admin.listUsers (paginado)
  const emailsPorId = new Map<string, string>()
  let pageActual = 1
  while (true) {
    const { data: pagina } = await supabase.auth.admin.listUsers({ page: pageActual, perPage: 200 })
    const users = pagina?.users ?? []
    for (const u of users) emailsPorId.set(u.id, u.email ?? '')
    if (users.length < 200) break
    pageActual++
    if (pageActual > 50) break // safety
  }

  // Contar clientes asignados por usuario
  const resultado = []
  for (const u of (perfiles ?? []) as any[]) {
    let clientes_asignados = 0
    if (u.acceso_cartera === 'PROPIA') {
      const { count } = await supabase
        .from('personas')
        .select('id', { count: 'exact', head: true })
        .eq('usuario_id', u.id)
      clientes_asignados = count ?? 0
    }
    resultado.push({ ...u, email: emailsPorId.get(u.id) ?? '', clientes_asignados })
  }

  return NextResponse.json({ ok: true, usuarios: resultado })
}

export async function POST(request: Request) {
  const admin = await obtenerUsuarioDesdeRequest(request)
  if (!admin) return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  if (admin.rol !== 'ADMIN') return NextResponse.json({ ok: false, error: 'Sin permisos' }, { status: 403 })

  try {
    const { nombre, apellido, email, rol, acceso_cartera } = await request.json()

    if (!nombre?.trim() || !apellido?.trim() || !email?.trim()) {
      return NextResponse.json({ ok: false, error: 'Todos los campos son obligatorios' }, { status: 400 })
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return NextResponse.json({ ok: false, error: 'El email no tiene formato válido' }, { status: 400 })
    }

    const rolFinal = rol === 'ADMIN' ? 'ADMIN' : 'USUARIO'
    const accesoFinal = rolFinal === 'ADMIN' ? 'TOTAL' : (acceso_cartera === 'TOTAL' ? 'TOTAL' : 'PROPIA')
    const emailNorm = email.toLowerCase().trim()

    const supabase = getSupabaseAdmin()

    // Verificar que el email no exista todavía
    const { data: existeArr } = await supabase.rpc('fn_obtener_perfil_por_email', { p_email: emailNorm })
    if (Array.isArray(existeArr) && existeArr.length > 0) {
      return NextResponse.json({ ok: false, error: 'Ya existe un usuario con ese email' }, { status: 400 })
    }

    // Crear usuario en estado "invitado" (sin password). El usuario lo define
    // al hacer click en el link del email. email_confirm=false porque el flow
    // de invitación lo confirma cuando hace click.
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: emailNorm,
      email_confirm: false,
      user_metadata: {
        nombre: nombre.trim(),
        apellido: apellido.trim(),
        rol: rolFinal,
        acceso_cartera: accesoFinal,
      },
    })

    if (createError || !created?.user) {
      const msg = createError?.message ?? ''
      if (msg.toLowerCase().includes('already')) {
        return NextResponse.json({ ok: false, error: 'Ya existe un usuario con ese email' }, { status: 400 })
      }
      return respuestaError(ERRORES.DB_ERROR_ESCRITURA, { detalle: msg })
    }

    // Asegurar valores correctos en usuarios_perfil. Por ahora marcamos
    // activo=false hasta que acepte la invitación (al setear su password).
    const { data: perfil, error: updErr } = await supabase
      .from('usuarios_perfil')
      .update({ rol: rolFinal, acceso_cartera: accesoFinal, activo: false })
      .eq('id', created.user.id)
      .select('id, nombre, apellido, rol, acceso_cartera, activo, created_at')
      .single()

    if (updErr) {
      // Si falla, deshacer el create de auth.users para no dejar un usuario huérfano
      await supabase.auth.admin.deleteUser(created.user.id).catch(() => {})
      return respuestaError(ERRORES.DB_ERROR_ESCRITURA, { detalle: updErr.message })
    }

    // Generar link de invitación con GoTrue
    const urlCrm = (await obtenerUrlCRM()) ?? new URL(request.url).origin
    const redirectTo = `${urlCrm}/auth/aceptar-invitacion`

    const linkResult = await generarLinkAdmin({
      type: 'invite',
      email: emailNorm,
      redirectTo,
    })

    if (!linkResult.ok) {
      logger.error({
        modulo: 'auth',
        mensaje: 'Error generando link de invitación',
        contexto: { email: emailNorm, error: linkResult.error },
      })
      // No deshacemos: el usuario quedó en estado invitado. El admin puede
      // reintentar la invitación desde la UI (endpoint POST /api/usuarios/[id]/reenviar-invitacion).
      return NextResponse.json({
        ok: true,
        warning: 'Usuario creado pero no se pudo enviar el email de invitación. Reenviá desde la lista de usuarios.',
        usuario: { ...perfil, email: emailNorm },
      })
    }

    // Color de marca para el botón
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

    // Encolar email de invitación
    const enc = await encolarEmail({
      plantilla_codigo: 'auth_invitacion_usuario',
      destinatario: { email: emailNorm, nombre: `${nombre.trim()} ${apellido.trim()}` },
      tipo_envio: 'AUTH_INVITACION_USUARIO',
      prioridad: 'ALTA',
      bypass_email_bajas: true,
      anti_spam: false,
      enviado_por_usuario_id: admin.id,
      variables_extra: {
        nombre: nombre.trim(),
        apellido: apellido.trim(),
        email_invitado: emailNorm,
        admin_nombre: `${admin.nombre} ${admin.apellido}`,
        boton_accion: botonHtml,
        url_accion: linkResult.action_link,
      },
    })

    if (!enc.ok) {
      logger.warn({
        modulo: 'auth',
        mensaje: 'Usuario invitado pero falló encolar email',
        contexto: { email: emailNorm, error: enc.error },
      })
    }

    return NextResponse.json({
      ok: true,
      usuario: { ...perfil, email: emailNorm },
    })
  } catch (e: any) {
    return respuestaError(ERRORES.SYS_ERROR_INTERNO, { detalle: e?.message })
  }
}
