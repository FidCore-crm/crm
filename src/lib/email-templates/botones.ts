/**
 * Helpers para generar HTML de botones inline en emails.
 *
 * Los emails que necesitan un CTA (recuperar password, invitación, magic link,
 * confirmar email) usan estos helpers para que el botón se vea coherente con
 * el color de marca elegido por el PAS.
 *
 * El HTML se inyecta como variable `{{boton_accion}}` en la plantilla. El
 * renderizador lo trata como html-segura (ver VARIABLES_HTML_SEGURAS en
 * renderizador.ts).
 */

import { derivarTonos, normalizarColorMarca, COLOR_MARCA_DEFAULT } from '@/lib/color-marca'
import { escapeHtml } from './renderizador'

export interface OpcionesBoton {
  /** URL destino del botón */
  url: string
  /** Texto a mostrar en el botón */
  texto: string
  /** Color hex de marca elegido por el PAS. Si no viene, usa default navy. */
  color_marca?: string | null
}

/**
 * Genera el HTML de un botón inline usando una `<table>` (máxima
 * compatibilidad con clientes de email — Outlook, Gmail, Apple Mail, etc).
 * El texto y URL se escapan internamente. NUNCA pasar HTML en `texto`.
 */
export function generarBotonHtml({ url, texto, color_marca }: OpcionesBoton): string {
  const tonos = derivarTonos(normalizarColorMarca(color_marca ?? COLOR_MARCA_DEFAULT))

  const urlSafe = escapeHtml(url)
  const textoSafe = escapeHtml(texto)

  // Patrón "bulletproof button" table-based:
  // - El <td> aporta bgcolor + border-radius + shadow (compat Outlook).
  // - El <a> tiene display:inline-block + PADDING → toda el área
  //   rectangular es clickable (v1.0.145). Antes el padding vivía en el
  //   <td> y solo el texto del <a> era clickable, lo que confundía al
  //   usuario que tocaba "cerca" del texto y no pasaba nada.
  //
  // CRÍTICO: el HTML va en UNA SOLA LÍNEA sin `\n` internos. El renderer
  // del CRM convierte cada `\n` a `<br>`, y `<br>` dentro de <table> mete
  // saltos de línea entre <tr>/<td> que descentran el botón. Ver
  // comunicaciones-sender.ts para el mismo cuidado en los botones inline.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:28px auto;border-collapse:separate;"><tr><td class="fc-cta-btn" align="center" valign="middle" bgcolor="${tonos.base}" style="border-radius:8px;box-shadow:0 4px 12px ${tonos.base}40;"><a href="${urlSafe}" target="_blank" style="display:inline-block;padding:16px 40px;border-radius:8px;color:${tonos.textoSobreColor};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;letter-spacing:0.3px;line-height:1.2;text-decoration:none;">${textoSafe}</a></td></tr></table>`
}
