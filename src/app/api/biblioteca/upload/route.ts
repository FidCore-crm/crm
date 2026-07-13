import { NextRequest, NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { checkLicenciaActiva } from '@/lib/licencia-guard'
import {
  armarRutaBiblioteca,
  guardarArchivoBiblioteca,
  MIMES_PERMITIDOS,
  TAMANO_MAXIMO_BYTES,
} from '@/lib/biblioteca-storage'
import { randomUUID } from 'crypto'

/**
 * POST /api/biblioteca/upload
 * Sube una imagen a la biblioteca. Multipart form-data:
 * - archivo: File (obligatorio)
 * - carpeta_id: string | null (opcional, default raíz)
 * - nombre_visible: string (opcional, default nombre original)
 */
export async function POST(request: NextRequest) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }

  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 })
  }

  const archivo = formData.get('archivo') as File | null
  const carpeta_id = (formData.get('carpeta_id') as string | null) || null
  const nombre_visible = (formData.get('nombre_visible') as string | null) || null

  if (!archivo) {
    return NextResponse.json({ ok: false, error: 'Falta el archivo' }, { status: 400 })
  }
  if (!MIMES_PERMITIDOS.includes(archivo.type)) {
    return NextResponse.json(
      { ok: false, error: `Formato no permitido. Aceptados: JPG, PNG, GIF, WEBP.` },
      { status: 400 }
    )
  }
  if (archivo.size > TAMANO_MAXIMO_BYTES) {
    return NextResponse.json(
      { ok: false, error: `El archivo supera el máximo permitido (10 MB).` },
      { status: 413 }
    )
  }
  if (archivo.size === 0) {
    return NextResponse.json({ ok: false, error: 'El archivo está vacío' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // Validar carpeta_id si viene.
  if (carpeta_id) {
    const { data: carpeta } = await supabase
      .from('biblioteca_carpetas')
      .select('id')
      .eq('id', carpeta_id)
      .maybeSingle()
    if (!carpeta) {
      return NextResponse.json({ ok: false, error: 'Carpeta no encontrada' }, { status: 404 })
    }
  }

  const uuid = randomUUID()
  const rutaRelativa = armarRutaBiblioteca(uuid, archivo.type)
  const buffer = Buffer.from(await archivo.arrayBuffer())

  try {
    await guardarArchivoBiblioteca(rutaRelativa, buffer)
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: `No se pudo guardar el archivo: ${err.message}` },
      { status: 500 }
    )
  }

  const { data, error } = await supabase
    .from('biblioteca_archivos')
    .insert({
      id: uuid,
      carpeta_id,
      nombre_archivo: nombre_visible?.trim() || archivo.name,
      ruta: rutaRelativa,
      mime_type: archivo.type,
      tamano_bytes: archivo.size,
      subido_por_usuario_id: usuario.id,
    })
    .select('id, carpeta_id, nombre_archivo, ruta, mime_type, tamano_bytes, created_at')
    .single()

  if (error) {
    // Si falla el INSERT, borrar el archivo físico para no dejar basura.
    const { eliminarArchivoBiblioteca } = await import('@/lib/biblioteca-storage')
    await eliminarArchivoBiblioteca(rutaRelativa)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, archivo: data })
}
