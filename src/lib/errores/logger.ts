/**
 * Logger estructurado mínimo del CRM.
 *
 * En producción escribe JSON por línea a stdout (compatible con `docker logs`
 * y parseable por journald). En dev usa un formato legible con prefijos.
 *
 * No depende de ninguna librería externa a propósito — pino/winston son
 * overkill para este volumen y agregan runtime sin beneficio concreto.
 */

type Nivel = 'debug' | 'info' | 'warn' | 'error'

export interface LogContexto {
  mensaje?: string
  codigo?: string
  modulo?: string
  endpoint?: string
  metodo?: string
  correlation_id?: string
  usuario_id?: string
  stack_trace?: string
  contexto?: Record<string, unknown>
  [key: string]: unknown
}

interface LogEntry extends LogContexto {
  timestamp: string
  nivel: Nivel
}

class Logger {
  private esProduccion = process.env.NODE_ENV === 'production'

  private log(nivel: Nivel, data: LogContexto): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      nivel,
      ...data,
    }

    if (this.esProduccion) {
      // JSON estructurado por línea
      try {
        console.log(JSON.stringify(entry))
      } catch {
        // Fallback si hay algo no serializable
        console.log(JSON.stringify({ timestamp: entry.timestamp, nivel, mensaje: String(data.mensaje) }))
      }
      return
    }

    // Formato legible en dev
    const ctx = entry.modulo ? `[${entry.modulo}]` : ''
    const cod = entry.codigo ? `(${entry.codigo})` : ''
    const prefix = `[${nivel.toUpperCase()}]${ctx}${cod}`
    const extras: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data)) {
      if (['mensaje', 'codigo', 'modulo'].includes(k)) continue
      if (v !== undefined && v !== null) extras[k] = v
    }
    if (Object.keys(extras).length > 0) {
      // eslint-disable-next-line no-console
      console.log(prefix, data.mensaje ?? '', extras)
    } else {
      // eslint-disable-next-line no-console
      console.log(prefix, data.mensaje ?? '')
    }
  }

  debug(data: LogContexto): void {
    if (!this.esProduccion) this.log('debug', data)
  }

  info(data: LogContexto): void {
    this.log('info', data)
  }

  warn(data: LogContexto): void {
    this.log('warn', data)
  }

  error(data: LogContexto): void {
    this.log('error', data)
  }
}

export const logger = new Logger()
