import { NextRequest, NextResponse } from 'next/server'
import { renderizarPlantilla } from '@/lib/email-templates/renderizador'
import { obtenerVariablesOrganizacion } from '@/lib/email-variables'
import { construirUrlPortalDinamica } from '@/lib/urls-publicas'
import { requireAdmin } from '@/lib/api-auth'
import { logoComoDataUrl } from '@/lib/email-templates/logo-preview'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth
  try {
    const codigo = request.nextUrl.searchParams.get('codigo')
    if (!codigo) {
      return NextResponse.json({ ok: false, error: 'Código de plantilla requerido' }, { status: 400 })
    }

    // URL del portal: usa la configurada por el PAS si existe, fallback al
    // origen del request (así nunca aparece un dominio de otro cliente).
    const urlPortalReal = await construirUrlPortalDinamica('ejemplo')
    const urlPortal = urlPortalReal || `${request.nextUrl.origin}/c/ejemplo`

    // Variables de ejemplo para mostrar
    const variablesEjemplo: Record<string, string> = {
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

    // Variables reales de la organización (incluye color_marca + logo) para que
    // el preview muestre la identidad de marca configurada por el PAS.
    const organizacionVars = await obtenerVariablesOrganizacion()
    const variables = { ...organizacionVars, ...variablesEjemplo }

    // En el preview inyectamos el logo como data URL para que se vea siempre,
    // incluso dentro de un iframe sandbox sin acceso a la red del padre.
    const logoDataUrl = await logoComoDataUrl(variables.organizacion_logo)

    try {
      const { cuerpo_html } = await renderizarPlantilla(
        codigo,
        variables,
        {
          nombre: variables.organizacion_nombre || 'Productor de Seguros',
          telefono: variables.organizacion_telefono,
          email: variables.organizacion_email,
          sitio_web: variables.organizacion_sitio_web || undefined,
          logo_url: logoDataUrl,
          color_marca: variables.organizacion_color_marca || undefined,
          email_header_estilo: (variables.organizacion_email_header_estilo as 'banda' | 'compacto' | 'lateral' | undefined) || undefined,
          email_header_subtitulo: variables.organizacion_email_header_subtitulo || undefined,
          email_header_ocultar_nombre: variables.organizacion_email_header_ocultar_nombre === '1',
        },
      )
      return NextResponse.json({ ok: true, html: cuerpo_html })
    } catch (err: any) {
      return NextResponse.json({ ok: false, error: 'Error al renderizar la plantilla' }, { status: 500 })
    }
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'Error interno del servidor' }, { status: 500 })
  }
}
