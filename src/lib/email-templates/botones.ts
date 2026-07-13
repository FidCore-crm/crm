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

  // Clase `fc-cta-btn` en el <a> para que la media query global del
  // renderizador pueda reducir padding y forzar full-width en mobile.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:28px auto;">
  <tr><td align="center" bgcolor="${tonos.base}" style="border-radius:8px;box-shadow:0 4px 12px ${tonos.base}40;">
    <a href="${urlSafe}" target="_blank" class="fc-cta-btn" style="display:inline-block;padding:16px 40px;font-size:15px;font-weight:700;letter-spacing:0.3px;line-height:1.2;color:${tonos.textoSobreColor};text-decoration:none;border-radius:8px;background-color:${tonos.base};text-align:center;">${textoSafe}</a>
  </td></tr>
</table>`
}
