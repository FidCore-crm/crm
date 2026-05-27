import { NextRequest } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { ERRORES, respuestaError, respuestaExito, manejarErrores } from '@/lib/errores'

// Mantener sincronizado con `TOTAL_PASOS` en src/app/crm/onboarding/page.tsx.
const TOTAL_PASOS = 7
const ULTIMO_PASO = TOTAL_PASOS - 1

/**
 * PATCH /api/onboarding/progreso
 *
 * Body:
 *   { paso_actual: number }        → guarda en qué paso del wizard está
 *   { completado: true }           → marca el wizard como completado (timestamp NOW)
 *   { paso_actual, completado }    → ambas cosas en una sola llamada
 *
 * Si todavía no existe fila en `configuracion`, la crea con los defaults.
 *
 * Validaciones:
 *   - paso_actual debe estar entre 0 y TOTAL_PASOS-1.
 *   - completado=true solo se acepta si el wizard alcanzó el último paso
 *     (sino sería trivial saltearse el flujo con un curl PATCH).
 */
export const PATCH = manejarErrores(async (request: NextRequest) => {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)
  if (usuario.rol !== 'ADMIN') return respuestaError(ERRORES.PERM_SIN_PERMISO)

  const body = await request.json().catch(() => ({}))
  const paso_actual: number | undefined = body.paso_actual
  const completado: boolean | undefined = body.completado

  if (paso_actual === undefined && completado === undefined) {
    return respuestaError(ERRORES.VALID_CAMPO_REQUERIDO, {
      campos: { body: 'paso_actual o completado requeridos' },
    })
  }

  if (
    paso_actual !== undefined &&
    (typeof paso_actual !== 'number' || paso_actual < 0 || paso_actual > ULTIMO_PASO)
  ) {
    return respuestaError(ERRORES.VALID_CAMPO_REQUERIDO, {
      campos: { paso_actual: `debe estar entre 0 y ${ULTIMO_PASO}` },
    })
  }

  const supabase = getSupabaseAdmin()

  // Buscar fila existente (la tabla es singleton, ver migración 065)
  const { data: actual } = await supabase
    .from('configuracion')
    .select('id, onboarding_paso_actual')
    .limit(1)
    .maybeSingle()

  // Si el caller pide marcar `completado: true`, validamos que el progreso
  // efectivamente esté en el último paso. Sino, un atacante con sesión admin
  // podría completar el wizard sin pasar por la pantalla final.
  if (completado === true) {
    const pasoFinal = (paso_actual ?? (actual as any)?.onboarding_paso_actual ?? 0) as number
    if (pasoFinal < ULTIMO_PASO) {
      return respuestaError(ERRORES.NEG_OPERACION_INVALIDA, {
        detalle: `Aún no completaste todos los pasos del wizard (paso ${pasoFinal} de ${ULTIMO_PASO}).`,
      })
    }
  }

  const patch: Record<string, unknown> = {}
  if (paso_actual !== undefined) patch.onboarding_paso_actual = paso_actual
  if (completado === true) patch.onboarding_completado_at = new Date().toISOString()

  if (actual?.id) {
    const { error } = await supabase
      .from('configuracion')
      .update(patch)
      .eq('id', actual.id)

    if (error) {
      throw new Error(`Error actualizando progreso: ${error.message}`)
    }
  } else {
    // Crear fila inicial con los defaults necesarios
    const { error } = await supabase
      .from('configuracion')
      .insert({
        tipo_operacion: 'INDEPENDIENTE',
        ...patch,
      })

    if (error) {
      throw new Error(`Error creando configuración: ${error.message}`)
    }
  }

  return respuestaExito({ ok: true })
}, { modulo: 'onboarding' })
