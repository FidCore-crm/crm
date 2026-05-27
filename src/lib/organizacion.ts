/**
 * Helper para obtener el nombre legible de la organización.
 *
 * Se usa para etiquetar errores en Sentry con un nombre humano (además del
 * `instalacion_id` opaco) y permitir filtrar por cliente desde el dashboard
 * sin mapeo externo.
 *
 * Cache en memoria con TTL de 10 minutos. Un fetch por cada error crítico
 * sería innecesario — el nombre cambia muy poco (lo configura el PAS una
 * vez al instalar y rara vez lo edita después).
 *
 * Fail-soft: si la DB no responde o `configuracion` está vacía, devuelve
 * `null`. El caller debe manejar el fallback.
 */

import { getSupabaseAdmin } from '@/lib/supabase/server'

const TTL_MS = 10 * 60 * 1000

interface CacheEntry {
  nombre: string | null
  expira_en: number
}

let cache: CacheEntry | null = null

export async function obtenerNombreOrganizacion(): Promise<string | null> {
  const ahora = Date.now()
  if (cache && cache.expira_en > ahora) {
    return cache.nombre
  }

  try {
    const supabase = getSupabaseAdmin()
    const { data } = await supabase
      .from('configuracion')
      .select('nombre')
      .limit(1)
      .maybeSingle()
    const nombre =
      (data as { nombre?: string | null } | null)?.nombre?.trim() || null
    cache = { nombre, expira_en: ahora + TTL_MS }
    return nombre
  } catch {
    cache = { nombre: null, expira_en: ahora + TTL_MS }
    return null
  }
}

/** Forzar invalidación del cache (útil tras un PATCH al perfil). */
export function invalidarCacheOrganizacion(): void {
  cache = null
}
