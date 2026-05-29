/**
 * Emails que Pulzar (la empresa) envía al admin del PAS (el cliente).
 *
 * A diferencia de los emails `sistema_*` que el CRM del PAS envía a su propio
 * admin (avisos técnicos sobre backup, PDF, restauración, etc. — esos sí son
 * configurables por el PAS porque son sobre su instalación), estos emails
 * están **hardcoded** porque:
 *
 *   1. El PAS NO debe editar lo que Pulzar le escribe — el contenido y el
 *      contacto los define Pulzar.
 *   2. El From / Reply-To apuntan a `pulzar.crm@gmail.com`, no al email del
 *      PAS. Si el PAS responde el aviso, le llega a Pulzar (no a sí mismo).
 *   3. Los datos de contacto del footer son los de Pulzar (1166794861 /
 *      pulzar.crm@gmail.com) para que el cliente sepa a quién contactar
 *      por temas de licencia.
 *
 * Implementación: SMTP del PAS (el que tiene configurado), pero override del
 * From, Reply-To y firma para que el email se vea como enviado por Pulzar.
 *
 * Por ahora solo cubre licencias (vencimiento / gracia / bloqueada). Si en el
 * futuro Pulzar quiere notificar al PAS sobre otros temas (versión nueva,
 * anuncios), agregar el tipo nuevo acá y un caller correspondiente.
 */

import { enviarEmail } from '@/lib/email-sender'
import { logger } from '@/lib/errores'
import { escapeHtml } from '@/lib/email-templates/renderizador'

// ---------------------------------------------------------------------------
// Datos de contacto de Pulzar (fijos, no configurables)
// ---------------------------------------------------------------------------

export const PULZAR_NOMBRE = 'Pulzar'
export const PULZAR_EMAIL = 'pulzar.crm@gmail.com'
export const PULZAR_TELEFONO_WHATSAPP = '1166794861'
export const PULZAR_TELEFONO_WHATSAPP_E164 = '5491166794861' // formato wa.me

// ---------------------------------------------------------------------------
// Tipos de aviso de Pulzar al admin
// ---------------------------------------------------------------------------

export type TipoEmailPulzar =
  | 'LICENCIA_POR_VENCER'
  | 'LICENCIA_VENCIDA'
  | 'LICENCIA_BLOQUEADA'

interface VariablesEmailPulzar {
  nombre_admin: string
  // Para licencia
  dias_restantes?: number
  plan?: string
  fecha_vencimiento?: string
}

// ---------------------------------------------------------------------------
// Renderer del HTML — estructura simple, consistente con tono de Pulzar
// ---------------------------------------------------------------------------

function reemplazar(texto: string, vars: Record<string, string>): string {
  return texto.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => vars[key] ?? '')
}

function armarHtmlPulzar(params: {
  asunto: string
  saludo: string
  cuerpo: string
}): string {
  const { asunto, saludo, cuerpo } = params

  const waUrl = `https://wa.me/${PULZAR_TELEFONO_WHATSAPP_E164}`

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${escapeHtml(asunto)}</title></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f1f5f9;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

<!-- Header -->
<tr><td style="background-color:#0A1628;padding:28px 32px;text-align:center;">
<p style="margin:0;font-size:22px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">Pulzar</p>
<p style="margin:4px 0 0;font-size:12px;color:#94a3b8;">CRM para Productores de Seguros</p>
</td></tr>

<!-- Saludo -->
<tr><td style="padding:32px 32px 16px;">
<p style="margin:0;font-size:16px;font-weight:bold;color:#0A1628;line-height:1.4;">${escapeHtml(saludo)}</p>
</td></tr>

<!-- Cuerpo -->
<tr><td style="padding:0 32px 24px;">
<div style="margin:0;font-size:15px;line-height:1.6;color:#334155;">${cuerpo}</div>
</td></tr>

<!-- Contacto Pulzar -->
<tr><td style="padding:0 32px 32px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;">
<tr><td style="padding:16px 20px;">
<p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#0A1628;">¿Tenés dudas o querés renovar?</p>
<p style="margin:0 0 4px;font-size:13px;color:#334155;">
  📧 <a href="mailto:${PULZAR_EMAIL}" style="color:#0A1628;text-decoration:none;">${PULZAR_EMAIL}</a>
</p>
<p style="margin:0;font-size:13px;color:#334155;">
  📱 WhatsApp: <a href="${waUrl}" style="color:#0A1628;text-decoration:none;">${PULZAR_TELEFONO_WHATSAPP}</a>
</p>
</td></tr>
</table>
</td></tr>

<!-- Footer -->
<tr><td style="background-color:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;text-align:center;">
<p style="margin:0;font-size:11px;color:#94a3b8;">Este email fue enviado automáticamente por Pulzar.</p>
</td></tr>

</table>
</td></tr></table>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Plantillas hardcoded (NO viven en la tabla plantillas_email)
// ---------------------------------------------------------------------------

interface DefinicionPlantillaPulzar {
  asunto: string
  saludo: string
  cuerpo: string
}

const PLANTILLAS: Record<TipoEmailPulzar, DefinicionPlantillaPulzar> = {
  LICENCIA_POR_VENCER: {
    asunto: 'Tu licencia Pulzar vence en {{dias_restantes}} días',
    saludo: 'Hola {{nombre_admin}},',
    cuerpo:
      `Tu licencia <strong>{{plan}}</strong> de Pulzar vence el <strong>{{fecha_vencimiento}}</strong>.<br><br>` +
      `Para evitar interrupciones en el servicio, te recomendamos renovarla antes de la fecha de vencimiento. ` +
      `Contactanos por WhatsApp o email para coordinar la renovación.`,
  },
  LICENCIA_VENCIDA: {
    asunto: 'Tu licencia Pulzar venció — renová pronto',
    saludo: 'Hola {{nombre_admin}},',
    cuerpo:
      `Tu licencia de Pulzar venció el <strong>{{fecha_vencimiento}}</strong>. ` +
      `El sistema sigue funcionando con normalidad por unos días para que tengas tiempo de renovar.<br><br>` +
      `Si no cargás una licencia válida pronto, el CRM pasa a modo solo lectura: vas a poder consultar personas, pólizas y siniestros, pero no editar ni crear nada nuevo.<br><br>` +
      `Contactanos para coordinar la renovación.`,
  },
  LICENCIA_BLOQUEADA: {
    asunto: 'Tu Pulzar quedó en modo solo lectura',
    saludo: 'Hola {{nombre_admin}},',
    cuerpo:
      `Tu licencia de Pulzar venció y el CRM pasó a <strong>modo solo lectura</strong>: ` +
      `podés consultar personas, pólizas y siniestros, pero no crear ni editar nada nuevo.<br><br>` +
      `Para reactivar el sistema completo, necesitamos coordinar la renovación de la licencia. ` +
      `Apenas cargues la nueva licencia, todas las funciones se desbloquean al instante.<br><br>` +
      `Escribinos cuanto antes así no quedás sin operar.`,
  },
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

export interface EnviarEmailPulzarParams {
  tipo: TipoEmailPulzar
  destinatarioEmail: string
  variables: VariablesEmailPulzar
}

export interface EnviarEmailPulzarResult {
  ok: boolean
  error?: string
}

/**
 * Envía un email DESDE Pulzar AL admin del PAS.
 *
 * Usa el SMTP que el PAS tiene configurado (no hay SMTP de Pulzar en cada
 * instalación) pero con el From, Reply-To y firma sobreescritos para que el
 * email se vea y se responda como si fuera de Pulzar.
 *
 * Síncrono — no encola en email_envios. El cron de licencias usa el flag de
 * notificación in-app de 24h como anti-spam.
 *
 * Nunca tira: cualquier error se loggea y se devuelve `ok:false`. El caller
 * (cron) no debe interrumpir su flujo si un email puntual falla.
 */
export async function enviarEmailPulzar(
  params: EnviarEmailPulzarParams,
): Promise<EnviarEmailPulzarResult> {
  try {
    const def = PLANTILLAS[params.tipo]
    if (!def) {
      return { ok: false, error: `Tipo de email Pulzar desconocido: ${params.tipo}` }
    }

    // Hoy las variables son strings controlados por el cron (plan del enum,
    // fechas formateadas, número de días, nombre del admin del perfil). Aun
    // así escapamos defensivamente: si en el futuro se agrega un campo nuevo
    // que viene de input de usuario y se inyecta en el cuerpo (que es HTML
    // inline con <strong> y <br>), no abre un vector de XSS.
    const varsCrudo: Record<string, string> = {
      nombre_admin: params.variables.nombre_admin,
      dias_restantes: String(params.variables.dias_restantes ?? ''),
      plan: params.variables.plan ?? '',
      fecha_vencimiento: params.variables.fecha_vencimiento ?? '',
    }
    const varsStr: Record<string, string> = Object.fromEntries(
      Object.entries(varsCrudo).map(([k, v]) => [k, escapeHtml(v)]),
    )

    // Asunto y saludo: van como texto puro a `armarHtmlPulzar`, que ya los
    // escapa con `escapeHtml(...)`. Reemplazamos con varsCrudo para no
    // sufrir doble escape.
    const asunto = reemplazar(def.asunto, varsCrudo)
    const saludo = reemplazar(def.saludo, varsCrudo)
    // Cuerpo: tiene HTML inline (<strong>, <br>) y se inyecta SIN escape en
    // el HTML final. Por eso las variables vienen pre-escapadas — si en el
    // futuro alguna viene de input de usuario, no abre XSS.
    const cuerpo = reemplazar(def.cuerpo, varsStr)

    const html = armarHtmlPulzar({ asunto, saludo, cuerpo })

    const res = await enviarEmail({
      to: params.destinatarioEmail,
      subject: asunto,
      html,
      fromName: PULZAR_NOMBRE,
      fromEmail: PULZAR_EMAIL,
      replyTo: PULZAR_EMAIL,
      omitirFirma: true,
    })

    if (!res.ok) {
      logger.warn({
        modulo: 'pulzar-emails',
        mensaje: `Fallo envío email Pulzar (${params.tipo})`,
        contexto: { destinatario: params.destinatarioEmail, error: res.error },
      })
    }

    return { ok: res.ok, error: res.error }
  } catch (err: any) {
    logger.error({
      modulo: 'pulzar-emails',
      mensaje: 'enviarEmailPulzar error inesperado',
      contexto: { error: err?.message || String(err) },
    })
    return { ok: false, error: err?.message || 'Error inesperado' }
  }
}
