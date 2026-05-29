/**
 * POST /api/comunicaciones/campanas/[id]/cancelar
 *
 * Cancela una campaña en BORRADOR / PROGRAMADA / PAUSADA. No se puede cancelar
 * una EJECUTANDO (pausala primero) ni una COMPLETADA.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  if (!UUID_REGEX.test(id)) return NextResponse.json({ ok: false, error: 'ID inválido' }, { status: 400 })

  const supabase = getSupabaseAdmin()
  const { data, error } = await (supabase.from('mailing_campanas') as any)
    .update({ estado: 'CANCELADA', fecha_fin_ejecucion: new Date().toISOString() })
    .eq('id', id)
    .in('estado', ['BORRADOR', 'PROGRAMADA', 'PAUSADA'])
    .select('id')

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  if (!data || data.length === 0) {
    return NextResponse.json({ ok: false, error: 'Solo se pueden cancelar campañas en borrador, programadas o pausadas' }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
