import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { rutaAbsolutaBiblioteca } from '@/lib/biblioteca-storage'
import { readFile, stat } from 'fs/promises'
import { existsSync } from 'fs'

/**
 * GET /api/biblioteca-publica/[id]/[filename]
 *
 * Endpoint público (sin auth) que sirve las imágenes de la biblioteca para
 * que los clientes de email puedan cargarlas cuando el asegurado abre el
 * correo. La imagen se referencia con <img src="..."> en el HTML del email.
 *
 * Seguridad:
 * - Solo sirve imágenes cuya id existe en biblioteca_archivos.
 * - El `filename` de la URL se ignora funcionalmente (es solo cosmético para
 *   el navegador y trackers de email); el archivo se resuelve por `id`.
 * - Cache agresivo (1 día) para reducir carga en re-lecturas del mismo email.
 * - No expone información sensible del CRM.
 */
export async function GET(_request: NextRequest, { params }: { params: { id: string; filename: string } }) {
  const { id } = params

  // Validar formato UUID mínimo para no gastar query DB en garbage.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return new NextResponse('Not Found', { status: 404 })
  }

  const supabase = getSupabaseAdmin()
  const { data: archivo } = await supabase
    .from('biblioteca_archivos')
    .select('ruta, mime_type')
    .eq('id', id)
    .maybeSingle()

  if (!archivo) {
    return new NextResponse('Not Found', { status: 404 })
  }

  const abs = rutaAbsolutaBiblioteca(archivo.ruta)
  if (!existsSync(abs)) {
    return new NextResponse('Not Found', { status: 404 })
  }

  try {
    const [contenido, info] = await Promise.all([readFile(abs), stat(abs)])
    return new NextResponse(contenido, {
      status: 200,
      headers: {
        'Content-Type': archivo.mime_type,
        'Content-Length': String(info.size),
        // Cache 1 día — las imágenes son inmutables (nueva subida = uuid nuevo).
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    })
  } catch {
    return new NextResponse('Not Found', { status: 404 })
  }
}
