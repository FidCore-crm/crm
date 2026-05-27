import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { renderizarPlantillaDraft } from '@/lib/email-templates/renderizador'
import { obtenerVariablesOrganizacion } from '@/lib/email-variables'
import { construirUrlPortalDinamica } from '@/lib/urls-publicas'

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

  const draft = {
    asunto: body.asunto || '',
    saludo: body.saludo || '',
    cuerpo: body.cuerpo || '',
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

  try {
    const { cuerpo_html, asunto } = await renderizarPlantillaDraft(draft, variables, {
      nombre: variables.productora_nombre || 'Productor de Seguros',
      telefono: variables.productora_telefono,
      email: variables.productora_email,
      logo_url: variables.productora_logo
        ? `${request.nextUrl.origin}/api/storage/${variables.productora_logo}`
        : undefined,
      color_marca: variables.productora_color_marca || undefined,
    })
    return NextResponse.json({ ok: true, html: cuerpo_html, asunto })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'Error al renderizar la plantilla' }, { status: 500 })
  }
}
