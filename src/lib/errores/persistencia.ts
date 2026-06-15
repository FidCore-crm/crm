/**
 * Persistencia de errores críticos en la tabla `errores_sistema`.
 *
 * Implementa agregación por ventana temporal: si el mismo error (mismo código
 * + mismo módulo + mismo endpoint) ocurre dentro de la ventana configurada
 * (default 60 minutos), se incrementa el `contador` del row existente en vez
 * de crear uno nuevo. Esto evita que un error en loop llene la tabla.
 *
 * Anti-bucle infinito: esta función NUNCA tira excepciones. Si falla, loguea
 * con `console.error` directo (no usa logger para evitar recursion) y sigue.
 * Los callers (manejarErrores, libs) pueden llamarla con fire-and-forget.
 *
 * Telemetría externa: además de persistir local, los errores nuevos (no
 * agregaciones) se reportan a Sentry para que el equipo de FidCore pueda ver
 * issues de instalaciones en producción sin pedirle al PAS que mande logs.
 * Sentry se llama fire-and-forget: si falla, no impacta la persistencia.
 */

import * as Sentry from '@sentry/nextjs'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { obtenerNombreOrganizacion } from '@/lib/organizacion'

const VENTANA_AGREGACION_DEFAULT_MIN = 60

export interface ParamsPersistencia {
  codigo: string
  mensaje: string
  modulo?: string
  endpoint?: string
  metodo?: string
  stack_trace?: string
  request_body?: Record<string, unknown>
  request_headers?: Record<string, string>
  contexto?: Record<string, unknown>
  causa?: string
  correlation_id?: string
  usuario_id?: string
  /** Error original — si está, Sentry captura los frames reales del stack. */
  error_original?: Error
}

export async function persistirError(params: ParamsPersistencia): Promise<void> {
  try {
    const supabase = getSupabaseAdmin()
    const ventanaMin = await obtenerVentanaAgregacion()
    const desde = new Date(Date.now() - ventanaMin * 60 * 1000).toISOString()

    // 1. Buscar si ya existe un error igual en la ventana
    let query = supabase
      .from('errores_sistema')
      .select('id, contador')
      .eq('codigo', params.codigo)
      .eq('archivado', false)
      .gte('ultima_aparicion', desde)
      .order('ultima_aparicion', { ascending: false })
      .limit(1)

    // Supabase no acepta .eq(col, null) — usar .is(col, null) en ese caso
    if (params.modulo !== undefined && params.modulo !== null) {
      query = query.eq('modulo', params.modulo)
    } else {
      query = query.is('modulo', null)
    }
    if (params.endpoint !== undefined && params.endpoint !== null) {
      query = query.eq('endpoint', params.endpoint)
    } else {
      query = query.is('endpoint', null)
    }

    const { data: existente } = await query.maybeSingle()

    if (existente) {
      // Agregar: incrementar contador y actualizar ultima_aparicion
      await supabase
        .from('errores_sistema')
        .update({
          contador: ((existente as { contador: number }).contador || 1) + 1,
          ultima_aparicion: new Date().toISOString(),
        } as never)
        .eq('id', (existente as { id: string }).id)
      return
    }

    // 2. No existía: crear row nuevo
    const contextoExtra =
      params.contexto || params.causa
        ? { ...(params.contexto || {}), ...(params.causa ? { causa: params.causa } : {}) }
        : null

    const { data: nuevoError } = await supabase
      .from('errores_sistema')
      .insert({
        codigo: params.codigo,
        mensaje: params.mensaje,
        modulo: params.modulo ?? null,
        endpoint: params.endpoint ?? null,
        metodo: params.metodo ?? null,
        stack_trace: params.stack_trace ?? null,
        request_body: params.request_body ?? null,
        request_headers: params.request_headers ?? null,
        contexto_extra: contextoExtra,
        correlation_id: params.correlation_id ?? null,
        usuario_id: params.usuario_id ?? null,
      } as never)
      .select('id')
      .single()

    // 3. Notificar al admin (solo errores nuevos, no agregaciones)
    //
    // Anti-bucle: NO notificar si el error viene del propio sistema de
    // comunicaciones ni del propio módulo de errores. Un fallo al enviar el
    // email de notificación no debe disparar otro email de notificación.
    if (
      nuevoError &&
      params.modulo !== 'comunicaciones' &&
      params.modulo !== 'errores' &&
      params.modulo !== 'cron-errores'
    ) {
      await notificarAdminFireAndForget(params)
    }

    // 4. Reportar a Sentry (solo errores nuevos, no agregaciones).
    //
    // No tiene el filtro anti-bucle de notificarAdmin porque Sentry no
    // depende de servicios internos del CRM (no manda emails, no toca DB).
    // Queremos enterarnos también de los fallos de comunicaciones/errores.
    //
    // Hace `await` con flush porque sin él Next.js puede cerrar el request
    // antes de que el SDK termine de enviar el evento al transport HTTP.
    if (nuevoError) {
      await reportarASentry(params)
    }
  } catch (err) {
    // Nunca tirar. Si falla persistir, lo único que podemos hacer es loguear
    // crudo — usar `logger` acá podría recursionar.
    // eslint-disable-next-line no-console
    console.error('[errores/persistencia] No se pudo persistir error crítico:', err)
  }
}

async function obtenerVentanaAgregacion(): Promise<number> {
  try {
    const supabase = getSupabaseAdmin()
    const { data } = await supabase
      .from('configuracion_comunicaciones')
      .select('errores_ventana_agregacion_minutos')
      .limit(1)
      .maybeSingle()
    const val = (data as { errores_ventana_agregacion_minutos?: number } | null)
      ?.errores_ventana_agregacion_minutos
    return val ?? VENTANA_AGREGACION_DEFAULT_MIN
  } catch {
    return VENTANA_AGREGACION_DEFAULT_MIN
  }
}

async function reportarASentry(params: ParamsPersistencia): Promise<void> {
  try {
    // Si Sentry no está inicializado (sin DSN), captureException es no-op.
    // Igual chequeamos `getClient()` para evitar el costo de armar el evento.
    if (!Sentry.getClient()) return

    // Si tenemos el Error original, Sentry lo usa con todos sus frames.
    // Si no, rehidratamos uno con el mensaje + stack como string.
    let errorParaCapturar: Error
    if (params.error_original) {
      errorParaCapturar = params.error_original
    } else {
      errorParaCapturar = new Error(params.mensaje)
      if (params.stack_trace) {
        errorParaCapturar.stack = params.stack_trace
      }
    }

    // Tag legible de organización — complementa al `instalacion_id` opaco para
    // poder filtrar por cliente desde el dashboard sin mapeo externo.
    const organizacion = await obtenerNombreOrganizacion()

    Sentry.captureException(errorParaCapturar, {
      tags: {
        codigo: params.codigo,
        modulo: params.modulo ?? 'desconocido',
        endpoint: params.endpoint ?? 'N/A',
        organizacion: organizacion ?? 'sin-configurar',
      },
      contexts: {
        crm: {
          correlation_id: params.correlation_id,
          metodo: params.metodo,
          causa: params.causa,
          ...(params.contexto ?? {}),
        },
      },
      user: params.usuario_id ? { id: params.usuario_id } : undefined,
    })

    // Forzar el envío antes de que Next.js cierre el request. Timeout 2s —
    // si Sentry no responde en ese tiempo, abandonamos para no demorar la
    // respuesta al usuario. La persistencia local en `errores_sistema` ya
    // pasó, así que el evento no se pierde del lado del CRM.
    await Sentry.flush(2000)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[errores/persistencia] No se pudo reportar a Sentry:', err)
  }
}

async function notificarAdminFireAndForget(params: ParamsPersistencia): Promise<void> {
  try {
    // Import dinámico para romper ciclo: comunicaciones-sender podría querer
    // importar utilidades de errores en el futuro.
    const { encolarEmailSistema } = await import('@/lib/comunicaciones-sender')
    const { obtenerDefinicionPorCodigo } = await import('@/lib/errores/codigos')
    const def = obtenerDefinicionPorCodigo(params.codigo)
    await encolarEmailSistema({
      tipo_evento: 'ERROR_CRITICO',
      variables_extra: {
        codigo: params.codigo,
        mensaje: params.mensaje.slice(0, 500),
        mensaje_humano: def?.mensaje_humano ?? params.mensaje.slice(0, 200),
        sugerencia: def?.sugerencia ?? '—',
        categoria_humana: def?.categoria_humana ?? 'Sistema',
        modulo: params.modulo ?? 'desconocido',
        endpoint: params.endpoint ?? 'N/A',
        fecha: new Date().toLocaleString('es-AR'),
      },
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[errores/persistencia] No se pudo notificar al admin:', err)
  }
}
