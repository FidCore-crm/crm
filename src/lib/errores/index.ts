/**
 * Sistema unificado de errores — API pública.
 *
 * Los devs sólo deberían importar desde '@/lib/errores':
 *
 *   import { ERRORES, ErrorAplicacion, respuestaError, respuestaExito, manejarErrores, logger } from '@/lib/errores'
 *
 * Patrones de uso:
 *
 *  1) En una lib interna, preferir `throw new ErrorAplicacion(ERRORES.X)`:
 *
 *       if (!config?.activo) {
 *         throw new ErrorAplicacion(ERRORES.NEG_OPERACION_INVALIDA, {
 *           detalle: 'El sistema de comunicaciones está desactivado',
 *         })
 *       }
 *
 *  2) En una API route, envolver el handler con `manejarErrores()`:
 *
 *       export const POST = manejarErrores(async (request) => {
 *         // ... si tirás ErrorAplicacion, se convierte en respuesta automáticamente
 *         // ... si tirás otro Error, se loggea como crítico y devuelve ERR_SYS_001
 *         return respuestaExito({ id: creado.id })
 *       }, { modulo: 'endosos' })
 *
 *  3) Para errores esperados (validación, not found, etc.), retornar directo:
 *
 *       if (!body.email) return respuestaError(ERRORES.VALID_CAMPO_REQUERIDO, {
 *         campos: { email: 'requerido' },
 *       })
 */

import { NextResponse } from 'next/server'
import { ERRORES, type DefinicionError } from './codigos'
import { logger } from './logger'
import { persistirError } from './persistencia'

export { ERRORES, obtenerDefinicionPorCodigo } from './codigos'
export type { DefinicionError, ClaveError, CodigoError } from './codigos'
export { logger } from './logger'

// ---------------------------------------------------------------------------
// ErrorAplicacion — excepción base
// ---------------------------------------------------------------------------

export interface ErrorAplicacionOpciones {
  /** Detalle técnico. Solo se expone al cliente si NODE_ENV !== 'production'. */
  detalle?: string
  /** Errores por campo — se devuelven al cliente tal cual para feedback en forms. */
  campos?: Record<string, string>
  /** Contexto extra que se persiste en errores_sistema si el código es crítico. */
  contexto?: Record<string, unknown>
  /** Error original (si este se construyó desde un catch). */
  causa?: Error
}

/**
 * Excepción base del CRM. Usar en libs en lugar de `throw new Error()` para
 * que `manejarErrores()` pueda convertirla en una respuesta estructurada.
 */
export class ErrorAplicacion extends Error {
  public readonly definicion: DefinicionError
  public readonly detalle?: string
  public readonly campos?: Record<string, string>
  public readonly contexto?: Record<string, unknown>
  public readonly causa?: Error

  constructor(definicion: DefinicionError, opciones?: ErrorAplicacionOpciones) {
    super(definicion.mensaje)
    this.name = 'ErrorAplicacion'
    this.definicion = definicion
    this.detalle = opciones?.detalle
    this.campos = opciones?.campos
    this.contexto = opciones?.contexto
    this.causa = opciones?.causa
  }
}

// ---------------------------------------------------------------------------
// Helpers de respuesta
// ---------------------------------------------------------------------------

export interface RespuestaErrorOpciones {
  /** Detalle técnico. Solo se incluye si NODE_ENV !== 'production' (o override explícito). */
  detalle?: string
  /** Errores por campo para forms. */
  campos?: Record<string, string>
  /** Override manual del comportamiento de `detalle`. */
  incluir_detalle_en_respuesta?: boolean
  /** Override del status HTTP (por defecto viene de la definición). */
  status?: number
  /** Datos extra del registro actual que el cliente puede necesitar (ej:
   *  conflicto de concurrencia: estado actual del registro para hacer diff). */
  registro_actual?: unknown
  /** Otros datos extra arbitrarios — pasan tal cual al JSON de error. */
  contexto?: Record<string, unknown>
}

/**
 * Construye una respuesta de error estructurada para una API route.
 *
 * Formato de la respuesta:
 *   {
 *     ok: false,
 *     error: {
 *       codigo: 'ERR_VALID_001',
 *       mensaje: 'Faltan datos obligatorios.',
 *       mensaje_humano: 'Faltan datos obligatorios',
 *       sugerencia: 'Completá los campos marcados antes de continuar.',
 *       categoria_humana: 'Validación',
 *       detalle?: '...',          // solo en dev o si se fuerza
 *       campos?: { email: '...' } // si se pasan
 *     }
 *   }
 */
export function respuestaError(
  definicion: DefinicionError,
  opciones?: RespuestaErrorOpciones,
): NextResponse {
  const incluirDetalle =
    opciones?.incluir_detalle_en_respuesta ?? process.env.NODE_ENV !== 'production'

  const errorPayload: Record<string, unknown> = {
    codigo: definicion.codigo,
    mensaje: definicion.mensaje,
    mensaje_humano: definicion.mensaje_humano,
    sugerencia: definicion.sugerencia,
    categoria_humana: definicion.categoria_humana,
  }

  if (incluirDetalle && opciones?.detalle) {
    errorPayload.detalle = opciones.detalle
  }

  if (opciones?.campos) {
    errorPayload.campos = opciones.campos
  }

  if (opciones?.registro_actual !== undefined) {
    errorPayload.registro_actual = opciones.registro_actual
  }

  if (opciones?.contexto && incluirDetalle) {
    errorPayload.contexto = opciones.contexto
  }

  return NextResponse.json(
    { ok: false, error: errorPayload },
    { status: opciones?.status ?? definicion.status_http },
  )
}

/**
 * Respuesta de éxito estándar. Mantener el formato consistente con
 * `respuestaError` facilita el parsing del lado del cliente.
 */
export function respuestaExito<T>(data: T, status: number = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status })
}

// ---------------------------------------------------------------------------
// manejarErrores — wrapper de handlers de API routes
// ---------------------------------------------------------------------------

export interface ManejarErroresOpciones {
  /** Nombre del módulo/feature — se usa para logging y persistencia. */
  modulo?: string
}

/**
 * Envuelve un handler de API route y convierte cualquier excepción en una
 * respuesta estructurada. Persiste errores críticos en `errores_sistema` y
 * los loggea con `logger`.
 *
 * NO reemplaza el patrón de devolver `respuestaError()` explícitamente para
 * errores esperados — sólo atrapa excepciones que se escaparon.
 */
export function manejarErrores<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<NextResponse>,
  opciones?: ManejarErroresOpciones,
): (...args: TArgs) => Promise<NextResponse> {
  return async (...args: TArgs): Promise<NextResponse> => {
    const correlationId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2)

    const request = extraerRequest(args)
    const url = request?.url
    const metodo = request?.method
    const endpoint = url ? safeUrlPath(url) : undefined

    try {
      return await handler(...args)
    } catch (error) {
      // 1) ErrorAplicacion → respuesta directa con el código definido
      if (error instanceof ErrorAplicacion) {
        // `detalle` es la causa-raíz textual (ej: mensaje de Supabase). Si no
        // hay `causa` Error, lo usamos como `causa` para persistencia/logs así
        // queda visible en errores_sistema y en los logs de container.
        const causaTexto = error.causa?.message ?? error.detalle

        if (error.definicion.es_critico) {
          await persistirError({
            codigo: error.definicion.codigo,
            mensaje: error.message,
            modulo: opciones?.modulo,
            endpoint,
            metodo,
            stack_trace: error.stack,
            contexto: error.contexto,
            causa: causaTexto,
            correlation_id: correlationId,
            error_original: error.causa ?? error,
          })
        }

        logger.error({
          codigo: error.definicion.codigo,
          mensaje: error.message,
          detalle: error.detalle,
          causa: causaTexto,
          modulo: opciones?.modulo,
          endpoint,
          metodo,
          correlation_id: correlationId,
          contexto: error.contexto,
          stack_trace: error.definicion.es_critico ? error.stack : undefined,
        })

        return respuestaError(error.definicion, {
          detalle: error.detalle,
          campos: error.campos,
        })
      }

      // 2) Cualquier otro error → SYS_001 + persistencia + log
      const errorReal = error instanceof Error ? error : new Error(String(error))

      logger.error({
        codigo: ERRORES.SYS_ERROR_INTERNO.codigo,
        mensaje: errorReal.message,
        modulo: opciones?.modulo,
        endpoint,
        metodo,
        correlation_id: correlationId,
        stack_trace: errorReal.stack,
      })

      await persistirError({
        codigo: ERRORES.SYS_ERROR_INTERNO.codigo,
        mensaje: errorReal.message,
        modulo: opciones?.modulo,
        endpoint,
        metodo,
        stack_trace: errorReal.stack,
        correlation_id: correlationId,
        error_original: errorReal,
      })

      return respuestaError(ERRORES.SYS_ERROR_INTERNO, {
        detalle: errorReal.message,
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function extraerRequest(args: unknown[]): Request | undefined {
  const first = args[0]
  if (first && typeof first === 'object' && 'url' in first && 'method' in first) {
    return first as Request
  }
  return undefined
}

function safeUrlPath(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

// Nota: `mensajeErrorAmigable` vive en `@/lib/utils` para no arrastrar la
// cadena de imports server-side (nodemailer) al bundle del browser.
