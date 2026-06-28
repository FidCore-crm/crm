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
  // Variante del encabezado del email (migración 097):
  //   - 'banda'   (default): banda con gradient + logo a la izquierda + nombre + subtítulo.
  //   - 'compacto': header bajo con nombre a la izquierda y cuadrito de logo a la derecha.
  //   - 'lateral': sin bloque de color; logo en cuadro de marca, nombre en marca,
  //                el contenedor de 600px recibe un border-top de 5px en marca.
  email_header_estilo?: 'banda' | 'compacto' | 'lateral' | null
  // Subtítulo editable que aparece debajo del nombre solo en variante 'banda'
  // (migración 098). Si está vacío, no se muestra el <p> del subtítulo.
  email_header_subtitulo?: string | null
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

// ---------------------------------------------------------------------------
// Header del email — 3 variantes seleccionables por el PAS
// ---------------------------------------------------------------------------

type EstiloHeader = 'banda' | 'compacto' | 'lateral'

/**
 * Devuelve el bloque `<tr>` del header (más la barra de acento si aplica)
 * según la variante elegida. Cuerpo, contacto, footer son idénticos en las
 * tres — solo cambia este bloque.
 *
 * El border-top del contenedor de 600px (solo en 'lateral') NO lo arma esta
 * función — lo aplica `armarHtml()` directamente sobre el style de la tabla
 * exterior.
 */
function generarHeaderHtml(
  estilo: EstiloHeader,
  tonos: ReturnType<typeof derivarTonos>,
  organizacion: OrganizacionInfo,
): string {
  const nombreEscapado = escapeHtml(organizacion.nombre)
  const inicial = escapeHtml((organizacion.nombre || '?').charAt(0).toUpperCase())
  const logoUrlEscapado = organizacion.logo_url ? escapeHtml(organizacion.logo_url) : ''
  const stack = `-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,Helvetica,sans-serif`
  // Subtítulo solo se muestra en variante 'banda' y solo si tiene texto.
  const subtituloBanda = (organizacion.email_header_subtitulo ?? '').trim()

  // Gradient del header (banda y compacto): de color base a oscuro.
  // Outlook ignora gradient y cae al background-color plano (fallback).
  const gradient = `background-color:${tonos.base};background-image:linear-gradient(135deg,${tonos.base} 0%,${tonos.oscuro} 100%);`

  if (estilo === 'compacto') {
    // Compacto: header bajo, nombre a la izquierda, cuadrito logo a la derecha.
    // Tamaños subidos ~40% (v1.0.53) — antes el logo era apenas perceptible.
    const cuadroLogo = organizacion.logo_url
      ? `<img src="${logoUrlEscapado}" alt="${nombreEscapado}" width="34" style="max-width:34px;max-height:34px;display:block;" />`
      : `<span style="color:${tonos.base};font-weight:bold;font-size:18px;font-family:${stack};">${inicial}</span>`
    return `
<!-- HEADER: compacto -->
<tr><td style="${gradient}padding:18px 24px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr>
      <td valign="middle">
        <span style="font-size:16px;font-weight:bold;color:#ffffff;letter-spacing:0.3px;font-family:${stack};">${nombreEscapado}</span>
      </td>
      <td width="42" align="right" valign="middle" style="width:42px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:9px;width:42px;height:42px;">
          <tr><td align="center" valign="middle" style="width:42px;height:42px;padding:4px;">
            ${cuadroLogo}
          </td></tr>
        </table>
      </td>
    </tr>
  </table>
</td></tr>

<!-- Barra de acento fina -->
<tr><td style="background-color:#D4DDE8;height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>`
  }

  if (estilo === 'lateral') {
    // Lateral: sin bloque de color (fondo blanco). El border-top de 5px en
    // marca lo aplica el contenedor de 600px (no acá). Logo en cuadro con
    // color de marca. No lleva barra de acento.
    const cuadroLogo = organizacion.logo_url
      ? `<img src="${logoUrlEscapado}" alt="${nombreEscapado}" width="48" style="max-width:48px;max-height:48px;display:block;" />`
      : `<span style="color:#ffffff;font-weight:bold;font-size:22px;font-family:${stack};">${inicial}</span>`
    return `
<!-- HEADER: lateral (fondo blanco; el border-top de marca va en el contenedor de 600px) -->
<tr><td style="background-color:#ffffff;padding:22px 24px 0;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td width="56" valign="middle" style="width:56px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background:${tonos.base};border-radius:11px;width:56px;height:56px;">
          <tr><td align="center" valign="middle" style="width:56px;height:56px;padding:4px;">
            ${cuadroLogo}
          </td></tr>
        </table>
      </td>
      <td width="14" style="width:14px;font-size:0;line-height:0;">&nbsp;</td>
      <td valign="middle">
        <span style="font-size:17px;font-weight:bold;color:${tonos.base};font-family:${stack};">${nombreEscapado}</span>
      </td>
    </tr>
  </table>
</td></tr>`
  }

  // Default — banda (predeterminado): banda con gradient, logo a la izquierda
  // en cuadro blanco, nombre + subtítulo a la derecha, barra de acento debajo.
  const cuadroLogo = organizacion.logo_url
    ? `<img src="${logoUrlEscapado}" alt="${nombreEscapado}" width="56" style="max-width:56px;max-height:56px;display:block;" />`
    : `<span style="color:${tonos.base};font-weight:bold;font-size:26px;font-family:${stack};">${inicial}</span>`
  return `
<!-- HEADER: banda horizontal -->
<tr><td style="${gradient}padding:26px 26px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr>
      <td width="64" valign="middle" style="width:64px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:12px;width:64px;height:64px;">
          <tr><td align="center" valign="middle" style="width:64px;height:64px;padding:5px;">
            ${cuadroLogo}
          </td></tr>
        </table>
      </td>
      <td width="16" style="width:16px;font-size:0;line-height:0;">&nbsp;</td>
      <td valign="middle">
        <p style="margin:0;font-size:20px;font-weight:bold;color:#ffffff;line-height:1.15;font-family:${stack};">${nombreEscapado}</p>
        ${subtituloBanda ? `<p style="margin:4px 0 0;font-size:11px;color:#cbd5e1;letter-spacing:1px;text-transform:uppercase;font-family:${stack};">${escapeHtml(subtituloBanda)}</p>` : ''}
      </td>
    </tr>
  </table>
</td></tr>

<!-- Barra de acento fina -->
<tr><td style="background-color:#D4DDE8;height:5px;line-height:5px;font-size:0;">&nbsp;</td></tr>`
}

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

  // Estilo de header: default 'banda' si no viene seteado (preserva look
  // de instalaciones previas a la migración 097).
  const estiloHeader: EstiloHeader =
    organizacion.email_header_estilo === 'compacto' ? 'compacto'
    : organizacion.email_header_estilo === 'lateral' ? 'lateral'
    : 'banda'

  const headerHtml = generarHeaderHtml(estiloHeader, tonos, organizacion)

  // Solo 'lateral' agrega un border-top de 5px en color de marca al contenedor
  // de 600px. 'banda' y 'compacto' no.
  const borderTopContenedor = estiloHeader === 'lateral'
    ? `border-top:5px solid ${tonos.base};`
    : ''

  // Barra decorativa de acento debajo del saludo — agrega personalidad visual
  // sin cargar el diseño.
  const acentoSaludoHtml = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 0;">
    <tr><td style="background-color:${tonos.base};width:48px;height:3px;border-radius:2px;line-height:3px;font-size:0;">&nbsp;</td></tr>
  </table>`

  const bloqueExtra = bloqueExtraHtml
    ? `<tr><td style="padding:0 40px 24px;">${bloqueExtraHtml}</td></tr>`
    : ''

  const unsubscribeLine = unsubscribeUrl
    ? `<p style="margin:12px 0 0;font-size:11px;color:#94a3b8;line-height:1.5;">Si no querés recibir más emails, <a href="${escapeHtml(unsubscribeUrl)}" style="color:#64748b;text-decoration:underline;">hacé clic acá para darte de baja</a>.</p>`
    : ''

  const pixel = trackingPixelUrl
    ? `<img src="${escapeHtml(trackingPixelUrl)}" alt="" width="1" height="1" style="display:block;width:1px;height:1px;border:0;" />`
    : ''

  // Bloque de contacto destacado dentro del cierre — con fondo crema y barra
  // lateral del color de marca, para que se sienta como una "tarjeta de
  // negocio" inserta en el email.
  const tieneDatosContacto = organizacion.telefono || organizacion.email
  const contactoHtml = tieneDatosContacto
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:24px;background-color:#fafaf7;border-left:3px solid ${tonos.base};border-radius:4px;">
         <tr><td style="padding:14px 18px;">
           <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:1px;color:${tonos.base};text-transform:uppercase;">Contacto</p>
           ${organizacion.telefono ? `<p style="margin:2px 0;font-size:13px;color:#475569;line-height:1.6;">📞 <a href="tel:${escapeHtml(organizacion.telefono.replace(/\s+/g, ''))}" style="color:#334155;text-decoration:none;font-weight:600;">${escapeHtml(organizacion.telefono)}</a></p>` : ''}
           ${organizacion.email ? `<p style="margin:2px 0;font-size:13px;color:#475569;line-height:1.6;">✉️ <a href="mailto:${escapeHtml(organizacion.email)}" style="color:#334155;text-decoration:none;font-weight:600;">${escapeHtml(organizacion.email)}</a></p>` : ''}
         </td></tr>
       </table>`
    : ''

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${escapeHtml(asuntoPlano)}</title></head>
<body style="margin:0;padding:0;background-color:#faf8f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,Helvetica,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#faf8f3;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,0.10),0 4px 10px rgba(15,23,42,0.05);${borderTopContenedor}">

${headerHtml}

<!-- Saludo con jerarquía + barra decorativa de marca -->
<tr><td style="padding:40px 40px 0;">
<p style="margin:0;font-size:22px;font-weight:bold;color:${tonos.base};line-height:1.3;letter-spacing:-0.3px;">${saludoHtml}</p>
${acentoSaludoHtml}
</td></tr>

<!-- Cuerpo -->
<tr><td style="padding:24px 40px 32px;">
<div style="margin:0;font-size:15.5px;line-height:1.75;color:#334155;">${cuerpoHtml}</div>
</td></tr>

${bloqueExtra}

<!-- Cierre con tarjeta de contacto destacada -->
<tr><td style="padding:0 40px 40px;">
<div style="margin:0;font-size:15.5px;line-height:1.75;color:#334155;">${cierreHtml}</div>
${contactoHtml}
</td></tr>

<!-- Footer con jerarquía -->
<tr><td style="background-color:#f8fafc;border-top:1px solid #e2e8f0;padding:28px 32px;text-align:center;">
<p style="margin:0;font-size:13px;font-weight:700;color:${tonos.base};letter-spacing:0.3px;line-height:1.5;">${escapeHtml(organizacion.nombre)}</p>
<p style="margin:6px 0 0;font-size:11px;color:#94a3b8;line-height:1.5;">Este email fue enviado automáticamente desde el sistema de gestión.</p>
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
