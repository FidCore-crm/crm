/**
 * POST /api/comunicaciones/campanas/[id]/enviar
 *
 * Dispara la ejecución de la campaña INMEDIATAMENTE (independiente del schedule).
 * Si la campaña ya está EJECUTANDO o COMPLETADA, rechaza.
 *
 * El loop de envío corre fire-and-forget (no bloquea la respuesta HTTP) — el
 * cliente debe pollear `/campanas/[id]` para ver el progreso.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { ejecutarCampana } from '@/lib/mailings/ejecutar-campana'
import { checkLicenciaActiva } from '@/lib/licencia-guard'

export const dynamic = 'force-dynamic'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo

  const { id } = await ctx.params
  if (!UUID_REGEX.test(id)) return NextResponse.json({ ok: false, error: 'ID inválido' }, { status: 400 })

  const supabase = getSupabaseAdmin()
  const { data: c } = await supabase
    .from('mailing_campanas').select('id, estado').eq('id', id).maybeSingle()
  if (!c) return NextResponse.json({ ok: false, error: 'No encontrada' }, { status: 404 })

  const estado = (c as any).estado
  if (estado === 'EJECUTANDO') {
    return NextResponse.json({ ok: false, error: 'La campaña ya está en ejecución' }, { status: 400 })
  }
  if (estado === 'COMPLETADA') {
    return NextResponse.json({ ok: false, error: 'La campaña ya fue completada' }, { status: 400 })
  }
  if (estado === 'CANCELADA') {
    return NextResponse.json({ ok: false, error: 'La campaña fue cancelada' }, { status: 400 })
  }

  // Disparar en background (no esperamos a que termine)
  ejecutarCampana(id).catch(err => {
    console.error(`[campanas] Error fire-and-forget en ${id}:`, err)
  })

  return NextResponse.json({ ok: true, mensaje: 'Campaña iniciada. Refrescá para ver el progreso.' })
}
