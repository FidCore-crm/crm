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
      .select('asunto, saludo, cuerpo, cierre')
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
  } else {
    asuntoBase = (body.asunto as string) || ''
    // Modo libre: no hay saludo ni cierre separado — el wizard-enviar
    // real mapea todo al cuerpo de `notificacion_general`. Acá replicamos:
    // saludo simple + cuerpo del textarea + cierre default.
    saludoBase = 'Hola {{nombre}}!'
    cuerpoBase = (body.cuerpo as string) || ''
    cierreBase = 'Saludos,'
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
  const variables = { ...organizacionVars, ...variablesBase }

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
        logo_url: logoDataUrl,
        color_marca: variables.organizacion_color_marca || undefined,
        email_header_estilo:
          (variables.organizacion_email_header_estilo as
            | 'banda'
            | 'compacto'
            | 'lateral'
            | undefined) || undefined,
        email_header_subtitulo: variables.organizacion_email_header_subtitulo || undefined,
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
