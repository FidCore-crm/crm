import { NextResponse } from 'next/server'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { checkLicenciaActiva } from '@/lib/licencia-guard'
import type { ArchivoMetadata, EstadisticasImportacion, PlanImportacion } from '@/lib/importacion/types'

export const dynamic = 'force-dynamic'

const ESTADOS_PLAN_DISPONIBLE = new Set(['ANALIZADO', 'REVISANDO', 'IMPORTANDO', 'COMPLETADA'])

interface ImportacionPlanRow {
  id: string
  usuario_id: string
  estado_proceso: string
  plan_importacion: PlanImportacion | null
  archivos_metadata: ArchivoMetadata[] | null
  estadisticas: EstadisticasImportacion | null
  compania_id: string | null
}

interface PlanPatchBody {
  mapeo?: Record<string, unknown>
  ignorar_columnas?: unknown
  compania_id?: string | null
  modo_limpieza_ia?: 'NORMAL' | 'AGRESIVO'
}

async function cargarImportacion(id: string) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('importaciones')
    .select('id, usuario_id, estado_proceso, plan_importacion, archivos_metadata, estadisticas, compania_id')
    .eq('id', id)
    .maybeSingle()
  return { data: data as ImportacionPlanRow | null, error }
}

export async function GET(request: Request, context: { params: { id: string } }) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth
  const { id } = context.params

  const { data: imp, error } = await cargarImportacion(id)
  if (error || !imp) {
    return NextResponse.json({ ok: false, error: 'Importación no encontrada' }, { status: 404 })
  }
  const own = requireOwnership(usuario, { usuario_id: imp.usuario_id })
  if (own) return own

  const estado = imp.estado_proceso
  if (!ESTADOS_PLAN_DISPONIBLE.has(estado)) {
    return NextResponse.json(
      { ok: false, error: 'El plan aún no está disponible para esta importación' },
      { status: 400 }
    )
  }

  return NextResponse.json({
    ok: true,
    plan_importacion: imp.plan_importacion ?? null,
    archivos_metadata: imp.archivos_metadata ?? null,
    estadisticas: imp.estadisticas ?? null,
  })
}

export async function PATCH(request: Request, context: { params: { id: string } }) {
  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth
  const { id } = context.params

  const { data: imp, error } = await cargarImportacion(id)
  if (error || !imp) {
    return NextResponse.json({ ok: false, error: 'Importación no encontrada' }, { status: 404 })
  }
  const own = requireOwnership(usuario, { usuario_id: imp.usuario_id })
  if (own) return own

  if (imp.estado_proceso !== 'ANALIZADO') {
    return NextResponse.json(
      { ok: false, error: 'Solo se puede editar el plan cuando el estado es ANALIZADO' },
      { status: 400 }
    )
  }

  let body: PlanPatchBody
  try {
    body = (await request.json()) as PlanPatchBody
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 })
  }

  const { mapeo, ignorar_columnas, compania_id, modo_limpieza_ia } = body ?? {}

  const planActual = (imp.plan_importacion ?? {}) as Partial<PlanImportacion> & Record<string, unknown>
  const planNuevo = {
    ...planActual,
    mapeo_propuesto: {
      ...(planActual.mapeo_propuesto ?? {}),
      ...(mapeo ?? {}),
    },
    ...(ignorar_columnas !== undefined ? { ignorar_columnas } : {}),
    ...(modo_limpieza_ia === 'NORMAL' || modo_limpieza_ia === 'AGRESIVO'
      ? { modo_limpieza_ia }
      : {}),
  }

  const supabase = getSupabaseAdmin()
  const update: Record<string, unknown> = { plan_importacion: planNuevo }
  if (compania_id !== undefined) update.compania_id = compania_id

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errUpd } = await (supabase.from('importaciones') as any)
    .update(update)
    .eq('id', id)

  if (errUpd) {
    return NextResponse.json({ ok: false, error: errUpd.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    plan_importacion: planNuevo,
    compania_id: compania_id ?? imp.compania_id,
  })
}
