import { NextResponse } from 'next/server'
import { validarCronSecret } from '@/lib/cron-auth'
import { refrescarCacheModelos, isAnthropicConfigured } from '@/lib/anthropic-client'
import { logger } from '@/lib/errores'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/sincronizar-modelos-anthropic
 *
 * Sincroniza el cache local `anthropic_modelos_cache` con la lista viva de
 * modelos de Anthropic (GET /v1/models). Los modelos que ya no aparecen
 * se marcan como deprecated_at = NOW; los nuevos se agregan.
 *
 * Este cron permite que el CRM adopte automáticamente nuevas versiones
 * de Sonnet/Opus/Haiku sin necesidad de tocar código: el resolver
 * (`resolverModeloParaFamilia`) siempre elige el más reciente vigente
 * de la familia que el admin configuró.
 *
 * Además, el flujo de `llamarClaude` incluye auto-sustitución reactiva:
 * si una llamada falla con MODEL_DISCONTINUED, se refresca el cache
 * sincrónicamente y se reintenta con el modelo nuevo. Este cron sirve
 * para mantener el cache fresco preventivamente (antes de que ocurra
 * un fallo) y para que la UI de configuración tenga datos actualizados.
 *
 * Protegido con CRON_SECRET. Se llama desde scripts/startup-crons.sh.
 */
export async function GET(request: Request) {
  const authError = await validarCronSecret(request)
  if (authError) return authError

  // Si Anthropic no está configurado, no hay API key para pegar a /v1/models.
  // Salir en OK sin hacer nada — es el estado esperado para instalaciones
  // nuevas donde el PAS todavía no cargó su key.
  if (!(await isAnthropicConfigured())) {
    return NextResponse.json({
      ok: true,
      sincronizado: false,
      motivo: 'NO_CONFIGURED',
      mensaje: 'Anthropic no está configurado; no se ejecuta el refresh.',
    })
  }

  const resultado = await refrescarCacheModelos()

  if (!resultado.ok) {
    logger.error({
      modulo: 'cron-modelos-anthropic',
      mensaje: 'Refresh del cache de modelos falló',
      contexto: { error: resultado.error },
    })
    return NextResponse.json(
      {
        ok: false,
        error: resultado.error,
      },
      { status: 503 }
    )
  }

  logger.info({
    modulo: 'cron-modelos-anthropic',
    mensaje: 'Cache de modelos Anthropic refrescado',
    contexto: {
      agregados: resultado.agregados,
      actualizados: resultado.actualizados,
      deprecados: resultado.deprecados,
    },
  })

  return NextResponse.json({
    ok: true,
    sincronizado: true,
    agregados: resultado.agregados,
    actualizados: resultado.actualizados,
    deprecados: resultado.deprecados,
  })
}
