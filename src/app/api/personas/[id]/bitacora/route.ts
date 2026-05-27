import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import {
  ERRORES,
  manejarErrores,
  respuestaError,
  respuestaExito,
} from '@/lib/errores'
import { tieneAccesoTotal } from '@/lib/cartera-filter'

/**
 * Lista los eventos de la bitácora de una persona, ordenados por fecha
 * descendente. Devuelve también el nombre del usuario que disparó cada evento.
 */
export const GET = manejarErrores(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)

  const supabase = getSupabaseAdmin()

  // Verificar que la persona existe y el usuario tiene acceso por cartera.
  const { data: persona, error: errSel } = await supabase
    .from('personas')
    .select('id, usuario_id')
    .eq('id', id)
    .single()
  if (errSel || !persona) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)

  if (!tieneAccesoTotal(usuario) && (persona as any).usuario_id && (persona as any).usuario_id !== usuario.id) {
    return respuestaError(ERRORES.PERM_RECURSO_AJENO)
  }

  const { data: eventos, error } = await supabase
    .from('persona_bitacora')
    .select(`
      id, tipo_evento, estado_anterior, estado_nuevo,
      campos_modificados, motivo, observaciones, created_at,
      usuario:usuarios_perfil!usuario_id(id, nombre, apellido)
    `)
    .eq('persona_id', id)
    .order('created_at', { ascending: false })

  if (error) {
    return respuestaError(ERRORES.DB_NO_DISPONIBLE)
  }

  return respuestaExito({ eventos: eventos ?? [] })
}, { modulo: 'personas' })
