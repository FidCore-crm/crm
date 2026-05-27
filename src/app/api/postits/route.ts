import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { checkLicenciaActiva } from '@/lib/licencia-guard'

const COLORES_VALIDOS = ['amarillo', 'rosa', 'verde', 'azul', 'naranja']

// GET — Listar post-it visibles para el usuario logueado
export async function GET(request: NextRequest) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 })

  const supabase = getSupabaseAdmin()

  // Los post-it persisten hasta que el usuario los elimine manualmente.
  // Antes había una limpieza automática a los 7 días — se quitó por pedido
  // del PAS (las notas largas como recordatorios anuales se perdían).
  const { data, error } = await supabase
    .from('postits')
    .select('*, usuario:usuarios_perfil!usuario_id (nombre, apellido)')
    .or(`usuario_id.eq.${usuario.id},compartido.eq.true`)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ ok: false, error: 'Error al obtener los datos' }, { status: 500 })

  return NextResponse.json({ ok: true, data })
}

// POST — Crear post-it
export async function POST(request: NextRequest) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 })

  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo

  const body = await request.json()
  const { texto, color, compartido } = body

  if (!texto || typeof texto !== 'string' || texto.trim().length === 0) {
    return NextResponse.json({ ok: false, error: 'El texto es obligatorio' }, { status: 400 })
  }
  if (texto.length > 500) {
    return NextResponse.json({ ok: false, error: 'El texto no puede superar los 500 caracteres' }, { status: 400 })
  }
  if (color && !COLORES_VALIDOS.includes(color)) {
    return NextResponse.json({ ok: false, error: 'Color inválido' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from('postits')
    .insert({
      usuario_id: usuario.id,
      texto: texto.trim(),
      color: color || 'amarillo',
      compartido: compartido ?? false,
    })
    .select('*, usuario:usuarios_perfil!usuario_id (nombre, apellido)')
    .single()

  if (error) return NextResponse.json({ ok: false, error: 'Error al guardar los datos' }, { status: 500 })

  return NextResponse.json({ ok: true, data })
}
