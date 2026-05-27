import { NextRequest } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { ERRORES, respuestaError, respuestaExito, manejarErrores } from '@/lib/errores'

/**
 * GET /api/onboarding/estado
 *
 * Devuelve si el admin de la organización ya completó el wizard de onboarding,
 * y en qué paso se quedó si todavía no terminó.
 *
 * Solo accesible por admins (los usuarios PROPIA no ven el wizard).
 */
export const GET = manejarErrores(async (request: NextRequest) => {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)
  if (usuario.rol !== 'ADMIN') return respuestaError(ERRORES.PERM_SIN_PERMISO)

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('configuracion')
    .select('id, onboarding_completado_at, onboarding_paso_actual')
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`Error leyendo configuración: ${error.message}`)
  }

  // Si todavía no hay fila de configuración, el wizard arranca desde 0
  if (!data) {
    return respuestaExito({
      onboarding_completado: false,
      onboarding_completado_at: null,
      onboarding_paso_actual: 0,
    })
  }

  return respuestaExito({
    onboarding_completado: data.onboarding_completado_at !== null,
    onboarding_completado_at: data.onboarding_completado_at,
    onboarding_paso_actual: data.onboarding_paso_actual ?? 0,
  })
}, { modulo: 'onboarding' })
