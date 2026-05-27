import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import {
  ERRORES,
  ErrorAplicacion,
  manejarErrores,
  respuestaError,
  respuestaExito,
} from '@/lib/errores'
import { tieneAccesoTotal } from '@/lib/cartera-filter'
import { registrarEventoBitacoraPersona } from '@/lib/bitacora-persona'
import { requireLicenciaActiva } from '@/lib/licencia-guard'

/**
 * Restaura una persona que está en la papelera (deleted_at != null).
 * Limpia deleted_at y deleted_by_usuario_id, y registra evento RESTAURACION
 * en la bitácora.
 */
export const POST = manejarErrores(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)
  await requireLicenciaActiva()

  const supabase = getSupabaseAdmin()

  const { data: persona, error } = await supabase
    .from('personas')
    .select('id, usuario_id, deleted_at, estado')
    .eq('id', id)
    .single()

  if (error || !persona) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)

  if (!(persona as any).deleted_at) {
    return respuestaError(ERRORES.NEG_OPERACION_INVALIDA, {
      detalle: 'La persona no está en la papelera',
    })
  }

  // Filtro de cartera: si no tiene acceso total, solo puede restaurar sus propias.
  if (!tieneAccesoTotal(usuario) && (persona as any).usuario_id && (persona as any).usuario_id !== usuario.id) {
    return respuestaError(ERRORES.PERM_RECURSO_AJENO)
  }

  const { error: errUpdate } = await supabase
    .from('personas')
    .update({ deleted_at: null, deleted_by_usuario_id: null })
    .eq('id', id)

  if (errUpdate) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
      detalle: errUpdate.message,
      contexto: { tabla: 'personas', operacion: 'restaurar', id },
    })
  }

  await registrarEventoBitacoraPersona(supabase, {
    persona_id: id,
    tipo_evento: 'RESTAURACION',
    estado_nuevo: (persona as any).estado,
    usuario_id: usuario.id,
  })

  return respuestaExito({ restaurada: true })
}, { modulo: 'personas' })
