import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const admin = await obtenerUsuarioDesdeRequest(request)
  if (!admin) return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  if (admin.rol !== 'ADMIN') return NextResponse.json({ ok: false, error: 'Sin permisos' }, { status: 403 })

  const supabase = getSupabaseAdmin()
  const { id } = params

  const { data: perfil } = await supabase.from('usuarios_perfil').select('id').eq('id', id).single()
  if (!perfil) return NextResponse.json({ ok: false, error: 'Usuario no encontrado' }, { status: 404 })

  try {
    const { password } = await request.json()

    if (!password || password.length < 6) {
      return NextResponse.json({ ok: false, error: 'La contraseña debe tener al menos 6 caracteres' }, { status: 400 })
    }

    // Actualizar via admin API de GoTrue (hace el bcrypt internamente)
    const { error } = await supabase.auth.admin.updateUserById(id, { password })

    if (error) return NextResponse.json({ ok: false, error: 'Error al actualizar los datos' }, { status: 500 })

    // Invalidar sesiones activas del usuario (defensivo)
    await supabase.auth.admin.signOut(id).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'Error interno' }, { status: 500 })
  }
}
