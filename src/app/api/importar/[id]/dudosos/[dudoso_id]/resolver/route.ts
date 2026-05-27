import { NextResponse } from 'next/server'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { checkLicenciaActiva } from '@/lib/licencia-guard'

export const dynamic = 'force-dynamic'

const ACCIONES_VALIDAS = new Set([
  'ACEPTAR_PROPUESTA',
  'EDITAR',
  'IGNORAR_REGISTRO',
  'ACTUALIZAR_EXISTENTE',
  'CREAR_NUEVO',
])

export async function POST(
  request: Request,
  context: { params: { id: string; dudoso_id: string } }
) {
  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth
  const { id, dudoso_id } = context.params

  const supabase = getSupabaseAdmin()
  const { data: imp, error } = await supabase
    .from('importaciones')
    .select('id, usuario_id, estado_proceso')
    .eq('id', id)
    .maybeSingle()

  if (error || !imp) {
    return NextResponse.json({ ok: false, error: 'Importación no encontrada' }, { status: 404 })
  }
  const own = requireOwnership(usuario, { usuario_id: (imp as { usuario_id: string }).usuario_id })
  if (own) return own

  interface ResolverBody {
    accion?: string
    datos?: Record<string, unknown> | null
  }
  let body: ResolverBody
  try {
    body = (await request.json()) as ResolverBody
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 })
  }

  const { accion, datos } = body ?? {}
  if (!accion || !ACCIONES_VALIDAS.has(accion)) {
    return NextResponse.json({ ok: false, error: 'accion inválida' }, { status: 400 })
  }

  const { data: dud, error: errDud } = await supabase
    .from('importacion_registros_dudosos')
    .select('id, importacion_id')
    .eq('id', dudoso_id)
    .maybeSingle()

  if (errDud || !dud) {
    return NextResponse.json({ ok: false, error: 'Registro dudoso no encontrado' }, { status: 404 })
  }
  if ((dud as { importacion_id: string }).importacion_id !== id) {
    return NextResponse.json(
      { ok: false, error: 'El dudoso no pertenece a esta importación' },
      { status: 400 }
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errUpd } = await (supabase.from('importacion_registros_dudosos') as any)
    .update({
      estado_resolucion: 'RESUELTO',
      resolucion_accion: accion,
      resolucion_datos: datos ?? null,
      fecha_resolucion: new Date().toISOString(),
      resuelto_por_usuario_id: usuario.id,
    })
    .eq('id', dudoso_id)

  if (errUpd) {
    return NextResponse.json({ ok: false, error: errUpd.message }, { status: 500 })
  }

  const { count: restantes } = await supabase
    .from('importacion_registros_dudosos')
    .select('id', { count: 'exact', head: true })
    .eq('importacion_id', id)
    .eq('estado_resolucion', 'PENDIENTE')

  const listo = (restantes ?? 0) === 0
  if (listo) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('importaciones') as any)
      .update({ estado_proceso: 'REVISANDO' })
      .eq('id', id)
  }

  return NextResponse.json({
    ok: true,
    listo_para_importar: listo,
    pendientes_restantes: restantes ?? 0,
  })
}
