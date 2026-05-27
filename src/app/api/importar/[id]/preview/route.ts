import { NextResponse } from 'next/server'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import type { RegistroProcesado } from '@/lib/importacion/types'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: { id: string } }) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth
  const { id } = context.params

  const url = new URL(request.url)
  const limite = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limite') || '10', 10)))

  const supabase = getSupabaseAdmin()
  const { data: imp, error } = await supabase
    .from('importaciones')
    .select('id, usuario_id')
    .eq('id', id)
    .maybeSingle()

  if (error || !imp) {
    return NextResponse.json({ ok: false, error: 'Importación no encontrada' }, { status: 404 })
  }
  const own = requireOwnership(usuario, { usuario_id: (imp as { usuario_id: string }).usuario_id })
  if (own) return own

  const { data: lotes, error: errLotes } = await supabase
    .from('importacion_lotes')
    .select('numero_lote, registros_procesados_data')
    .eq('importacion_id', id)
    .eq('estado', 'COMPLETADO')
    .order('numero_lote', { ascending: true })

  if (errLotes) {
    return NextResponse.json({ ok: false, error: errLotes.message }, { status: 500 })
  }

  type LoteRow = { numero_lote: number; registros_procesados_data: RegistroProcesado[] | null }
  const registros: RegistroProcesado[] = []
  for (const l of ((lotes ?? []) as LoteRow[])) {
    const data = l.registros_procesados_data
    if (!Array.isArray(data)) continue
    for (const r of data) {
      registros.push(r)
      if (registros.length >= limite) break
    }
    if (registros.length >= limite) break
  }

  return NextResponse.json({
    ok: true,
    registros,
    total_mostrados: registros.length,
  })
}
