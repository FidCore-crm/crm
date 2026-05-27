import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { ERRORES, respuestaError } from '@/lib/errores'

export const dynamic = 'force-dynamic'

/**
 * GET /api/errores-sistema
 *
 * Listado de errores persistidos (solo ADMIN).
 *
 * Query params:
 *  - modulo: filtrar por módulo
 *  - codigo: filtrar por código ERR_*
 *  - desde: ISO timestamp — ultima_aparicion >= desde
 *  - hasta: ISO timestamp — ultima_aparicion <= hasta
 *  - incluir_archivados: 'true' para incluir archivados (default false)
 *  - limite: default 200
 */
export async function GET(request: Request) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  const url = new URL(request.url)
  const modulo = url.searchParams.get('modulo')
  const codigo = url.searchParams.get('codigo')
  const desde = url.searchParams.get('desde')
  const hasta = url.searchParams.get('hasta')
  const incluirArchivados = url.searchParams.get('incluir_archivados') === 'true'
  const limite = Math.min(parseInt(url.searchParams.get('limite') || '200', 10) || 200, 500)

  const supabase = getSupabaseAdmin()

  let query = supabase
    .from('errores_sistema')
    .select('*')
    .order('ultima_aparicion', { ascending: false })
    .limit(limite)

  if (!incluirArchivados) query = query.eq('archivado', false)
  if (modulo) query = query.eq('modulo', modulo)
  if (codigo) query = query.eq('codigo', codigo)
  if (desde) query = query.gte('ultima_aparicion', desde)
  if (hasta) query = query.lte('ultima_aparicion', hasta)

  const { data, error } = await query

  if (error) {
    return respuestaError(ERRORES.DB_ERROR_ESCRITURA, { detalle: error.message })
  }

  // Módulos y códigos distintos (para dropdowns de filtros)
  const { data: modulosData } = await supabase
    .from('errores_sistema')
    .select('modulo, codigo')
    .eq('archivado', false)
    .limit(2000)

  const modulos = Array.from(
    new Set(((modulosData as Array<{ modulo: string | null }>) || []).map((r) => r.modulo).filter(Boolean) as string[]),
  ).sort()
  const codigos = Array.from(
    new Set(((modulosData as Array<{ codigo: string }>) || []).map((r) => r.codigo).filter(Boolean)),
  ).sort()

  return NextResponse.json({
    ok: true,
    data: {
      errores: data || [],
      modulos,
      codigos,
      total: (data || []).length,
    },
  })
}
