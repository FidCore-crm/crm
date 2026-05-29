/**
 * Clasificador de errores SMTP para decidir si un envío fallido vale la pena
 * reintentar o si es definitivo.
 *
 * Filosofía: ante la duda, marcar TRANSITORIO. Es preferible reintentar
 * algunos emails de más antes que perder uno legítimo por una clasificación
 * agresiva.
 *
 * Backoff exponencial: 30 min, 2h, 8h, 24h. Después de 4 intentos un
 * TRANSITORIO se considera PERMANENTE (algo está roto y no se va a arreglar
 * solo).
 */

export type ErrorTipo = 'TRANSITORIO' | 'PERMANENTE'

/**
 * Errores PERMANENTES típicos del protocolo SMTP. Si el mensaje contiene
 * alguna de estas señales, asumimos que el email nunca va a entregarse:
 *  - El destinatario no existe
 *  - El dominio fue rechazado por SPF/DKIM
 *  - El SMTP devolvió rechazo sintáctico (5XX no recuperable)
 *
 * Si no matcheamos nada de esto → TRANSITORIO por default (timeout, rate
 * limit, 4XX, error de conexión, SMTP no configurado, etc).
 */
const SENALES_PERMANENTES: RegExp[] = [
  // SMTP error codes 5.1.x — destinatario inválido
  /5\.1\.[0-9]+/i,
  // SMTP error codes 5.2.x — mailbox no disponible
  /5\.2\.[0-9]+/i,
  // SMTP error codes 5.4.x — política de red
  /5\.4\.[0-9]+/i,
  // SMTP error codes 5.7.x — rechazado por política (SPF, DKIM, DMARC, listas negras)
  /5\.7\.[0-9]+/i,
  // Mensajes humanos comunes
  /user\s+unknown/i,
  /mailbox\s+(does\s+not\s+exist|not\s+found|unavailable)/i,
  /no\s+such\s+(user|address|mailbox)/i,
  /recipient\s+(address\s+)?rejected/i,
  /address\s+(does\s+not\s+exist|not\s+found)/i,
  /domain\s+(does\s+not\s+exist|not\s+found)/i,
  /invalid\s+(recipient|email|address)/i,
  /relay\s+(access\s+)?denied/i,
  // Códigos SMTP 550 / 551 / 553 / 554 explícitos (rechazos duros)
  /\b55[01]\b/,
  /\b553\b/,
  /\b554\b/,
]

export function clasificarError(mensaje: string | null | undefined): ErrorTipo {
  if (!mensaje) return 'TRANSITORIO'
  for (const r of SENALES_PERMANENTES) {
    if (r.test(mensaje)) return 'PERMANENTE'
  }
  return 'TRANSITORIO'
}

/**
 * Backoff exponencial.
 *
 * Intentos previos al cálculo → cuándo es el próximo intento:
 *  0 → +30 min   (primera falla, dar tiempo a que SMTP se reponga)
 *  1 → +2 h
 *  2 → +8 h
 *  3 → +24 h
 *  4+ → null (no reintentar, considerarlo definitivo)
 *
 * El número de minutos NO es exacto — agregamos jitter para evitar que todos
 * los emails fallidos a la vez golpeen al SMTP al mismo tiempo cuando se
 * reponga.
 */
export function calcularProximoIntento(intentosPrevios: number): Date | null {
  const minutos = [30, 120, 480, 1440][intentosPrevios]
  if (minutos === undefined) return null
  const jitterMin = Math.floor(Math.random() * Math.max(1, Math.floor(minutos * 0.1)))
  return new Date(Date.now() + (minutos + jitterMin) * 60_000)
}

export const MAX_INTENTOS = 4
