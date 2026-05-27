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
 * Lista los eventos de bitácora de un siniestro, ordenados por fecha
 * descendente. Aplica el filtro de cartera (PROPIA solo ve los suyos).
 */
export const GET = manejarErrores(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params

  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)

  const supabase = getSupabaseAdmin()

  const { data: siniestro, error: errSel } = await supabase
    .from('siniestros')
    .select('id, persona_id, deleted_at')
    .eq('id', id)
    .is('deleted_at', null)
    .single()
  if (errSel || !siniestro) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)

  if (!tieneAccesoTotal(usuario)) {
    const { data: persona } = await supabase
      .from('personas')
      .select('usuario_id')
      .eq('id', (siniestro as any).persona_id)
      .single()
    if (persona && (persona as any).usuario_id && (persona as any).usuario_id !== usuario.id) {
      return respuestaError(ERRORES.PERM_RECURSO_AJENO)
    }
  }

  const { data: eventos, error } = await supabase
    .from('siniestro_bitacora')
    .select(`
      id, tipo, texto, estado_anterior, estado_nuevo, monto_actualizado,
      campos_modificados, created_at,
      usuario:usuarios_perfil!usuario_id(id, nombre, apellido)
    `)
    .eq('siniestro_id', id)
    .order('created_at', { ascending: false })

  if (error) {
    return respuestaError(ERRORES.DB_NO_DISPONIBLE)
  }

  return respuestaExito({ eventos: eventos ?? [] })
}, { modulo: 'siniestros' })
