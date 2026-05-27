import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { checkLicenciaActiva } from '@/lib/licencia-guard'

const COLORES_VALIDOS = ['amarillo', 'rosa', 'verde', 'azul', 'naranja']

// PATCH — Editar post-it (solo el creador)
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 })

  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo

  const supabase = getSupabaseAdmin()

  const { data: postit } = await supabase.from('postits').select('*').eq('id', params.id).single()
  if (!postit) return NextResponse.json({ ok: false, error: 'Post-it no encontrado' }, { status: 404 })
  if (postit.usuario_id !== usuario.id) {
    return NextResponse.json({ ok: false, error: 'Solo podés editar tus propios post-it.' }, { status: 403 })
  }

  const body = await request.json()
  const updates: Record<string, any> = {}

  if (body.texto !== undefined) {
    if (typeof body.texto !== 'string' || body.texto.trim().length === 0) {
      return NextResponse.json({ ok: false, error: 'El texto es obligatorio' }, { status: 400 })
    }
    if (body.texto.length > 500) {
      return NextResponse.json({ ok: false, error: 'El texto no puede superar los 500 caracteres' }, { status: 400 })
    }
    updates.texto = body.texto.trim()
  }
  if (body.color !== undefined) {
    if (!COLORES_VALIDOS.includes(body.color)) {
      return NextResponse.json({ ok: false, error: 'Color inválido' }, { status: 400 })
    }
    updates.color = body.color
  }
  if (body.compartido !== undefined) {
    updates.compartido = body.compartido
  }

  const { data, error } = await supabase
    .from('postits')
    .update(updates)
    .eq('id', params.id)
    .select('*, usuario:usuarios_perfil!usuario_id (nombre, apellido)')
    .single()

  if (error) return NextResponse.json({ ok: false, error: 'Error al actualizar los datos' }, { status: 500 })

  return NextResponse.json({ ok: true, data })
}

// DELETE — Eliminar post-it (solo el creador)
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 })

  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo

  const supabase = getSupabaseAdmin()

  const { data: postit } = await supabase.from('postits').select('usuario_id').eq('id', params.id).single()
  if (!postit) return NextResponse.json({ ok: false, error: 'Post-it no encontrado' }, { status: 404 })
  if (postit.usuario_id !== usuario.id) {
    return NextResponse.json({ ok: false, error: 'Solo podés eliminar tus propios post-it.' }, { status: 403 })
  }

  const { error } = await supabase.from('postits').delete().eq('id', params.id)
  if (error) return NextResponse.json({ ok: false, error: 'Error al eliminar los datos' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
