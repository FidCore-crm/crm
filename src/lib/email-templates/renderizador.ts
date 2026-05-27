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

  // Logo en círculo blanco — el logo ocupa casi todo el círculo.
  // Usamos una tabla para centrar verticalmente con compatibilidad amplia
  // en clientes de email (Outlook hace cosas raras con flex/inline-block).
  const logoHtml = organizacion.logo_url
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;background:#ffffff;border-radius:50%;width:80px;height:80px;box-shadow:0 2px 6px rgba(0,0,0,0.18);">
         <tr><td align="center" valign="middle" style="padding:6px;width:80px;height:80px;">
           <img src="${escapeHtml(organizacion.logo_url)}" alt="${escapeHtml(organizacion.nombre)}" style="max-width:68px;max-height:68px;display:inline-block;" />
         </td></tr>
       </table>
       <p style="margin:12px 0 0;font-size:14px;font-weight:600;color:${tonos.textoSobreColor};">${escapeHtml(organizacion.nombre)}</p>`
    : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;background:#ffffff;border-radius:50%;width:80px;height:80px;box-shadow:0 2px 6px rgba(0,0,0,0.18);">
         <tr><td align="center" valign="middle" style="width:80px;height:80px;">
           <span style="font-size:38px;font-weight:bold;color:${tonos.base};line-height:1;">${escapeHtml((organizacion.nombre || '?').charAt(0).toUpperCase())}</span>
         </td></tr>
       </table>
       <p style="margin:12px 0 0;font-size:18px;font-weight:bold;color:${tonos.textoSobreColor};">${escapeHtml(organizacion.nombre)}</p>`

  const bloqueExtra = bloqueExtraHtml
    ? `<tr><td style="padding:0 32px 20px;">${bloqueExtraHtml}</td></tr>`
    : ''

  const unsubscribeLine = unsubscribeUrl
    ? `<p style="margin:0;font-size:11px;color:#94a3b8;">Si no querés recibir más emails, <a href="${escapeHtml(unsubscribeUrl)}" style="color:#64748b;text-decoration:underline;">hacé clic acá para darte de baja</a>.</p>`
    : ''

  const pixel = trackingPixelUrl
    ? `<img src="${escapeHtml(trackingPixelUrl)}" alt="" width="1" height="1" style="display:block;width:1px;height:1px;border:0;" />`
    : ''

  const telefonoHtml = organizacion.telefono
    ? `<p style="margin:4px 0 0;font-size:13px;color:#64748b;">Tel: ${escapeHtml(organizacion.telefono)}</p>`
    : ''
  const emailHtml = organizacion.email
    ? `<p style="margin:2px 0 0;font-size:13px;color:#64748b;">${escapeHtml(organizacion.email)}</p>`
    : ''

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${escapeHtml(asuntoPlano)}</title></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f1f5f9;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

<!-- Header -->
<tr><td style="background-color:${tonos.base};padding:24px 32px;text-align:center;">
${logoHtml}
</td></tr>

<!-- Saludo -->
<tr><td style="padding:32px 32px 16px;">
<p style="margin:0;font-size:16px;font-weight:bold;color:${tonos.base};line-height:1.4;">${saludoHtml}</p>
</td></tr>

<!-- Cuerpo -->
<tr><td style="padding:0 32px 24px;">
<div style="margin:0;font-size:15px;line-height:1.6;color:#334155;">${cuerpoHtml}</div>
</td></tr>

${bloqueExtra}

<!-- Cierre -->
<tr><td style="padding:0 32px 32px;">
<div style="margin:0;font-size:15px;line-height:1.6;color:#334155;">${cierreHtml}</div>
${telefonoHtml}
${emailHtml}
</td></tr>

<!-- Footer -->
<tr><td style="background-color:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;text-align:center;">
<p style="margin:0 0 8px;font-size:11px;color:#94a3b8;">Este email fue enviado por ${escapeHtml(organizacion.nombre)}.</p>
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
