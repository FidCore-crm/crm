import { NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { manejarErrores, respuestaExito, respuestaError, ERRORES } from '@/lib/errores'

/**
 * PATCH /api/usuarios/me/preferencias
 *
 * Actualiza preferencias individuales del usuario logueado (no requieren
 * permisos admin — cada usuario controla sus propias preferencias).
 *
 * Body: { mostrar_ayuda_contextual?: boolean }
 */
export const PATCH = manejarErrores(async (request: Request) => {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) {
    return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return respuestaError(ERRORES.VALID_CAMPO_REQUERIDO, { detalle: 'Body inválido' })
  }

  const update: Record<string, any> = {}
  if (typeof body.mostrar_ayuda_contextual === 'boolean') {
    update.mostrar_ayuda_contextual = body.mostrar_ayuda_contextual
  }

  if (Object.keys(update).length === 0) {
    return respuestaError(ERRORES.VALID_CAMPO_REQUERIDO, {
      detalle: 'No hay preferencias válidas en el body',
    })
  }

  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('usuarios_perfil')
    .update(update)
    .eq('id', usuario.id)

  if (error) {
    return respuestaError(ERRORES.DB_ERROR_ESCRITURA, { detalle: error.message })
  }

  return respuestaExito({ preferencias: update })
}, { modulo: 'usuarios' })
