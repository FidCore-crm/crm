import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-auth'
import { tieneAccesoTotal } from '@/lib/cartera-filter'
import {
  generarTokenAcceso,
  regenerarTokenAcceso,
  revocarTokenAcceso,
  construirUrlPortal,
  recuperarTokenPlano,
} from '@/lib/portal-cliente-tokens'
import { obtenerUrlPortalCliente } from '@/lib/urls-publicas'
import { checkLicenciaActiva } from '@/lib/licencia-guard'

async function verificarAcceso(
  supabase: any,
  usuario: { id: string; rol: string; acceso_cartera: string },
  persona_id: string
): Promise<{ ok: boolean; error?: string; status?: number }> {
  const { data: persona } = await supabase
    .from('personas')
    .select('id, usuario_id')
    .eq('id', persona_id)
    .maybeSingle()

  if (!persona) return { ok: false, error: 'Persona no encontrada', status: 404 }

  if (tieneAccesoTotal(usuario)) return { ok: true }
  const ownerId = (persona as any).usuario_id
  if (ownerId === null || ownerId === usuario.id) return { ok: true }
  return { ok: false, error: 'No tenés acceso a esta persona', status: 403 }
}

async function obtenerAccesoActivo(supabase: any, persona_id: string) {
  const { data } = await supabase
    .from('portal_cliente_accesos')
    .select('*')
    .eq('persona_id', persona_id)
    .eq('revocado', false)
    .maybeSingle()
  return data
}

function respuestaAcceso(
  acceso: any | null,
  urlBasePortal: string | null,
  tokenPlano?: string | null,
) {
  if (!acceso) return { tiene_acceso: false, acceso: null }
  // Desde la migración 093 también guardamos el token encriptado en DB
  // (AES-256-GCM con ENCRYPTION_KEY del .env.local, que no viaja en el
  // backup). Si el caller no nos pasó el token (caso GET), lo intentamos
  // recuperar del campo `token_encrypted`. Si falla (key faltante / token
  // pre-093), devolvemos null y el frontend muestra el cartel "ya fue
  // mostrado, regenerá".
  const token = tokenPlano ?? recuperarTokenPlano(acceso)
  return {
    tiene_acceso: true,
    acceso: {
      id: acceso.id,
      token,
      url_completa: token ? construirUrlPortal(token, urlBasePortal) : null,
      fecha_creacion: acceso.fecha_creacion,
      veces_accedido: acceso.veces_accedido ?? 0,
      ultimo_acceso: acceso.ultimo_acceso,
      revocado: acceso.revocado,
    },
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ persona_id: string }> }
) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  const { persona_id } = await params
  const supabase = getSupabaseAdmin()

  const check = await verificarAcceso(supabase, usuario, persona_id)
  if (!check.ok) {
    return NextResponse.json({ ok: false, error: check.error }, { status: check.status })
  }

  const acceso = await obtenerAccesoActivo(supabase, persona_id)

  // Si no hay activo, devolver también el último revocado para mostrar estado
  let ultimoRevocado: any = null
  if (!acceso) {
    const { data } = await supabase
      .from('portal_cliente_accesos')
      .select('*')
      .eq('persona_id', persona_id)
      .eq('revocado', true)
      .order('fecha_revocacion', { ascending: false })
      .limit(1)
      .maybeSingle()
    ultimoRevocado = data
  }

  const urlBasePortal = await obtenerUrlPortalCliente()
  return NextResponse.json({
    ok: true,
    ...respuestaAcceso(acceso, urlBasePortal),
    ultimo_revocado: ultimoRevocado
      ? {
          id: (ultimoRevocado as any).id,
          fecha_creacion: (ultimoRevocado as any).fecha_creacion,
          fecha_revocacion: (ultimoRevocado as any).fecha_revocacion,
          motivo_revocacion: (ultimoRevocado as any).motivo_revocacion,
        }
      : null,
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ persona_id: string }> }
) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo

  const { persona_id } = await params
  const supabase = getSupabaseAdmin()

  const check = await verificarAcceso(supabase, usuario, persona_id)
  if (!check.ok) {
    return NextResponse.json({ ok: false, error: check.error }, { status: check.status })
  }

  const existente = await obtenerAccesoActivo(supabase, persona_id)
  if (existente) {
    return NextResponse.json(
      { ok: false, error: 'Ya existe un acceso activo. Usá regenerar para reemplazarlo.' },
      { status: 400 }
    )
  }

  const resultado = await generarTokenAcceso(persona_id, usuario.id)
  if (!resultado.ok || !resultado.token) {
    return NextResponse.json(
      { ok: false, error: resultado.error || 'No se pudo generar el acceso' },
      { status: 500 }
    )
  }

  // Solo en este response devolvemos el token plano (es la única vez que
  // se puede ver: en DB queda hasheado). El frontend tiene que copiarlo o
  // enviarlo ahora.
  const acceso = await obtenerAccesoActivo(supabase, persona_id)
  const urlBasePortal = await obtenerUrlPortalCliente()
  return NextResponse.json({ ok: true, ...respuestaAcceso(acceso, urlBasePortal, resultado.token) })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ persona_id: string }> }
) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo

  const { persona_id } = await params
  const supabase = getSupabaseAdmin()

  const check = await verificarAcceso(supabase, usuario, persona_id)
  if (!check.ok) {
    return NextResponse.json({ ok: false, error: check.error }, { status: check.status })
  }

  const resultado = await regenerarTokenAcceso(persona_id, usuario.id)
  if (!resultado.ok || !resultado.token) {
    return NextResponse.json(
      { ok: false, error: resultado.error || 'No se pudo regenerar' },
      { status: 500 }
    )
  }

  // Mismo principio que en POST: el token plano se devuelve solo una vez.
  const acceso = await obtenerAccesoActivo(supabase, persona_id)
  const urlBasePortal = await obtenerUrlPortalCliente()
  return NextResponse.json({ ok: true, ...respuestaAcceso(acceso, urlBasePortal, resultado.token) })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ persona_id: string }> }
) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo

  const { persona_id } = await params
  const supabase = getSupabaseAdmin()

  const check = await verificarAcceso(supabase, usuario, persona_id)
  if (!check.ok) {
    return NextResponse.json({ ok: false, error: check.error }, { status: check.status })
  }

  let motivo: string | undefined
  try {
    const body = await request.json()
    motivo = typeof body?.motivo === 'string' ? body.motivo : undefined
  } catch {
    motivo = undefined
  }

  const acceso = await obtenerAccesoActivo(supabase, persona_id)
  if (!acceso) {
    return NextResponse.json({ ok: false, error: 'No hay acceso activo' }, { status: 400 })
  }

  const ok = await revocarTokenAcceso((acceso as any).id, usuario.id, motivo)
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'No se pudo revocar' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
