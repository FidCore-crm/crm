import nodemailer from 'nodemailer'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { decrypt, isEncryptionAvailable } from './encryption'
import type { ConfiguracionCorreos } from '@/types/database'

export class EmailError extends Error {
  constructor(public codigo: string, message: string) {
    super(message)
  }
}

let transporterCache: { transporter: nodemailer.Transporter; configuradoEn: number } | null = null
const CACHE_DURATION = 60 * 1000 // 1 minuto

async function obtenerConfiguracion(): Promise<ConfiguracionCorreos | null> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('configuracion_correos')
    .select('*')
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return data as unknown as ConfiguracionCorreos
}

async function getTransporter(): Promise<nodemailer.Transporter> {
  // Usar cache si está vigente
  if (transporterCache && (Date.now() - transporterCache.configuradoEn) < CACHE_DURATION) {
    return transporterCache.transporter
  }

  if (!isEncryptionAvailable()) {
    throw new EmailError('SIN_ENCRYPTION_KEY', 'ENCRYPTION_KEY no configurada en el servidor')
  }

  const config = await obtenerConfiguracion()
  if (!config || !config.configurado) {
    throw new EmailError('NO_CONFIGURADO', 'El sistema de correos no está configurado. Configuralo desde Configuración → Correos.')
  }

  if (!config.smtp_host || !config.smtp_user || !config.smtp_password_encrypted) {
    throw new EmailError('CONFIGURACION_INCOMPLETA', 'Faltan datos en la configuración SMTP.')
  }

  const password = decrypt(config.smtp_password_encrypted)

  const transporter = nodemailer.createTransport({
    host: config.smtp_host,
    port: config.smtp_port,
    secure: config.smtp_secure,
    auth: {
      user: config.smtp_user,
      pass: password
    }
  })

  transporterCache = { transporter, configuradoEn: Date.now() }
  return transporter
}

export function invalidarCacheTransporter() {
  transporterCache = null
}

export async function enviarEmail(params: {
  to: string | string[]
  subject: string
  html: string
  text?: string
  attachments?: Array<{ filename: string; path?: string; content?: Buffer; cid?: string }>
  replyTo?: string
  /**
   * Override del nombre y email de remitente. Si se pasan, se ignoran los
   * valores de `configuracion_correos.from_name/from_email`. Útil para
   * emails que el sistema envía en nombre de un tercero (ej: notificaciones
   * de Pulzar al admin del PAS — el SMTP es del PAS pero el From dice Pulzar).
   * Si solo se pasa uno, el otro mantiene el default de la configuración.
   */
  fromName?: string
  fromEmail?: string
  /**
   * Si es true, omite la firma_html configurada por el PAS. Usado para emails
   * que no son del PAS (ej: notificaciones de Pulzar al admin) — su firma
   * propia no aplica.
   */
  omitirFirma?: boolean
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const transporter = await getTransporter()
    const config = await obtenerConfiguracion()

    if (!config) {
      throw new EmailError('NO_CONFIGURADO', 'Sin configuración')
    }

    const fromName = params.fromName ?? (config.from_name || 'Productor de Seguros')
    const fromEmail = params.fromEmail ?? (config.from_email || config.smtp_user)

    let htmlFinal = params.html
    if (config.firma_html && !params.omitirFirma) {
      htmlFinal += '<br><br>' + config.firma_html
    }

    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: Array.isArray(params.to) ? params.to.join(', ') : params.to,
      replyTo: params.replyTo || config.reply_to || fromEmail || undefined,
      subject: params.subject,
      html: htmlFinal,
      text: params.text,
      attachments: params.attachments || []
    })

    return { ok: true, messageId: info.messageId }
  } catch (err: any) {
    if (err instanceof EmailError) {
      return { ok: false, error: err.message }
    }
    return { ok: false, error: err?.message || 'Error desconocido al enviar email' }
  }
}

export async function testConexionSMTP(configTemporal?: {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
}): Promise<{ ok: boolean; error?: string }> {
  try {
    let transporter: nodemailer.Transporter

    if (configTemporal) {
      transporter = nodemailer.createTransport({
        host: configTemporal.host,
        port: configTemporal.port,
        secure: configTemporal.secure,
        auth: {
          user: configTemporal.user,
          pass: configTemporal.password
        }
      })
    } else {
      transporter = await getTransporter()
    }

    await transporter.verify()
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Error de conexión SMTP' }
  }
}

