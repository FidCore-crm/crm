/**
 * DELETE /api/licencia/[id]
 *
 * Elimina una licencia. Solo admin.
 *
 * Reglas:
 *   - No se puede eliminar la licencia ACTIVA (forzaría modo solo lectura — pedir
 *     que cargue otra primero o usar una ENCOLADA).
 *   - Sí se pueden eliminar ENCOLADAS, EXPIRADAS, REEMPLAZADAS (limpieza de histórico).
 */

import type { NextRequest } from 'next/server'
import { manejarErrores, respuestaExito, respuestaError, ERRORES, ErrorAplicacion } from '@/lib/errores'
import { requireAdmin } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { invalidarCacheEstado } from '@/lib/licencia'

export const DELETE = manejarErrores(async (
  request: NextRequest,
  { params }: { params: { id: string } },
) => {
  const auth = await requireAdmin(request)
  if (auth instanceof Response) {
    return respuestaError(ERRORES.PERM_SIN_PERMISO)
  }

  const supabase = getSupabaseAdmin()

  const { data: lic, error: errSel } = await supabase
    .from('licencias')
    .select('id, estado')
    .eq('id', params.id)
    .single()

  if (errSel || !lic) {
    return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)
  }

  if (lic.estado === 'ACTIVA') {
    throw new ErrorAplicacion(ERRORES.NEG_OPERACION_INVALIDA, {
      detalle: 'No se puede eliminar la licencia activa. Cargá otra licencia primero.',
    })
  }

  const { error } = await supabase.from('licencias').delete().eq('id', params.id)

  if (error) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
      detalle: error.message,
    })
  }

  invalidarCacheEstado()

  return respuestaExito({ eliminada: true })
}, { modulo: 'licencia' })
