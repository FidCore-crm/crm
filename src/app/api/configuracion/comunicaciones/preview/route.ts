import { NextRequest, NextResponse } from 'next/server'
import { renderizarPlantilla } from '@/lib/email-templates/renderizador'
import { obtenerVariablesOrganizacion } from '@/lib/email-variables'
import { construirUrlPortalDinamica } from '@/lib/urls-publicas'
import { requireAdmin } from '@/lib/api-auth'

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

    try {
      const { cuerpo_html } = await renderizarPlantilla(
        codigo,
        variables,
        {
          nombre: variables.productora_nombre || 'Productor de Seguros',
          telefono: variables.productora_telefono,
          email: variables.productora_email,
          logo_url: variables.productora_logo
            ? `${request.nextUrl.origin}/api/storage/${variables.productora_logo}`
            : undefined,
          color_marca: variables.productora_color_marca || undefined,
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
