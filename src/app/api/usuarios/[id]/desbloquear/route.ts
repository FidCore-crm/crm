import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const admin = await obtenerUsuarioDesdeRequest(request)
  if (!admin) return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  if (admin.rol !== 'ADMIN') return NextResponse.json({ ok: false, error: 'Sin permisos' }, { status: 403 })

  const supabase = getSupabaseAdmin()

  const { error } = await supabase
    .from('usuarios_perfil')
    .update({ intentos_fallidos: 0, bloqueado_hasta: null })
    .eq('id', params.id)

  if (error) return NextResponse.json({ ok: false, error: 'Error al actualizar los datos' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
