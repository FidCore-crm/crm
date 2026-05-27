/**
 * GET /api/actualizaciones/historial
 *
 * Lista de actualizaciones aplicadas, con paginación.
 *
 * Query params:
 *   - pagina  (0-based, default 0)
 *   - tamanio (default 20, max 100)
 *
 * Admin-only.
 */

import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import {
  respuestaError,
  respuestaExito,
  manejarErrores,
  ERRORES,
} from '@/lib/errores'

export const dynamic = 'force-dynamic'

export const GET = manejarErrores(async (request: Request) => {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)
  if (usuario.rol !== 'ADMIN') return respuestaError(ERRORES.PERM_SIN_PERMISO)

  const url = new URL(request.url)
  const pagina = Math.max(0, parseInt(url.searchParams.get('pagina') ?? '0', 10))
  const tamanio = Math.min(100, Math.max(1, parseInt(url.searchParams.get('tamanio') ?? '20', 10)))
  const desde = pagina * tamanio
  const hasta = desde + tamanio - 1

  const supabase = getSupabaseAdmin()
  const { data, count, error } = await supabase
    .from('actualizaciones')
    .select(
      'id, version_anterior, version_nueva, estado, programada_para, fecha_solicitud, fecha_inicio_ejecucion, fecha_fin_ejecucion, error_mensaje, solicitada_por_usuario_id, cancelada_por_usuario_id, created_at',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(desde, hasta)

  if (error) {
    return respuestaError(ERRORES.DB_NO_DISPONIBLE, { detalle: error.message })
  }

  return respuestaExito({
    data: data ?? [],
    total: count ?? 0,
    pagina,
    tamanio,
  })
}, { modulo: 'actualizaciones' })
