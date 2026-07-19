/**
 * POST /api/comunicaciones/wizard-enviar/preview
 *
 * Renderiza el HTML del email que el wizard de envío va a mandar, para que
 * el PAS pueda visualizarlo antes de confirmar. No manda nada — solo devuelve
 * el HTML final con variables de ejemplo (nombre "Juan Pérez", etc.).
 *
 * Reutiliza el mismo `renderizarPlantillaDraft` que usa el editor de
 * plantillas para el preview en vivo — así el HTML es idéntico al que
 * generaría un envío real.
 *
 * Body (JSON):
 *   mensaje_tipo:          'mailing_plantilla' | 'libre'
 *   mailing_plantilla_id:  UUID (si mensaje_tipo=mailing_plantilla)
 *   asunto:                string (asunto libre o override para plantilla)
 *   cuerpo:                string (si mensaje_tipo=libre)
 *
 * Admin-only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { renderizarPlantillaDraft } from '@/lib/email-templates/renderizador'
import { obtenerVariablesOrganizacion } from '@/lib/email-variables'
import { construirUrlPortalDinamica } from '@/lib/urls-publicas'
import { logoComoDataUrl } from '@/lib/email-templates/logo-preview'
import { generarBotonHtml } from '@/lib/email-templates/botones'

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: { mensaje: 'Body inválido' } }, { status: 400 })
  }

  const mensaje_tipo = body.mensaje_tipo as 'mailing_plantilla' | 'libre'
  if (mensaje_tipo !== 'mailing_plantilla' && mensaje_tipo !== 'libre') {
    return NextResponse.json(
      { ok: false, error: { mensaje: 'mensaje_tipo debe ser mailing_plantilla o libre' } },
      { status: 400 },
    )
  }

  // Textos base según el tipo
  let asuntoBase = ''
  let saludoBase = ''
  let cuerpoBase = ''
  let cierreBase = ''
  let ctaTexto = ''
  let ctaUrl = ''

  if (mensaje_tipo === 'mailing_plantilla') {
    const plantillaId = body.mailing_plantilla_id as string | undefined
    if (!plantillaId) {
      return NextResponse.json(
        { ok: false, error: { mensaje: 'Falta mailing_plantilla_id' } },
        { status: 400 },
      )
    }
    const supabase = getSupabaseAdmin()
    const { data: plantilla, error } = await supabase
      .from('mailing_plantillas')
      .select('asunto, saludo, cuerpo, cierre, cta_texto, cta_url')
      .eq('id', plantillaId)
      .single()
    if (error || !plantilla) {
      return NextResponse.json(
        { ok: false, error: { mensaje: 'Plantilla no encontrada' } },
        { status: 404 },
      )
    }
    // El asunto puede overridearse en el paso Config del wizard; usar el
    // override si viene, sino el de la plantilla.
    asuntoBase = (body.asunto as string)?.trim() || plantilla.asunto
    saludoBase = plantilla.saludo
    cuerpoBase = plantilla.cuerpo
    cierreBase = plantilla.cierre
    // Fix v1.0.147: leer CTA de la plantilla para que aparezca en el preview
    // del último paso del wizard (mismo botón que aparece en el mail real).
    ctaTexto = (plantilla.cta_texto ?? '').trim()
    ctaUrl = (plantilla.cta_url ?? '').trim()
  } else {
    asuntoBase = (body.asunto as string) || ''
    // Modo libre: no hay saludo ni cierre separado — el wizard-enviar
    // real mapea todo al cuerpo de `notificacion_general`. Acá replicamos:
    // saludo simple + cuerpo del textarea + cierre default.
    saludoBase = 'Hola {{nombre}}!'
    cuerpoBase = (body.cuerpo as string) || ''
    cierreBase = 'Saludos,'
    // Modo libre acepta CTA en el body directamente (paso "libre" del wizard).
    ctaTexto = (body.cta_texto_libre as string | undefined)?.trim() || ''
    ctaUrl = (body.cta_url_libre as string | undefined)?.trim() || ''
  }

  // URL del portal (usada por variables como {{url_portal}})
  const urlPortalReal = await construirUrlPortalDinamica('ejemplo')
  const urlPortal = urlPortalReal || `${request.nextUrl.origin}/c/ejemplo`

  // Variables de ejemplo — mismas que preview-draft de plantillas para
  // que la experiencia sea consistente.
  const variablesBase: Record<string, string> = {
    nombre: 'Juan',
    apellido: 'Pérez',
    email: 'juan@ejemplo.com',
    telefono: '011-1234-5678',
    numero_poliza: 'AP-2026-001234',
    compania: 'La Segunda',
    ramo: 'Automotor',
    fecha_inicio: '10/04/2026',
    fecha_fin: '10/04/2027',
    riesgo: 'Toyota Corolla 2024 - ABC 123',
    titulo: 'Novedades importantes',
    cuerpo_mensaje: cuerpoBase,
    url_portal: urlPortal,
  }

  const organizacionVars = await obtenerVariablesOrganizacion()
  const variables: Record<string, string> = { ...organizacionVars, ...variablesBase }

  // Fix v1.0.147: si vienen texto+URL del botón, generar el HTML del botón
  // con el color de marca del PAS e inyectar `{{boton_accion}}` al final del
  // cuerpo si no está ya. Mismo patrón que usa enviarComunicacion() en el
  // sender real para que el preview sea idéntico al mail que llega.
  if (ctaTexto && ctaUrl) {
    const botonHtml = generarBotonHtml({
      texto: ctaTexto,
      url: ctaUrl,
      color_marca: variables.organizacion_color_marca || undefined,
    })
    variables.boton_accion = botonHtml
    if (!cuerpoBase.includes('{{boton_accion}}')) {
      cuerpoBase = cuerpoBase.trim()
        ? `${cuerpoBase}\n\n{{boton_accion}}`
        : `{{boton_accion}}`
    }
    // Refrescar la variable cuerpo_mensaje con el cuerpo actualizado (por si
    // la plantilla usa {{cuerpo_mensaje}} en vez de tener el texto inline).
    variables.cuerpo_mensaje = cuerpoBase
  }

  const logoDataUrl = await logoComoDataUrl(variables.organizacion_logo)

  try {
    const { cuerpo_html, asunto } = await renderizarPlantillaDraft(
      {
        asunto: asuntoBase,
        saludo: saludoBase,
        cuerpo: cuerpoBase,
        cierre: cierreBase,
      },
      variables,
      {
        nombre: variables.organizacion_nombre || 'Productor de Seguros',
        telefono: variables.organizacion_telefono,
        email: variables.organizacion_email,
        sitio_web: variables.organizacion_sitio_web || undefined,
        logo_url: logoDataUrl,
        color_marca: variables.organizacion_color_marca || undefined,
        email_header_estilo:
          (variables.organizacion_email_header_estilo as
            | 'banda'
            | 'compacto'
            | 'lateral'
            | 'blanco_solo_logo'
            | undefined) || undefined,
        email_header_subtitulo: variables.organizacion_email_header_subtitulo || undefined,
        email_header_ocultar_nombre: variables.organizacion_email_header_ocultar_nombre === '1',
      },
    )
    return NextResponse.json({ ok: true, data: { html: cuerpo_html, asunto } })
  } catch {
    return NextResponse.json(
      { ok: false, error: { mensaje: 'Error al renderizar el preview' } },
      { status: 500 },
    )
  }
}
