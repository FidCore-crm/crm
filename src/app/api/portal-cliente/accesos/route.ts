import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-auth'
import { tieneAccesoTotal } from '@/lib/cartera-filter'
import { obtenerUrlPortalCliente } from '@/lib/urls-publicas'

export async function GET(request: Request) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  const supabase = getSupabaseAdmin()

  // Si no tiene acceso total, limitar a personas de su cartera
  let idsPersonas: string[] | null = null
  if (!tieneAccesoTotal(usuario)) {
    const { data } = await supabase
      .from('personas')
      .select('id')
      .eq('usuario_id', usuario.id)
    idsPersonas = ((data ?? []) as any[]).map(p => p.id)
  }

  let query = supabase
    .from('portal_cliente_accesos')
    .select('*, personas!inner(id, nombre, apellido, razon_social, dni_cuil, tipo_persona)')
    .order('fecha_creacion', { ascending: false })
    .limit(500)

  if (idsPersonas !== null) {
    if (idsPersonas.length === 0) {
      return NextResponse.json({ ok: true, accesos: [] })
    }
    query = query.in('persona_id', idsPersonas)
  }

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ ok: false, error: 'Error al obtener los datos' }, { status: 500 })
  }

  // Resolver la URL base solo para informar al frontend dónde vive el portal
  // (no exponemos URLs completas con token — los tokens están hasheados).
  const urlBasePortal = await obtenerUrlPortalCliente()

  const accesos = ((data ?? []) as any[]).map(a => {
    const p = a.personas || {}
    const nombre =
      p.tipo_persona === 'JURIDICA'
        ? p.razon_social || p.apellido
        : [p.nombre, p.apellido].filter(Boolean).join(' ')

    return {
      id: a.id,
      persona_id: a.persona_id,
      persona_nombre: nombre,
      persona_dni: p.dni_cuil || '',
      // token y url_completa NO se exponen: los tokens viven hasheados en DB.
      // Para conseguir un link de nuevo hay que regenerar el token.
      fecha_creacion: a.fecha_creacion,
      ultimo_acceso: a.ultimo_acceso,
      veces_accedido: a.veces_accedido ?? 0,
      revocado: a.revocado,
    }
  })

  return NextResponse.json({ ok: true, accesos, url_base_portal: urlBasePortal })
}
