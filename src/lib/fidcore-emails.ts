/**
 * Emails que FidCore (la empresa) envía al admin del PAS (el cliente).
 *
 * A diferencia de los emails `sistema_*` que el CRM del PAS envía a su propio
 * admin (avisos técnicos sobre backup, PDF, restauración, etc. — esos sí son
 * configurables por el PAS porque son sobre su instalación), estos emails
 * están **hardcoded** porque:
 *
 *   1. El PAS NO debe editar lo que FidCore le escribe — el contenido y el
 *      contacto los define FidCore.
 *   2. El From apunta a `pulzar.crm@gmail.com` (Gmail real) para no romper
 *      SPF — los emails salen via SMTP del PAS, no de Gmail, así que un From
 *      con dominio @fidcore.com.ar sin SPF en CF haría que vayan a spam. El
 *      Reply-To sí apunta al alias `info@fidcore.com.ar` (CF Email Routing
 *      lo redirige al Gmail real). Resultado: cuando el cliente responde, le
 *      llega a FidCore vía la marca correcta.
 *   3. Los datos de contacto del footer son los de FidCore
 *      (1166794861 / info@fidcore.com.ar) para que el cliente sepa a
 *      quién contactar por temas de licencia.
 *
 * Implementación: SMTP del PAS (el que tiene configurado), pero override del
 * From, Reply-To y firma para que el email se vea como enviado por FidCore.
 *
 * Por ahora solo cubre licencias (vencimiento / gracia / bloqueada). Si en el
 * futuro FidCore quiere notificar al PAS sobre otros temas (versión nueva,
 * anuncios), agregar el tipo nuevo acá y un caller correspondiente.
 */

import { enviarEmail } from '@/lib/email-sender'
import { logger } from '@/lib/errores'
import { escapeHtml } from '@/lib/email-templates/renderizador'

// ---------------------------------------------------------------------------
// Datos de contacto de FidCore (fijos, no configurables)
// ---------------------------------------------------------------------------

export const FIDCORE_NOMBRE = 'FidCore'
/** Address de Gmail real — se usa SOLO como From de los emails de licencia
 *  para que SPF/DKIM no falle (el envío viene del SMTP del PAS, que no está
 *  autorizado a usar el dominio fidcore.com.ar). */
export const FIDCORE_EMAIL_FROM = 'pulzar.crm@gmail.com'
/** Alias del dominio FidCore configurado en Cloudflare Email Routing — al
 *  recibir mails los redirige al Gmail real. Se usa como Reply-To de los
 *  emails y como contacto visible en footers + UI de soporte. Cuando el
 *  cliente aprieta "Responder" en su lector, escribe al alias y eso es lo
 *  que queremos mostrar en todos los puntos de contacto. */
export const FIDCORE_EMAIL_CONTACTO = 'info@fidcore.com.ar'
/** @deprecated Usar `FIDCORE_EMAIL_FROM` o `FIDCORE_EMAIL_CONTACTO` según el caso. */
export const FIDCORE_EMAIL = FIDCORE_EMAIL_FROM
export const FIDCORE_TELEFONO_WHATSAPP = '1166794861'
export const FIDCORE_TELEFONO_WHATSAPP_E164 = '5491166794861' // formato wa.me

// ---------------------------------------------------------------------------
// Tipos de aviso de FidCore al admin
// ---------------------------------------------------------------------------

export type TipoEmailFidCore =
  | 'LICENCIA_POR_VENCER'
  | 'LICENCIA_VENCIDA'
  | 'LICENCIA_BLOQUEADA'

interface VariablesEmailFidCore {
  nombre_admin: string
  // Para licencia
  dias_restantes?: number
  plan?: string
  fecha_vencimiento?: string
}

// ---------------------------------------------------------------------------
// Renderer del HTML — estructura simple, consistente con tono de FidCore
// ---------------------------------------------------------------------------

function reemplazar(texto: string, vars: Record<string, string>): string {
  return texto.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => vars[key] ?? '')
}

function armarHtmlFidCore(params: {
  asunto: string
  saludo: string
  cuerpo: string
}): string {
  const { asunto, saludo, cuerpo } = params

  const waUrl = `https://wa.me/${FIDCORE_TELEFONO_WHATSAPP_E164}`

  // Media query embebida — mismo criterio que el renderer principal:
  // clientes que la soportan (Apple Mail, Gmail app iOS/Android, Outlook
  // mobile) reciben paddings más chicos y fuentes ajustadas; el resto ve
  // el layout desktop y no se rompe. Junto con `word-break` universal en
  // los enlaces del bloque de contacto, garantiza que emails largos o
  // teléfonos con formato completo no desborden en smartphones angostos.
  const estilosResponsive = `
    @media only screen and (max-width:520px) {
      .fc-outer-td { padding:16px 8px !important; }
      .fc-container { border-radius:6px !important; }
      .fc-header { padding:22px 18px !important; }
      .fc-header-titulo { font-size:18px !important; letter-spacing:0.3px !important; }
      .fc-header-sub { font-size:11px !important; }
      .fc-saludo-td { padding:24px 20px 12px !important; }
      .fc-saludo { font-size:15px !important; }
      .fc-cuerpo-td { padding:0 20px 20px !important; }
      .fc-cuerpo-text { font-size:14.5px !important; line-height:1.7 !important; }
      .fc-contacto-wrap { padding:0 20px 24px !important; }
      .fc-contacto-td { padding:14px 16px !important; }
      .fc-contacto-line { font-size:13px !important; word-break:break-word !important; }
      .fc-footer { padding:18px 20px !important; }
    }
  `

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(asunto)}</title>
<style>${estilosResponsive}</style>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f1f5f9;">
<tr><td align="center" class="fc-outer-td" style="padding:24px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="fc-container" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

<!-- Header -->
<tr><td class="fc-header" style="background-color:#0A1628;padding:28px 32px;text-align:center;">
<p class="fc-header-titulo" style="margin:0;font-size:22px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">FidCore</p>
<p class="fc-header-sub" style="margin:4px 0 0;font-size:12px;color:#94a3b8;">CRM para Productores de Seguros</p>
</td></tr>

<!-- Saludo -->
<tr><td class="fc-saludo-td" style="padding:32px 32px 16px;">
<p class="fc-saludo" style="margin:0;font-size:16px;font-weight:bold;color:#0A1628;line-height:1.4;word-break:break-word;">${escapeHtml(saludo)}</p>
</td></tr>

<!-- Cuerpo -->
<tr><td class="fc-cuerpo-td" style="padding:0 32px 24px;">
<div class="fc-cuerpo-text" style="margin:0;font-size:15px;line-height:1.6;color:#334155;word-break:break-word;overflow-wrap:break-word;">${cuerpo}</div>
</td></tr>

<!-- Contacto FidCore -->
<tr><td class="fc-contacto-wrap" style="padding:0 32px 32px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;">
<tr><td class="fc-contacto-td" style="padding:16px 20px;">
<p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#0A1628;">¿Tenés dudas o querés renovar?</p>
<p class="fc-contacto-line" style="margin:0 0 4px;font-size:13px;color:#334155;word-break:break-word;">
  📧 <a href="mailto:${FIDCORE_EMAIL_CONTACTO}" style="color:#0A1628;text-decoration:none;word-break:break-word;">${FIDCORE_EMAIL_CONTACTO}</a>
</p>
<p class="fc-contacto-line" style="margin:0;font-size:13px;color:#334155;word-break:break-word;">
  📱 WhatsApp: <a href="${waUrl}" style="color:#0A1628;text-decoration:none;word-break:break-word;">${FIDCORE_TELEFONO_WHATSAPP}</a>
</p>
</td></tr>
</table>
</td></tr>

<!-- Footer -->
<tr><td class="fc-footer" style="background-color:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;text-align:center;">
<p style="margin:0;font-size:11px;color:#94a3b8;">Este email fue enviado automáticamente por FidCore.</p>
</td></tr>

</table>
</td></tr></table>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Plantillas hardcoded (NO viven en la tabla plantillas_email)
// ---------------------------------------------------------------------------

interface DefinicionPlantillaFidCore {
  asunto: string
  saludo: string
  cuerpo: string
}

const PLANTILLAS: Record<TipoEmailFidCore, DefinicionPlantillaFidCore> = {
  LICENCIA_POR_VENCER: {
    asunto: 'Tu licencia FidCore vence en {{dias_restantes}} días',
    saludo: 'Hola {{nombre_admin}},',
    cuerpo:
      `Tu licencia <strong>{{plan}}</strong> de FidCore vence el <strong>{{fecha_vencimiento}}</strong>.<br><br>` +
      `Para evitar interrupciones en el servicio, te recomendamos renovarla antes de la fecha de vencimiento. ` +
      `Contactanos por WhatsApp o email para coordinar la renovación.`,
  },
  LICENCIA_VENCIDA: {
    asunto: 'Tu licencia FidCore venció — renová pronto',
    saludo: 'Hola {{nombre_admin}},',
    cuerpo:
      `Tu licencia de FidCore venció el <strong>{{fecha_vencimiento}}</strong>. ` +
      `El sistema sigue funcionando con normalidad por unos días para que tengas tiempo de renovar.<br><br>` +
      `Si no cargás una licencia válida pronto, el CRM pasa a modo solo lectura: vas a poder consultar personas, pólizas y siniestros, pero no editar ni crear nada nuevo.<br><br>` +
      `Contactanos para coordinar la renovación.`,
  },
  LICENCIA_BLOQUEADA: {
    asunto: 'Tu FidCore quedó en modo solo lectura',
    saludo: 'Hola {{nombre_admin}},',
    cuerpo:
      `Tu licencia de FidCore venció y el CRM pasó a <strong>modo solo lectura</strong>: ` +
      `podés consultar personas, pólizas y siniestros, pero no crear ni editar nada nuevo.<br><br>` +
      `Para reactivar el sistema completo, necesitamos coordinar la renovación de la licencia. ` +
      `Apenas cargues la nueva licencia, todas las funciones se desbloquean al instante.<br><br>` +
      `Escribinos cuanto antes así no quedás sin operar.`,
  },
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

export interface EnviarEmailFidCoreParams {
  tipo: TipoEmailFidCore
  destinatarioEmail: string
  variables: VariablesEmailFidCore
}

export interface EnviarEmailFidCoreResult {
  ok: boolean
  error?: string
}

/**
 * Envía un email DESDE FidCore AL admin del PAS.
 *
 * Usa el SMTP que el PAS tiene configurado (no hay SMTP de FidCore en cada
 * instalación) pero con el From, Reply-To y firma sobreescritos para que el
 * email se vea y se responda como si fuera de FidCore.
 *
 * Síncrono — no encola en email_envios. El cron de licencias usa el flag de
 * notificación in-app de 24h como anti-spam.
 *
 * Nunca tira: cualquier error se loggea y se devuelve `ok:false`. El caller
 * (cron) no debe interrumpir su flujo si un email puntual falla.
 */
export async function enviarEmailFidCore(
  params: EnviarEmailFidCoreParams,
): Promise<EnviarEmailFidCoreResult> {
  try {
    const def = PLANTILLAS[params.tipo]
    if (!def) {
      return { ok: false, error: `Tipo de email FidCore desconocido: ${params.tipo}` }
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

    // Asunto y saludo: van como texto puro a `armarHtmlFidCore`, que ya los
    // escapa con `escapeHtml(...)`. Reemplazamos con varsCrudo para no
    // sufrir doble escape.
    const asunto = reemplazar(def.asunto, varsCrudo)
    const saludo = reemplazar(def.saludo, varsCrudo)
    // Cuerpo: tiene HTML inline (<strong>, <br>) y se inyecta SIN escape en
    // el HTML final. Por eso las variables vienen pre-escapadas — si en el
    // futuro alguna viene de input de usuario, no abre XSS.
    const cuerpo = reemplazar(def.cuerpo, varsStr)

    const html = armarHtmlFidCore({ asunto, saludo, cuerpo })

    const res = await enviarEmail({
      to: params.destinatarioEmail,
      subject: asunto,
      html,
      fromName: FIDCORE_NOMBRE,
      fromEmail: FIDCORE_EMAIL_FROM,
      replyTo: FIDCORE_EMAIL_CONTACTO,
      omitirFirma: true,
    })

    if (!res.ok) {
      logger.warn({
        modulo: 'fidcore-emails',
        mensaje: `Fallo envío email FidCore (${params.tipo})`,
        contexto: { destinatario: params.destinatarioEmail, error: res.error },
      })
    }

    return { ok: res.ok, error: res.error }
  } catch (err: any) {
    logger.error({
      modulo: 'fidcore-emails',
      mensaje: 'enviarEmailFidCore error inesperado',
      contexto: { error: err?.message || String(err) },
    })
    return { ok: false, error: err?.message || 'Error inesperado' }
  }
}
