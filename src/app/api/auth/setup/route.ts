import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { loginConSupabase } from '@/lib/auth'
import { setearCookiesSesion } from '@/lib/auth/cookie-options'

/**
 * Setup inicial: crea el primer admin del CRM cuando la base está vacía.
 * Usa la admin API de GoTrue para crear el usuario en auth.users.
 * El trigger fn_crear_usuarios_perfil de la migración 055 se encarga de
 * crear la fila en usuarios_perfil automáticamente.
 */
export async function POST(request: Request) {
  try {
    const supabase = getSupabaseAdmin()

    // Verificar que no existan perfiles activos
    const { count } = await supabase
      .from('usuarios_perfil')
      .select('id', { count: 'exact', head: true })
      .eq('activo', true)

    if ((count ?? 0) > 0) {
      return NextResponse.json({ ok: false, error: 'El sistema ya fue configurado.' }, { status: 403 })
    }

    const { nombre, apellido, email, password } = await request.json()

    if (!nombre?.trim() || !apellido?.trim() || !email?.trim() || !password) {
      return NextResponse.json({ ok: false, error: 'Todos los campos son obligatorios' }, { status: 400 })
    }

    if (password.length < 6) {
      return NextResponse.json({ ok: false, error: 'La contraseña debe tener al menos 6 caracteres' }, { status: 400 })
    }

    // Crear usuario en auth.users via admin API (GoTrue hashea con bcrypt internamente)
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: email.toLowerCase().trim(),
      password,
      email_confirm: true,
      user_metadata: {
        nombre: nombre.trim(),
        apellido: apellido.trim(),
        rol: 'ADMIN',
        acceso_cartera: 'TOTAL',
      },
    })

    if (createError || !created?.user) {
      return NextResponse.json({ ok: false, error: createError?.message ?? 'Error al crear usuario' }, { status: 500 })
    }

    // El trigger crea usuarios_perfil automáticamente, pero le seteamos
    // los valores correctos de rol y acceso_cartera (por las dudas)
    await supabase
      .from('usuarios_perfil')
      .update({ rol: 'ADMIN', acceso_cartera: 'TOTAL' })
      .eq('id', created.user.id)

    // Login automático
    const login = await loginConSupabase(email, password)
    if (!login.ok) {
      return NextResponse.json({ ok: false, error: 'Usuario creado pero login falló' }, { status: 500 })
    }

    const response = NextResponse.json({
      ok: true,
      usuario: {
        id: created.user.id,
        nombre: nombre.trim(),
        apellido: apellido.trim(),
        email: email.toLowerCase().trim(),
        rol: 'ADMIN',
        acceso_cartera: 'TOTAL',
      },
    })

    setearCookiesSesion(response, request, {
      access_token: login.sesion.access_token,
      refresh_token: login.sesion.refresh_token,
    })

    return response
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'Error interno del servidor' }, { status: 500 })
  }
}
