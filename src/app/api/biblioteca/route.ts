import { NextRequest, NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'

/**
 * GET /api/biblioteca?carpeta_id=xxx&q=texto&orden=recientes|mas_usados
 * Lista archivos de la biblioteca. Filtra por carpeta y por búsqueda.
 * carpeta_id vacío o "raiz" = archivos en la raíz (carpeta_id IS NULL).
 */
export async function GET(request: NextRequest) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }

  const url = new URL(request.url)
  const carpeta_id = url.searchParams.get('carpeta_id')
  const q = url.searchParams.get('q')?.trim()
  const orden = url.searchParams.get('orden') || 'recientes'

  const supabase = getSupabaseAdmin()
  let query = supabase
    .from('biblioteca_archivos')
    .select('id, carpeta_id, nombre_archivo, ruta, mime_type, tamano_bytes, usos_count, ultimo_uso_at, created_at')

  // Filtro por carpeta:
  //   - null / vacío / 'raiz'  → raíz (carpeta_id IS NULL)
  //   - 'todas'                → sin filtro (todas las carpetas)
  //   - uuid                   → esa carpeta puntual
  if (carpeta_id === 'todas') {
    // sin filtro
  } else if (!carpeta_id || carpeta_id === 'raiz') {
    query = query.is('carpeta_id', null)
  } else {
    query = query.eq('carpeta_id', carpeta_id)
  }

  if (q) {
    query = query.ilike('nombre_archivo', `%${q}%`)
  }

  if (orden === 'mas_usados') {
    query = query.order('usos_count', { ascending: false }).order('ultimo_uso_at', { ascending: false, nullsFirst: false })
  } else {
    query = query.order('created_at', { ascending: false })
  }

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, archivos: data ?? [] })
}
