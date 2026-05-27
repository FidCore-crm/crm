import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import {
  listarCacheModelos,
  refrescarCacheModelos,
  isAnthropicConfigured,
} from '@/lib/anthropic-client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/configuracion/anthropic/modelos-disponibles
 *
 * Devuelve la lista de modelos vigentes según el cache local
 * (anthropic_modelos_cache). Si el cache está vacío o tiene >7 días,
 * intenta refrescarlo desde Anthropic antes de responder.
 *
 * La UI de /crm/configuracion/agente-ia usa este endpoint para mostrar
 * al admin qué modelo resuelve cada familia (sonnet/opus/haiku) al día
 * de hoy, sin tener lista hardcodeada.
 *
 * Admin-only.
 */
export async function GET(request: Request) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  if (!(await isAnthropicConfigured())) {
    return NextResponse.json({
      ok: true,
      configurada: false,
      modelos: [],
      mensaje: 'La API key no está configurada. No hay cache disponible.',
    })
  }

  let modelos = await listarCacheModelos()
  const STALE_MS = 7 * 24 * 60 * 60 * 1000
  const cacheStale =
    modelos.length === 0 ||
    modelos.every(
      (m) => Date.now() - new Date(m.refreshed_at).getTime() > STALE_MS
    )

  let refreshado = false
  let refreshError: string | undefined

  if (cacheStale) {
    const r = await refrescarCacheModelos()
    if (r.ok) {
      modelos = await listarCacheModelos()
      refreshado = true
    } else {
      refreshError = r.error
    }
  }

  // Devolver sólo modelos vigentes, agrupados por familia con el más
  // nuevo primero. El frontend no necesita mostrar modelos deprecados.
  const vigentes = modelos
    .filter((m) => !m.deprecated_at)
    .sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0
      return tb - ta
    })

  const porFamilia: Record<string, typeof vigentes> = {
    sonnet: vigentes.filter((m) => m.familia === 'sonnet'),
    opus: vigentes.filter((m) => m.familia === 'opus'),
    haiku: vigentes.filter((m) => m.familia === 'haiku'),
  }

  const resueltosPorFamilia = {
    sonnet: porFamilia.sonnet[0]?.id || null,
    opus: porFamilia.opus[0]?.id || null,
    haiku: porFamilia.haiku[0]?.id || null,
  }

  return NextResponse.json({
    ok: true,
    configurada: true,
    refreshado,
    refresh_error: refreshError,
    modelos: vigentes,
    resueltos_por_familia: resueltosPorFamilia,
  })
}
