import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { renderizarPlantillaDraft } from '@/lib/email-templates/renderizador'
import { obtenerVariablesOrganizacion } from '@/lib/email-variables'
import { construirUrlPortalDinamica } from '@/lib/urls-publicas'
import { logoComoDataUrl } from '@/lib/email-templates/logo-preview'
import { generarBotonHtml } from '@/lib/email-templates/botones'

/**
 * POST — Renderiza un draft de plantilla (textos aún no guardados) para
 * preview en vivo del editor. No guarda nada en DB.
 *
 * Body: { asunto, saludo, cuerpo, cierre, variables? }
 */
export async function POST(
  request: NextRequest,
  _ctx: { params: Promise<{ codigo: string }> },
) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 })
  }

  // Botón CTA opcional para preview (v1.0.142). Si vienen texto+URL, generamos
  // el HTML real del botón e inyectamos `{{boton_accion}}` al final del cuerpo
  // si no está ya (mismo patrón que enviarComunicacion en el flujo real).
  const ctaTexto = typeof body.cta_texto === 'string' ? body.cta_texto.trim() : ''
  const ctaUrl = typeof body.cta_url === 'string' ? body.cta_url.trim() : ''
  let cuerpoConBoton = body.cuerpo || ''
  let botonHtml: string | undefined
  if (ctaTexto && ctaUrl) {
    if (!cuerpoConBoton.includes('{{boton_accion}}')) {
      cuerpoConBoton = cuerpoConBoton.trim()
        ? `${cuerpoConBoton}\n\n{{boton_accion}}`
        : `{{boton_accion}}`
    }
  }

  const draft = {
    asunto: body.asunto || '',
    saludo: body.saludo || '',
    cuerpo: cuerpoConBoton,
    cierre: body.cierre || '',
  }

  // URL del portal: usa la configurada por el PAS si existe, fallback al
  // origen del request (así nunca aparece un dominio de otro cliente).
  const urlPortalReal = await construirUrlPortalDinamica('ejemplo')
  const urlPortal = urlPortalReal || `${request.nextUrl.origin}/c/ejemplo`

  // Variables de ejemplo que cubren todos los contextos
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
    cuerpo_mensaje: 'Este es un ejemplo de contenido para la vista previa.',
    url_portal: urlPortal,
  }

  const organizacionVars = await obtenerVariablesOrganizacion()
  const variables = { ...organizacionVars, ...variablesBase, ...(body.variables || {}) }

  // Generar el HTML del botón con el color de marca (v1.0.142)
  if (ctaTexto && ctaUrl) {
    botonHtml = generarBotonHtml({
      texto: ctaTexto,
      url: ctaUrl,
      color_marca: variables.organizacion_color_marca || undefined,
    })
    // El renderer trata `boton_accion` como variable html-safe.
    ;(variables as any).boton_accion = botonHtml
  }

  // Logo como data URL inline: garantiza que se vea en el iframe del editor
  // sin depender de sandbox / cookies / origin del browser.
  const logoDataUrl = await logoComoDataUrl(variables.organizacion_logo)

  try {
    const { cuerpo_html, asunto } = await renderizarPlantillaDraft(draft, variables, {
      nombre: variables.organizacion_nombre || 'Productor de Seguros',
      telefono: variables.organizacion_telefono,
      email: variables.organizacion_email,
      sitio_web: variables.organizacion_sitio_web || undefined,
      logo_url: logoDataUrl,
      color_marca: variables.organizacion_color_marca || undefined,
      email_header_estilo: (variables.organizacion_email_header_estilo as 'banda' | 'compacto' | 'lateral' | undefined) || undefined,
      email_header_subtitulo: variables.organizacion_email_header_subtitulo || undefined,
      email_header_ocultar_nombre: variables.organizacion_email_header_ocultar_nombre === '1',
    })
    return NextResponse.json({ ok: true, html: cuerpo_html, asunto })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'Error al renderizar la plantilla' }, { status: 500 })
  }
}
