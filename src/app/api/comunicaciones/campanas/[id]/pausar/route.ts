/**
 * POST /api/comunicaciones/campanas/[id]/pausar
 * POST /api/comunicaciones/campanas/[id]/cancelar
 *
 * Pausar: marca PAUSADA. El loop de envío detecta el cambio antes del próximo
 *   destinatario y se detiene limpio (guarda progreso parcial). Se puede
 *   reanudar con "Enviar".
 *
 * Cancelar: marca CANCELADA (solo si está en BORRADOR o PROGRAMADA — no se
 *   puede cancelar una EJECUTANDO).
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
  // Atómico: solo pausa si está EJECUTANDO (sino devuelve error)
  const { data, error } = await (supabase.from('mailing_campanas') as any)
    .update({ estado: 'PAUSADA' })
    .eq('id', id)
    .eq('estado', 'EJECUTANDO')
    .select('id')

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  if (!data || data.length === 0) {
    return NextResponse.json({ ok: false, error: 'Solo se pueden pausar campañas que están ejecutándose' }, { status: 400 })
  }

  return NextResponse.json({ ok: true, mensaje: 'Campaña pausada. Se va a detener en el próximo envío.' })
}
