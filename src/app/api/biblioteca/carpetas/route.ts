import { NextRequest, NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { checkLicenciaActiva } from '@/lib/licencia-guard'

/**
 * GET /api/biblioteca/carpetas
 * Lista TODAS las carpetas de la biblioteca. Devuelve array plano —
 * el cliente arma el árbol por parent_id.
 */
export async function GET(request: NextRequest) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('biblioteca_carpetas')
    .select('id, nombre, parent_id, orden, created_at')
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true })

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, carpetas: data ?? [] })
}

/**
 * POST /api/biblioteca/carpetas
 * Crea una carpeta nueva. Body: { nombre, parent_id? }
 */
export async function POST(request: NextRequest) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }

  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo

  const body = await request.json().catch(() => ({}))
  const nombre = String(body.nombre ?? '').trim()
  const parent_id = body.parent_id ?? null

  if (!nombre) {
    return NextResponse.json({ ok: false, error: 'El nombre es obligatorio' }, { status: 400 })
  }
  if (nombre.length > 120) {
    return NextResponse.json({ ok: false, error: 'El nombre no puede superar 120 caracteres' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // Verificar que el parent exista si viene.
  if (parent_id) {
    const { data: parent } = await supabase
      .from('biblioteca_carpetas')
      .select('id')
      .eq('id', parent_id)
      .maybeSingle()
    if (!parent) {
      return NextResponse.json({ ok: false, error: 'Carpeta padre no encontrada' }, { status: 404 })
    }
  }

  const { data, error } = await supabase
    .from('biblioteca_carpetas')
    .insert({
      nombre,
      parent_id,
      creado_por_usuario_id: usuario.id,
    })
    .select('id, nombre, parent_id, orden, created_at')
    .single()

  if (error) {
    // El índice UNIQUE atrapa duplicados por nombre en el mismo nivel.
    if (error.code === '23505') {
      return NextResponse.json(
        { ok: false, error: 'Ya existe una carpeta con ese nombre en este nivel' },
        { status: 409 }
      )
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, carpeta: data })
}
