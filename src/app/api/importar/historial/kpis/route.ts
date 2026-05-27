import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { aplicarFiltroCartera } from '@/lib/cartera-filter'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  const supabase = getSupabaseAdmin()

  // total_importaciones
  let qTotal = supabase
    .from('importaciones')
    .select('id', { count: 'exact', head: true })
  qTotal = aplicarFiltroCartera(qTotal, usuario)
  const { count: totalCount, error: errTotal } = await qTotal
  if (errTotal) {
    return NextResponse.json({ ok: false, error: errTotal.message }, { status: 500 })
  }

  // total_registros_importados — traer últimas 1000 COMPLETADA no deshechas
  // TODO: si total_importaciones_completadas > 1000, considerar materializar este agregado.
  let qReg = supabase
    .from('importaciones')
    .select('clientes_creados, polizas_creadas')
    .eq('estado_proceso', 'COMPLETADA')
    .or('deshecha.is.null,deshecha.eq.false')
    .order('created_at', { ascending: false })
    .limit(1000)
  qReg = aplicarFiltroCartera(qReg, usuario)
  const { data: regRows, error: errReg } = await qReg
  if (errReg) {
    return NextResponse.json({ ok: false, error: errReg.message }, { status: 500 })
  }
  type RegRow = { clientes_creados: number | null; polizas_creadas: number | null }
  const totalRegistros = ((regRows ?? []) as RegRow[]).reduce(
    (acc, r) => acc + (r.clientes_creados ?? 0) + (r.polizas_creadas ?? 0),
    0
  )

  // ultima_importacion — más reciente COMPLETADA
  let qUlt = supabase
    .from('importaciones')
    .select('id, fecha_fin, estado_proceso, nombre_archivo')
    .eq('estado_proceso', 'COMPLETADA')
    .order('fecha_fin', { ascending: false, nullsFirst: false })
    .limit(1)
  qUlt = aplicarFiltroCartera(qUlt, usuario)
  const { data: ultRows, error: errUlt } = await qUlt
  if (errUlt) {
    return NextResponse.json({ ok: false, error: errUlt.message }, { status: 500 })
  }
  type UltRow = { id: string; fecha_fin: string | null; estado_proceso: string; nombre_archivo: string }
  const ultima = ((ultRows ?? []) as UltRow[])[0] ?? null

  // importaciones_esta_semana — desde lunes 00:00 local
  const now = new Date()
  const day = now.getDay() // 0=dom..6=sab
  const diffDays = day === 0 ? 6 : day - 1
  const inicioSemana = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - diffDays,
    0,
    0,
    0,
    0
  )

  let qSem = supabase
    .from('importaciones')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', inicioSemana.toISOString())
  qSem = aplicarFiltroCartera(qSem, usuario)
  const { count: semanaCount, error: errSem } = await qSem
  if (errSem) {
    return NextResponse.json({ ok: false, error: errSem.message }, { status: 500 })
  }

  return NextResponse.json(
    {
      ok: true,
      total_importaciones: totalCount ?? 0,
      total_registros_importados: totalRegistros,
      ultima_importacion: ultima,
      importaciones_esta_semana: semanaCount ?? 0,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
