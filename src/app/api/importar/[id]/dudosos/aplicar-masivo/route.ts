import { NextResponse } from 'next/server'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { checkLicenciaActiva } from '@/lib/licencia-guard'

export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  interface MasivoBody {
    tipo_problema?: string
    accion?: string
    datos?: Record<string, unknown> | null
  }
  let body: MasivoBody
  try {
    body = (await request.json()) as MasivoBody
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 })
  }

  const { tipo_problema, accion, datos } = body
  if (!accion) {
    return NextResponse.json({ ok: false, error: 'Falta accion' }, { status: 400 })
  }

  const supa = getSupabaseAdmin()

  const { data: imp } = await supa
    .from('importaciones')
    .select('id, usuario_id')
    .eq('id', params.id)
    .maybeSingle()
  if (!imp) {
    return NextResponse.json(
      { ok: false, error: 'Importación no encontrada' },
      { status: 404 }
    )
  }
  const own = requireOwnership(usuario, { usuario_id: (imp as { usuario_id: string }).usuario_id })
  if (own) return own

  let q = supa
    .from('importacion_registros_dudosos')
    .select('id')
    .eq('importacion_id', params.id)
    .eq('estado_resolucion', 'PENDIENTE')
  if (tipo_problema) q = q.eq('tipo_problema', tipo_problema)

  const { data: pendientes } = await q
  const ids = ((pendientes || []) as Array<{ id: string }>).map((p) => p.id)
  if (ids.length === 0) {
    return NextResponse.json({ ok: true, actualizados: 0, restantes: 0, listo_para_importar: true })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errUpd } = await (supa.from('importacion_registros_dudosos') as any)
    .update({
      estado_resolucion: 'RESUELTO',
      resolucion_accion: accion,
      resolucion_datos: datos ?? null,
      fecha_resolucion: new Date().toISOString(),
      resuelto_por_usuario_id: usuario.id,
    })
    .in('id', ids)

  if (errUpd) {
    return NextResponse.json({ ok: false, error: errUpd.message }, { status: 500 })
  }

  const { count: restantes } = await supa
    .from('importacion_registros_dudosos')
    .select('id', { count: 'exact', head: true })
    .eq('importacion_id', params.id)
    .eq('estado_resolucion', 'PENDIENTE')

  const listo = (restantes || 0) === 0
  if (listo) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supa.from('importaciones') as any)
      .update({ estado_proceso: 'REVISANDO' })
      .eq('id', params.id)
  }

  return NextResponse.json({
    ok: true,
    actualizados: ids.length,
    restantes: restantes || 0,
    listo_para_importar: listo,
  })
}
