import { NextResponse } from 'next/server'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { chequearCatalogosFaltantes } from '@/lib/importacion/chequeo-catalogos'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: { id: string } }) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth
  const { id } = context.params

  const supa = getSupabaseAdmin()
  const { data: imp, error } = await supa
    .from('importaciones')
    .select('id, usuario_id, estado_proceso')
    .eq('id', id)
    .maybeSingle()

  if (error || !imp) {
    return NextResponse.json({ ok: false, error: 'Importación no encontrada' }, { status: 404 })
  }

  type ImpRow = { usuario_id: string; estado_proceso: string }
  const impRow = imp as ImpRow
  const own = requireOwnership(usuario, { usuario_id: impRow.usuario_id })
  if (own) return own

  const faltantes = await chequearCatalogosFaltantes(id)

  return NextResponse.json({ ok: true, faltantes })
}
