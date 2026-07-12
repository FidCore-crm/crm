import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api-auth'
import { obtenerUrlPortalCliente } from '@/lib/urls-publicas'

const DEFAULTS = {
  activo: false,
  texto_bienvenida: 'Bienvenido a tu portal personal',
  mensaje_acceso_revocado:
    'Este enlace ya no está disponible. Contactá a tu productor para obtener un nuevo acceso.',
}

async function cargarOCrear() {
  const supabase = getSupabaseAdmin()
  let { data } = await supabase
    .from('configuracion_portal_cliente')
    .select('*')
    .limit(1)
    .maybeSingle()

  if (!data) {
    const { data: nuevo } = await supabase
      .from('configuracion_portal_cliente')
      .insert(DEFAULTS as any)
      .select('*')
      .single()
    data = nuevo
  }

  return data
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  const data = await cargarOCrear()
  const urlPortal = await obtenerUrlPortalCliente()

  return NextResponse.json({
    ok: true,
    configuracion: { ...data, url_portal: urlPortal },
  })
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  try {
    const body = await request.json()
    const supabase = getSupabaseAdmin()

    if (body.texto_bienvenida !== undefined && !String(body.texto_bienvenida).trim()) {
      return NextResponse.json(
        { ok: false, error: 'El texto de bienvenida no puede estar vacío' },
        { status: 400 }
      )
    }
    if (body.mensaje_acceso_revocado !== undefined && !String(body.mensaje_acceso_revocado).trim()) {
      return NextResponse.json(
        { ok: false, error: 'El mensaje de acceso revocado no puede estar vacío' },
        { status: 400 }
      )
    }

    // La URL del portal ya no se edita desde la UI del PAS. Se configura
    // en el env `URL_PORTAL_CLIENTE` durante la instalación por FidCore.
    // Cualquier `url_portal` que venga en el body se ignora silenciosamente
    // por compatibilidad con clientes viejos que aún lo manden.

    const existing = await cargarOCrear()

    const campos: Record<string, any> = {}
    const allowed = ['activo', 'texto_bienvenida', 'mensaje_acceso_revocado']
    for (const key of allowed) {
      if (body[key] !== undefined) campos[key] = body[key]
    }

    const { data, error } = await supabase
      .from('configuracion_portal_cliente')
      .update(campos)
      .eq('id', (existing as any).id)
      .select('*')
      .single()

    if (error) {
      return NextResponse.json({ ok: false, error: 'Error al actualizar los datos' }, { status: 500 })
    }

    const urlPortal = await obtenerUrlPortalCliente()
    return NextResponse.json({
      ok: true,
      configuracion: { ...data, url_portal: urlPortal },
    })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}
