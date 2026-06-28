import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireAdmin } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import {
  manejarErrores,
  respuestaExito,
  respuestaError,
  ERRORES,
} from '@/lib/errores'
import { todosLosIds } from '@/lib/dashboard-graficos'

/**
 * GET — devuelve la lista de IDs de gráficos visibles configurada por el PAS.
 *
 * - `null` (default) → todos los gráficos visibles.
 * - `[]`             → ninguno visible.
 * - `[...]`          → solo esos IDs son visibles.
 */
export const GET = manejarErrores(
  async (request: NextRequest) => {
    const auth = await requireAuth(request)
    if (auth instanceof NextResponse) return auth

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('configuracion')
      .select('dashboard_graficos_visibles')
      .limit(1)
      .maybeSingle()

    if (error) {
      return respuestaError(ERRORES.DB_NO_DISPONIBLE, {
        detalle: error.message,
        contexto: { tabla: 'configuracion' },
      })
    }

    const visibles = (data as any)?.dashboard_graficos_visibles ?? null
    return respuestaExito({ visibles })
  },
  { modulo: 'configuracion' },
)

/**
 * PATCH — actualiza la lista de gráficos visibles.
 *
 * Body: `{ visibles: string[] | null }`
 *   - `null`  → reset a "todos visibles".
 *   - `[]`    → ninguno visible.
 *   - `[...]` → lista explícita de IDs.
 *
 * Solo admin.
 */
export const PATCH = manejarErrores(
  async (request: NextRequest) => {
    const auth = await requireAdmin(request)
    if (auth instanceof NextResponse) return auth

    let body: any
    try {
      body = await request.json()
    } catch {
      return respuestaError(ERRORES.VALID_FORMATO_INVALIDO, {
        detalle: 'Body inválido',
      })
    }

    const visibles = body?.visibles
    if (visibles !== null && !Array.isArray(visibles)) {
      return respuestaError(ERRORES.VALID_CAMPO_REQUERIDO, {
        campos: { visibles: 'Debe ser un array de IDs o null' },
      })
    }

    // Si vino array: filtrar a solo IDs válidos (defensive — un ID viejo de
    // un gráfico eliminado simplemente se descarta).
    let payloadVisibles: string[] | null = null
    if (Array.isArray(visibles)) {
      const ids = todosLosIds()
      payloadVisibles = (visibles as unknown[])
        .filter((v): v is string => typeof v === 'string' && ids.includes(v))
    }

    const supabase = getSupabaseAdmin()
    const { data: config } = await supabase
      .from('configuracion')
      .select('id')
      .limit(1)
      .maybeSingle()

    if (config?.id) {
      const { error } = await supabase
        .from('configuracion')
        .update({ dashboard_graficos_visibles: payloadVisibles } as any)
        .eq('id', (config as any).id)
      if (error) {
        return respuestaError(ERRORES.DB_ERROR_ESCRITURA, {
          detalle: error.message,
          contexto: { tabla: 'configuracion' },
        })
      }
    } else {
      const { error } = await supabase
        .from('configuracion')
        .insert({ dashboard_graficos_visibles: payloadVisibles } as any)
      if (error) {
        return respuestaError(ERRORES.DB_ERROR_ESCRITURA, {
          detalle: error.message,
          contexto: { tabla: 'configuracion' },
        })
      }
    }

    return respuestaExito({ visibles: payloadVisibles })
  },
  { modulo: 'configuracion' },
)
