// Estado del servicio (SaaS-managed) — solo aplica en modo VPS.
//
// Filosofía:
//   En modo APPLIANCE, este módulo no bloquea nada. El sistema de licencias
//   sigue haciendo su trabajo.
//   En modo VPS, el flag `estado_servicio` de `configuracion` es la fuente
//   de verdad de si el PAS puede o no acceder al CRM. Se maneja desde el
//   panel de administración (o via curl con el SOPORTE_TOKEN) — no desde el
//   propio CRM.
//
// Cache: 60s en memoria para evitar martillar la DB en cada request. Igual
// patrón que el módulo de licencia. Se invalida cuando el endpoint de
// soporte cambia el estado.

import { getSupabaseAdmin } from './supabase/server'
import { esModoVps } from './modo-instalacion'

export type EstadoServicio = 'ACTIVO' | 'SUSPENDIDO'

export interface EstadoServicioActual {
  estado: EstadoServicio
  motivo: string | null
  fecha_suspension: string | null
}

const TTL_MS = 60_000
let cache: { data: EstadoServicioActual; expira: number } | null = null

/**
 * Devuelve el estado del servicio con cache 60s. En modo APPLIANCE siempre
 * devuelve ACTIVO sin consultar DB.
 */
export async function obtenerEstadoServicio(): Promise<EstadoServicioActual> {
  if (!esModoVps()) {
    return { estado: 'ACTIVO', motivo: null, fecha_suspension: null }
  }

  const ahora = Date.now()
  if (cache && cache.expira > ahora) return cache.data

  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('configuracion')
    .select('estado_servicio, motivo_suspension, fecha_suspension')
    .limit(1)
    .maybeSingle()

  const fila = (data ?? {}) as any
  const resultado: EstadoServicioActual = {
    estado: fila.estado_servicio === 'SUSPENDIDO' ? 'SUSPENDIDO' : 'ACTIVO',
    motivo: fila.motivo_suspension ?? null,
    fecha_suspension: fila.fecha_suspension ?? null,
  }

  cache = { data: resultado, expira: ahora + TTL_MS }
  return resultado
}

/** Fuerza refetch en la próxima llamada. Se llama al cambiar el estado. */
export function invalidarCacheEstadoServicio(): void {
  cache = null
}

/**
 * Actualiza el estado del servicio. Solo el endpoint /api/soporte lo usa.
 * En modo APPLIANCE devuelve error — no debe llamarse.
 */
export async function actualizarEstadoServicio(
  nuevoEstado: EstadoServicio,
  motivo: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!esModoVps()) {
    return { ok: false, error: 'Estado de servicio solo aplica en modo VPS' }
  }

  const supabase = getSupabaseAdmin()
  const { data: cfg } = await supabase
    .from('configuracion')
    .select('id')
    .limit(1)
    .maybeSingle()

  if (!cfg?.id) return { ok: false, error: 'No existe configuración' }

  const patch: any = {
    estado_servicio: nuevoEstado,
    motivo_suspension: motivo,
  }
  if (nuevoEstado === 'SUSPENDIDO') {
    patch.fecha_suspension = new Date().toISOString()
  } else {
    patch.fecha_suspension = null
  }

  const { error } = await supabase
    .from('configuracion')
    .update(patch)
    .eq('id', (cfg as any).id)

  if (error) return { ok: false, error: error.message }

  invalidarCacheEstadoServicio()
  return { ok: true }
}

/** True si el servicio está actualmente suspendido. Solo tiene efecto en VPS. */
export async function esServicioSuspendido(): Promise<boolean> {
  const est = await obtenerEstadoServicio()
  return est.estado === 'SUSPENDIDO'
}
