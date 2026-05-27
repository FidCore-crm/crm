// ============================================================
// Rate limiter persistente en tabla `rate_limit_buckets`
// ============================================================
//
// Uso:
//   const ip = getClientIp(request)
//   const result = await checkRateLimit({
//     identifier: ip,
//     endpoint: 'publico-siniestros',
//     maxRequests: 5,
//     windowSeconds: 3600,
//   })
//   if (!result.allowed) {
//     return NextResponse.json(
//       { ok: false, error: 'Demasiadas solicitudes' },
//       { status: 429, headers: { 'Retry-After': String(Math.ceil((result.resetAt - Date.now())/1000)) } }
//     )
//   }
//
// Política por defecto: fail-open (allowed=true ante fallo de Supabase) para
// no romper endpoints internos por problemas transitorios.
// Endpoints públicos sensibles (portal del asegurado, denuncia pública) deben
// pasar `failMode: 'closed'` para que un fallo de DB NO permita pasar el límite.
//
// Limpieza: el cron de notificaciones elimina buckets con reset_at < now-1h.
// ============================================================

import { getSupabaseAdmin } from '@/lib/supabase/server'
import { logger } from '@/lib/errores'

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number // ms epoch
}

export async function checkRateLimit(params: {
  identifier: string
  endpoint: string
  maxRequests: number
  windowSeconds: number
  /** Default 'open': si DB falla, deja pasar. Para endpoints públicos sensibles, usar 'closed'. */
  failMode?: 'open' | 'closed'
  /**
   * Si false, solo verifica el bucket sin incrementar el contador. Útil para
   * casos donde queremos contar solo los intentos fallidos (ej: login: chequear
   * con consume=false al inicio, y solo incrementar manualmente si el password
   * fue incorrecto vía `incrementRateLimit`). Default true (retrocompat).
   */
  consume?: boolean
}): Promise<RateLimitResult> {
  const { identifier, endpoint, maxRequests, windowSeconds, failMode = 'open', consume = true } = params
  const now = Date.now()
  const windowMs = windowSeconds * 1000

  try {
    const supabase = getSupabaseAdmin()

    // 1. Buscar bucket existente
    const { data: existing, error: selError } = await supabase
      .from('rate_limit_buckets')
      .select('id, count, reset_at')
      .eq('identifier', identifier)
      .eq('endpoint', endpoint)
      .maybeSingle()

    if (selError) throw selError

    const resetAtNew = new Date(now + windowMs).toISOString()

    // 2. No existe o ventana vencida
    if (!existing || new Date((existing as any).reset_at).getTime() < now) {
      if (consume) {
        const { error: upError } = await supabase
          .from('rate_limit_buckets')
          .upsert(
            {
              identifier,
              endpoint,
              count: 1,
              reset_at: resetAtNew,
            },
            { onConflict: 'identifier,endpoint' }
          )
        if (upError) throw upError
      }
      return {
        allowed: true,
        remaining: consume ? maxRequests - 1 : maxRequests,
        resetAt: now + windowMs,
      }
    }

    // 3. Ventana vigente
    const row = existing as any
    const resetAtMs = new Date(row.reset_at).getTime()

    if (row.count >= maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: resetAtMs,
      }
    }

    // 4. Incrementar (solo si consume)
    if (consume) {
      const { error: upError2 } = await supabase
        .from('rate_limit_buckets')
        .update({ count: row.count + 1 })
        .eq('id', row.id)
      if (upError2) throw upError2
    }

    return {
      allowed: true,
      remaining: maxRequests - (row.count + (consume ? 1 : 0)),
      resetAt: resetAtMs,
    }
  } catch (err: any) {
    if (failMode === 'closed') {
      // Endpoints públicos críticos: ante fallo de DB NO permitimos pasar.
      // Mejor un 429 transitorio que un endpoint público sin rate-limit.
      logger.error({
        modulo: 'rate-limit',
        mensaje: 'Fallo al chequear bucket, fail-closed',
        contexto: { endpoint, error: err?.message ?? String(err) },
      })
      return {
        allowed: false,
        remaining: 0,
        resetAt: now + windowMs,
      }
    }
    // Fail-open por defecto: loguear y permitir.
    logger.error({ modulo: 'rate-limit', mensaje: 'Fallo al chequear bucket, fail-open', contexto: { endpoint, error: err?.message ?? String(err) } })
    return {
      allowed: true,
      remaining: maxRequests,
      resetAt: now + windowMs,
    }
  }
}

/**
 * Incrementa el contador de un bucket sin verificar el límite. Útil para
 * registrar intentos fallidos cuando el chequeo inicial se hizo con
 * `consume: false`. Si el bucket no existe o venció, lo crea con count=1.
 *
 * Fail-silent: si la DB falla, loguea y sigue. No queremos que un fallo del
 * rate-limiter rompa la respuesta principal del endpoint.
 */
export async function incrementRateLimit(params: {
  identifier: string
  endpoint: string
  windowSeconds: number
}): Promise<void> {
  const { identifier, endpoint, windowSeconds } = params
  const now = Date.now()
  const windowMs = windowSeconds * 1000
  try {
    const supabase = getSupabaseAdmin()
    const { data: existing } = await supabase
      .from('rate_limit_buckets')
      .select('id, count, reset_at')
      .eq('identifier', identifier)
      .eq('endpoint', endpoint)
      .maybeSingle()

    if (!existing || new Date((existing as any).reset_at).getTime() < now) {
      await supabase
        .from('rate_limit_buckets')
        .upsert(
          {
            identifier,
            endpoint,
            count: 1,
            reset_at: new Date(now + windowMs).toISOString(),
          },
          { onConflict: 'identifier,endpoint' }
        )
      return
    }

    const row = existing as any
    await supabase
      .from('rate_limit_buckets')
      .update({ count: row.count + 1 })
      .eq('id', row.id)
  } catch (err: any) {
    logger.warn({
      modulo: 'rate-limit',
      mensaje: 'Fallo al incrementar bucket',
      contexto: { endpoint, error: err?.message ?? String(err) },
    })
  }
}

/**
 * Obtiene la IP del cliente. Prioriza x-forwarded-for (primer valor),
 * luego x-real-ip, y finalmente 'unknown'.
 */
export function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  const xreal = request.headers.get('x-real-ip')
  if (xreal) return xreal.trim()
  return 'unknown'
}

// ============================================================
// CAPTCHA matemático en memoria (sin servicios externos)
// Se mantiene en memoria porque es de corta duración (10 min),
// de uso único y no es rate-limit propiamente dicho.
// ============================================================

interface CaptchaEntry {
  respuesta: number
  expira: number
}

const captchaStore = new Map<string, CaptchaEntry>()
const CAPTCHA_TTL_MS = 10 * 60 * 1000 // 10 minutos

function limpiarCaptchasExpirados() {
  const now = Date.now()
  for (const [token, entry] of Array.from(captchaStore.entries())) {
    if (entry.expira < now) captchaStore.delete(token)
  }
}

export function generarCaptcha(): { token: string; pregunta: string } {
  limpiarCaptchasExpirados()
  const a = Math.floor(Math.random() * 9) + 1
  const b = Math.floor(Math.random() * 9) + 1
  const op = Math.random() < 0.5 ? '+' : '-'
  // Para restas, asegurar resultado positivo
  const [x, y] = op === '-' && b > a ? [b, a] : [a, b]
  const respuesta = op === '+' ? x + y : x - y
  const pregunta = `${x} ${op} ${y}`
  const token =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? (crypto as any).randomUUID()
      : `cap-${Date.now()}-${Math.random().toString(36).slice(2)}`
  captchaStore.set(token, {
    respuesta,
    expira: Date.now() + CAPTCHA_TTL_MS,
  })
  return { token, pregunta }
}

/**
 * Valida un captcha. Consume el token (uso único).
 * Retorna true si la respuesta es correcta.
 */
export function validarCaptcha(token: string, respuesta: number | string): boolean {
  limpiarCaptchasExpirados()
  const entry = captchaStore.get(token)
  if (!entry) return false
  captchaStore.delete(token) // uso único, siempre consumir
  if (entry.expira < Date.now()) return false
  const r = typeof respuesta === 'string' ? parseInt(respuesta, 10) : respuesta
  if (Number.isNaN(r)) return false
  return r === entry.respuesta
}
