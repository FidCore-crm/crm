/**
 * GET /api/licencia/historial
 *
 * Devuelve el histórico completo de licencias (incluyendo expiradas/reemplazadas).
 * Solo admin.
 */

import type { NextRequest } from 'next/server'
import { manejarErrores, respuestaExito, respuestaError, ERRORES, ErrorAplicacion } from '@/lib/errores'
import { requireAdmin } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'

export const GET = manejarErrores(async (request: NextRequest) => {
  const auth = await requireAdmin(request)
  if (auth instanceof Response) {
    return respuestaError(ERRORES.PERM_SIN_PERMISO)
  }

  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from('licencias')
    .select(`
      id, cliente, razon_social, plan, fecha_inicio, fecha_vencimiento,
      fecha_emision, notas, estado, fecha_carga
    `)
    .order('fecha_carga', { ascending: false })
    .limit(100)

  if (error) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
      detalle: error.message,
    })
  }

  return respuestaExito({ licencias: data ?? [] })
}, { modulo: 'licencia' })
