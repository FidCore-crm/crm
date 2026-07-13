import { NextRequest, NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { checkLicenciaActiva } from '@/lib/licencia-guard'
import { eliminarArchivoBiblioteca } from '@/lib/biblioteca-storage'

/**
 * PATCH /api/biblioteca/[id]
 * Body: { carpeta_id?, nombre_archivo? }
 * Mueve el archivo a otra carpeta y/o lo renombra.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }

  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo

  const body = await request.json().catch(() => ({}))
  const patch: any = {}

  if ('carpeta_id' in body) {
    const nueva = body.carpeta_id ?? null
    if (nueva !== null) {
      const supabase = getSupabaseAdmin()
      const { data: c } = await supabase
        .from('biblioteca_carpetas')
        .select('id')
        .eq('id', nueva)
        .maybeSingle()
      if (!c) {
        return NextResponse.json({ ok: false, error: 'Carpeta destino no encontrada' }, { status: 404 })
      }
    }
    patch.carpeta_id = nueva
  }

  if ('nombre_archivo' in body) {
    const nombre = String(body.nombre_archivo ?? '').trim()
    if (!nombre) {
      return NextResponse.json({ ok: false, error: 'El nombre no puede quedar vacío' }, { status: 400 })
    }
    patch.nombre_archivo = nombre.substring(0, 255)
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: 'Sin cambios' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('biblioteca_archivos')
    .update(patch)
    .eq('id', params.id)
    .select('id, carpeta_id, nombre_archivo, ruta, mime_type, tamano_bytes, created_at')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: 'Archivo no encontrado' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, archivo: data })
}

/**
 * DELETE /api/biblioteca/[id]
 * Elimina el archivo físico + fila DB.
 */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }

  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo

  const supabase = getSupabaseAdmin()

  const { data: archivo } = await supabase
    .from('biblioteca_archivos')
    .select('id, ruta')
    .eq('id', params.id)
    .maybeSingle()

  if (!archivo) {
    return NextResponse.json({ ok: false, error: 'Archivo no encontrado' }, { status: 404 })
  }

  // Filesystem primero, DB después (patrón estándar del CRM).
  await eliminarArchivoBiblioteca(archivo.ruta)

  const { error } = await supabase.from('biblioteca_archivos').delete().eq('id', params.id)
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
