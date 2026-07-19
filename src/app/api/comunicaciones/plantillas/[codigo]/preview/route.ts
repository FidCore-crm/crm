import { NextRequest, NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { renderizarPlantilla } from '@/lib/email-templates/renderizador'
import {
  obtenerVariablesPersona,
  obtenerVariablesPoliza,
  obtenerVariablesOrganizacion,
} from '@/lib/email-variables'
import { obtenerUrlCRM } from '@/lib/urls-publicas'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ codigo: string }> },
) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }

  const { codigo } = await params
  const body = await request.json().catch(() => ({}))
  const { persona_id, poliza_id, campos_editables } = body

  const [variablesPersona, variablesPoliza, variablesOrganizacion] = await Promise.all([
    persona_id ? obtenerVariablesPersona(persona_id) : Promise.resolve({}),
    poliza_id ? obtenerVariablesPoliza(poliza_id) : Promise.resolve({}),
    obtenerVariablesOrganizacion(),
  ])

  const variables: Record<string, string> = {
    ...variablesOrganizacion,
    ...variablesPoliza,
    ...variablesPersona,
    ...(campos_editables?.titulo ? { titulo: campos_editables.titulo } : {}),
    ...(campos_editables?.cuerpo ? { cuerpo_mensaje: campos_editables.cuerpo } : {}),
  }

  const baseUrl = (await obtenerUrlCRM()) || 'http://localhost:3000'
  const organizacion = {
    nombre: variables.organizacion_nombre || 'Productor de Seguros',
    telefono: variables.organizacion_telefono || '',
    email: variables.organizacion_email || '',
    sitio_web: variables.organizacion_sitio_web || undefined,
    logo_url: variables.organizacion_logo ? `${baseUrl}/api/storage/${variables.organizacion_logo}` : '',
    color_marca: variables.organizacion_color_marca || undefined,
    email_header_estilo: (variables.organizacion_email_header_estilo as 'banda' | 'compacto' | 'lateral' | 'blanco_solo_logo' | undefined) || undefined,
    email_header_subtitulo: variables.organizacion_email_header_subtitulo || undefined,
    email_header_ocultar_nombre: variables.organizacion_email_header_ocultar_nombre === '1',
  }

  try {
    const { cuerpo_html } = await renderizarPlantilla(codigo, variables, organizacion)
    return NextResponse.json({ ok: true, html: cuerpo_html })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'Error al renderizar la plantilla' }, { status: 500 })
  }
}
