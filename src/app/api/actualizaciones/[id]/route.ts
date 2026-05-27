/**
 * GET /api/actualizaciones/[id]
 *
 * Detalle completo de una actualización: incluye changelog y log_completo
 * para el modal de detalle en el historial.
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

export const GET = manejarErrores(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)
  if (usuario.rol !== 'ADMIN') return respuestaError(ERRORES.PERM_SIN_PERMISO)

  const { id } = await params
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    return respuestaError(ERRORES.VALID_FORMATO_INVALIDO, { campos: { id: 'UUID inválido' } })
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('actualizaciones')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    return respuestaError(ERRORES.DB_NO_DISPONIBLE, { detalle: error.message })
  }
  if (!data) {
    return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)
  }

  return respuestaExito(data)
}, { modulo: 'actualizaciones' })
