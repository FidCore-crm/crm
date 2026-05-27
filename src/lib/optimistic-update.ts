'use client'

/**
 * Helper para hacer updates con optimistic concurrency check desde el cliente
 * browser. Para tablas que NO tienen un endpoint PATCH (#81).
 *
 * Cómo funciona:
 *   1. Recibe `id` + `updated_at_inicial` (capturado al cargar la ficha) +
 *      `cambios` (el patch).
 *   2. Hace UPDATE con WHERE doble: `id=$id AND updated_at=$updated_at_inicial`.
 *   3. Si nadie modificó la fila entre nuestra carga y nuestro save, el WHERE
 *      matchea y `data` vuelve con la fila actualizada.
 *   4. Si otro usuario modificó la fila, el `updated_at` cambió, el WHERE
 *      no matchea, y `data` viene vacío → cargamos el estado actual y
 *      devolvemos `conflicto: true, registro_actual`.
 *
 * Garantiza atomicidad sin transacciones explícitas — Postgres evalúa el WHERE
 * antes de aplicar el UPDATE.
 *
 * El trigger `tg_actualizar_updated_at` (migración 052) se dispara con cada
 * UPDATE exitoso, así que el `updated_at` siempre cambia tras un save real.
 */

import { getSupabaseClient } from '@/lib/supabase/client'

export interface ResultadoUpdateOptimistic<T = any> {
  ok: boolean
  conflicto?: boolean
  registro_actual?: T
  registro_actualizado?: T
  error?: string
}

export async function actualizarConOptimistic<T = any>(params: {
  tabla: string
  id: string
  cambios: Record<string, any>
  updated_at_inicial: string | null
  /** Columnas a devolver tras el UPDATE. Default `*`. */
  select?: string
  /** Si true, saltea el check y hace UPDATE sin el filtro de updated_at. */
  forzar?: boolean
}): Promise<ResultadoUpdateOptimistic<T>> {
  const supabase = getSupabaseClient()
  const { tabla, id, cambios, updated_at_inicial, select = '*', forzar = false } = params

  let query = supabase.from(tabla).update(cambios).eq('id', id)
  if (updated_at_inicial && !forzar) {
    query = query.eq('updated_at', updated_at_inicial)
  }

  const { data, error } = await query.select(select)

  if (error) {
    return { ok: false, error: error.message }
  }

  // data vacío significa que el WHERE doble no matchó → conflicto
  if (!data || (Array.isArray(data) && data.length === 0)) {
    // Cargar estado actual de la DB para mostrar diff
    const { data: actual } = await supabase
      .from(tabla)
      .select(select)
      .eq('id', id)
      .single()

    return {
      ok: false,
      conflicto: true,
      registro_actual: actual as unknown as T,
    }
  }

  const updated = Array.isArray(data) ? data[0] : data
  return { ok: true, registro_actualizado: updated as unknown as T }
}
