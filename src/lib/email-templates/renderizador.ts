/**
 * Renderizador de plantillas de email basadas en DB.
 *
 * Las plantillas se cargan desde `plantillas_email` (tabla editable por el PAS
 * desde la UI de configuración). Cada plantilla tiene 4 campos editables:
 *   - asunto
 *   - saludo
 *   - cuerpo
 *   - cierre
 *
 * El HTML final se arma con una estructura fija (header con logo, saludo,
 * cuerpo, bloque de CTA opcional, cierre, footer, tracking pixel). Los textos
 * editables se ESCAPAN HTML para evitar que el PAS inyecte markup arbitrario;
 * los `\n` se convierten en `<br>` para respetar saltos de línea.
 *
 * Las variables `{{nombre}}` se resuelven ANTES de escapar, porque los valores
 * también se escapan por separado. De esa forma un asegurado que se llame
 * "<script>" no rompe el email.
 */

import { getSupabaseAdmin } from '@/lib/supabase/server'
import { reemplazarVariables } from '@/lib/email-variables'
import type { PlantillaEmail } from '@/types/database'
import { derivarTonos, normalizarColorMarca, COLOR_MARCA_DEFAULT } from '@/lib/color-marca'

export interface PlantillaRenderizada {
  asunto: string
  cuerpo_html: string
}

export interface OrganizacionInfo {
  nombre: string
  telefono?: string
  email?: string
  logo_url?: string
  // Color hex de marca elegido por el PAS ('#RRGGBB'). Si no viene,
  // se usa el navy por defecto. Aplica al header, saludo y nombre.
  color_marca?: string | null
}

export interface RenderOptions {
  unsubscribe_url?: string
  tracking_pixel_url?: string
  bloque_extra_html?: string // se inyecta entre cuerpo y cierre (ej: "si algunos adjuntos no entraron…")
}

// ---------------------------------------------------------------------------
// Escape de HTML: crítico para seguridad
// ---------------------------------------------------------------------------

export function escapeHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Variables especiales que se renderizan como HTML (no se escapan).
 * El caller arma el HTML completo del bloque (ej: un botón con `<table>` y
 * estilos inline) y se inyecta tal cual entre el cuerpo escapado.
 *
 * Seguridad: solo se respetan estas claves específicas. Cualquier otra
 * variable se trata como texto y se escapa normalmente. El HTML que pasa
 * el caller acá tiene que venir de código del CRM, NUNCA de input del
 * usuario.
 */
const VARIABLES_HTML_SEGURAS = new Set(['boton_accion'])

/**
 * Reemplaza variables + escapa HTML + convierte `\n` en `<br>`.
 *
 * Las variables del set `VARIABLES_HTML_SEGURAS` se reemplazan con un
 * placeholder único ANTES del escape, y después del escape se restituye
 * el HTML real. El resto se escapa como texto plano para evitar XSS.
 */
function prepararTextoHtml(texto: string, variables: Record<string, string>): string {
  // Particionar variables: las html-seguras quedan fuera del reemplazo inicial
  const variablesTexto: Record<string, string> = {}
  const variablesHtml: Record<string, string> = {}
  for (const [k, v] of Object.entries(variables)) {
    if (VARIABLES_HTML_SEGURAS.has(k)) variablesHtml[k] = v
    else variablesTexto[k] = v
  }

  // Reemplazar variables html-seguras con placeholders únicos
  let textoConPlaceholders = texto
  const placeholders = new Map<string, string>()
  for (const [k, htmlValor] of Object.entries(variablesHtml)) {
    const placeholder = `__HTMLVAR_${k}_${Math.random().toString(36).slice(2)}__`
    placeholders.set(placeholder, htmlValor)
    textoConPlaceholders = textoConPlaceholders.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), placeholder)
  }

  const conVariables = reemplazarVariables(textoConPlaceholders, variablesTexto)
  let escapado = escapeHtml(conVariables)

  // Restituir HTML real reemplazando los placeholders
  for (const [placeholder, htmlValor] of Array.from(placeholders.entries())) {
    escapado = escapado.split(placeholder).join(htmlValor)
  }

  return escapado.replace(/\r?\n/g, '<br>')
}

// El asunto NO va a HTML — se deja como texto plano después de reemplazar variables.
function prepararAsunto(texto: string, variables: Record<string, string>): string {
  return reemplazarVariables(texto, variables).replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------------------
// Carga de plantilla desde DB
// ---------------------------------------------------------------------------

export async function obtenerPlantilla(codigo: string): Promise<PlantillaEmail | null> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('plantillas_email')
    .select('*')
    .eq('codigo', codigo)
    .maybeSingle()
  if (error || !data) return null
  return data as unknown as PlantillaEmail
}

// ---------------------------------------------------------------------------
// HTML fijo de wrapper
// ---------------------------------------------------------------------------

function armarHtml(params: {
  asuntoPlano: string
  saludoHtml: string
  cuerpoHtml: string
  cierreHtml: string
  organizacion: OrganizacionInfo
  bloqueExtraHtml?: string
  unsubscribeUrl?: string
  trackingPixelUrl?: string
}): string {
  const {
    asuntoPlano,
    saludoHtml,
    cuerpoHtml,
    cierreHtml,
    organizacion,
    bloqueExtraHtml,
    unsubscribeUrl,
    trackingPixelUrl,
  } = params

  const tonos = derivarTonos(normalizarColorMarca(organizacion.color_marca ?? COLOR_MARCA_DEFAULT))

  // Logo en círculo blanco — más grande (96px) y con sombra interna sutil que
  // le da más presencia. Usamos table para centrado compatible con Outlook.
  const logoHtml = organizacion.logo_url
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;background:#ffffff;border-radius:50%;width:96px;height:96px;box-shadow:0 4px 14px rgba(0,0,0,0.22);">
         <tr><td align="center" valign="middle" style="padding:8px;width:96px;height:96px;">
           <img src="${escapeHtml(organizacion.logo_url)}" alt="${escapeHtml(organizacion.nombre)}" style="max-width:80px;max-height:80px;display:inline-block;" />
         </td></tr>
       </table>`
    : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;background:#ffffff;border-radius:50%;width:96px;height:96px;box-shadow:0 4px 14px rgba(0,0,0,0.22);">
         <tr><td align="center" valign="middle" style="width:96px;height:96px;">
           <span style="font-size:44px;font-weight:bold;color:${tonos.base};line-height:1;">${escapeHtml((organizacion.nombre || '?').charAt(0).toUpperCase())}</span>
         </td></tr>
       </table>`

  // Nombre de organización con jerarquía: más grande, con letter-spacing leve.
  // Color textoSobreColor garantiza contraste WCAG AA sobre el header.
  const nombreOrganizacionHtml = `<p style="margin:18px 0 0;font-size:22px;font-weight:bold;letter-spacing:0.3px;color:${tonos.textoSobreColor};line-height:1.2;">${escapeHtml(organizacion.nombre)}</p>`

  const bloqueExtra = bloqueExtraHtml
    ? `<tr><td style="padding:0 36px 24px;">${bloqueExtraHtml}</td></tr>`
    : ''

  const unsubscribeLine = unsubscribeUrl
    ? `<p style="margin:8px 0 0;font-size:11px;color:#94a3b8;line-height:1.5;">Si no querés recibir más emails, <a href="${escapeHtml(unsubscribeUrl)}" style="color:#64748b;text-decoration:underline;">hacé clic acá para darte de baja</a>.</p>`
    : ''

  const pixel = trackingPixelUrl
    ? `<img src="${escapeHtml(trackingPixelUrl)}" alt="" width="1" height="1" style="display:block;width:1px;height:1px;border:0;" />`
    : ''

  // Datos de contacto en el cierre, separados por un divisor sutil.
  const tieneDatosContacto = organizacion.telefono || organizacion.email
  const contactoHtml = tieneDatosContacto
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:20px;border-top:1px solid #e2e8f0;">
         <tr><td style="padding-top:16px;">
           ${organizacion.telefono ? `<p style="margin:0;font-size:13px;color:#475569;line-height:1.5;"><span style="color:#94a3b8;">Tel:</span> <a href="tel:${escapeHtml(organizacion.telefono.replace(/\s+/g, ''))}" style="color:${tonos.base};text-decoration:none;">${escapeHtml(organizacion.telefono)}</a></p>` : ''}
           ${organizacion.email ? `<p style="margin:4px 0 0;font-size:13px;color:#475569;line-height:1.5;"><span style="color:#94a3b8;">Email:</span> <a href="mailto:${escapeHtml(organizacion.email)}" style="color:${tonos.base};text-decoration:none;">${escapeHtml(organizacion.email)}</a></p>` : ''}
         </td></tr>
       </table>`
    : ''

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${escapeHtml(asuntoPlano)}</title></head>
<body style="margin:0;padding:0;background-color:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,Helvetica,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#eef2f7;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(15,23,42,0.08),0 2px 6px rgba(15,23,42,0.04);">

<!-- Header con hero más alto y jerarquía -->
<tr><td style="background-color:${tonos.base};padding:44px 32px 40px;text-align:center;">
${logoHtml}
${nombreOrganizacionHtml}
</td></tr>

<!-- Saludo con jerarquía de título -->
<tr><td style="padding:36px 36px 12px;">
<p style="margin:0;font-size:20px;font-weight:bold;color:${tonos.base};line-height:1.35;letter-spacing:-0.2px;">${saludoHtml}</p>
</td></tr>

<!-- Cuerpo -->
<tr><td style="padding:0 36px 28px;">
<div style="margin:0;font-size:15px;line-height:1.7;color:#334155;">${cuerpoHtml}</div>
</td></tr>

${bloqueExtra}

<!-- Cierre con datos de contacto separados visualmente -->
<tr><td style="padding:0 36px 36px;">
<div style="margin:0;font-size:15px;line-height:1.7;color:#334155;">${cierreHtml}</div>
${contactoHtml}
</td></tr>

<!-- Footer con estructura -->
<tr><td style="background-color:#f8fafc;border-top:1px solid #e2e8f0;padding:24px 32px;text-align:center;">
<p style="margin:0;font-size:12px;font-weight:600;color:#64748b;line-height:1.5;">${escapeHtml(organizacion.nombre)}</p>
<p style="margin:4px 0 0;font-size:11px;color:#94a3b8;line-height:1.5;">Este es un email automático enviado desde el CRM de ${escapeHtml(organizacion.nombre)}.</p>
${unsubscribeLine}
</td></tr>

</table>
</td></tr></table>
${pixel}
</body>
</html>`
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Renderiza una plantilla leyéndola de DB.
 *
 * Flujo:
 *  1. Carga plantilla por `codigo`
 *  2. Valida que exista y esté activa
 *  3. Prepara asunto (plano), saludo/cuerpo/cierre (HTML con escape + <br>)
 *  4. Arma HTML completo con estructura fija
 */
export async function renderizarPlantilla(
  codigo: string,
  variables: Record<string, string>,
  organizacion: OrganizacionInfo,
  options: RenderOptions = {},
): Promise<PlantillaRenderizada> {
  const plantilla = await obtenerPlantilla(codigo)
  if (!plantilla) {
    throw new Error(`Plantilla "${codigo}" no encontrada`)
  }
  if (!plantilla.activa) {
    throw new Error(`Plantilla "${codigo}" está desactivada`)
  }

  const asunto = prepararAsunto(plantilla.asunto, variables)
  const saludoHtml = prepararTextoHtml(plantilla.saludo, variables)
  const cuerpoHtml = prepararTextoHtml(plantilla.cuerpo, variables)
  const cierreHtml = prepararTextoHtml(plantilla.cierre, variables)

  const cuerpo_html = armarHtml({
    asuntoPlano: asunto,
    saludoHtml,
    cuerpoHtml,
    cierreHtml,
    organizacion,
    bloqueExtraHtml: options.bloque_extra_html,
    unsubscribeUrl: options.unsubscribe_url,
    trackingPixelUrl: options.tracking_pixel_url,
  })

  return { asunto, cuerpo_html }
}

/**
 * Renderiza con textos overrideados (usado por el endpoint de preview cuando
 * el PAS está editando y aún no guardó). No consulta DB.
 */
export async function renderizarPlantillaDraft(
  draft: { asunto: string; saludo: string; cuerpo: string; cierre: string },
  variables: Record<string, string>,
  organizacion: OrganizacionInfo,
  options: RenderOptions = {},
): Promise<PlantillaRenderizada> {
  const asunto = prepararAsunto(draft.asunto, variables)
  const saludoHtml = prepararTextoHtml(draft.saludo, variables)
  const cuerpoHtml = prepararTextoHtml(draft.cuerpo, variables)
  const cierreHtml = prepararTextoHtml(draft.cierre, variables)

  const cuerpo_html = armarHtml({
    asuntoPlano: asunto,
    saludoHtml,
    cuerpoHtml,
    cierreHtml,
    organizacion,
    bloqueExtraHtml: options.bloque_extra_html,
    unsubscribeUrl: options.unsubscribe_url,
    trackingPixelUrl: options.tracking_pixel_url,
  })

  return { asunto, cuerpo_html }
}
