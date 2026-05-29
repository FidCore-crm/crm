/**
 * GET /api/cron/ejecutar-campanas-programadas
 *
 * Cron que busca campañas en estado PROGRAMADA cuya `programada_para` ya
 * pasó y las dispara. También reanuda automáticamente cualquier campaña que
 * haya quedado en EJECUTANDO con `personas_procesadas_ids` parcial (crash
 * del proceso anterior).
 *
 * Se invoca desde `scripts/startup-crons.sh` (cada 4h con resto de crons).
 * Protegido por CRON_SECRET.
 */

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { ejecutarCampana } from '@/lib/mailings/ejecutar-campana'
import { logger } from '@/lib/errores'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function validarCronSecret(request: Request): boolean {
  const auth = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (!process.env.CRON_SECRET) return false
  return auth === expected
}

export async function GET(request: Request) {
  if (!validarCronSecret(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const supabase = getSupabaseAdmin()
  const ahora = new Date().toISOString()

  // 1) Campañas programadas listas para ejecutar
  const { data: programadas } = await supabase
    .from('mailing_campanas')
    .select('id, nombre')
    .eq('estado', 'PROGRAMADA')
    .lte('programada_para', ahora)
    .limit(10)

  // 2) Campañas EJECUTANDO huérfanas (con fecha_inicio > 30 min y sin actualización reciente)
  // Las consideramos crasheadas y las reanudamos (el motor es idempotente).
  const limiteHuerfana = new Date(Date.now() - 30 * 60_000).toISOString()
  const { data: huerfanas } = await supabase
    .from('mailing_campanas')
    .select('id, nombre')
    .eq('estado', 'EJECUTANDO')
    .lt('updated_at', limiteHuerfana)
    .limit(5)

  const aProcesar = [
    ...(programadas ?? []).map((c: any) => ({ ...c, motivo: 'programada' })),
    ...(huerfanas ?? []).map((c: any) => ({ ...c, motivo: 'huerfana' })),
  ]

  if (aProcesar.length === 0) {
    return NextResponse.json({ ok: true, procesadas: 0 })
  }

  // Las huérfanas necesitan volver a PAUSADA primero para que ejecutarCampana
  // pueda reanudarlas (sólo arranca desde BORRADOR/PROGRAMADA/PAUSADA)
  if (huerfanas && huerfanas.length > 0) {
    await (supabase.from('mailing_campanas') as any)
      .update({ estado: 'PAUSADA', ultimo_error: 'Reiniciada por cron (huerfana)' })
      .in('id', huerfanas.map((c: any) => c.id))
  }

  let procesadas = 0
  const resultados: any[] = []
  for (const c of aProcesar) {
    try {
      const res = await ejecutarCampana(c.id)
      resultados.push({ id: c.id, nombre: c.nombre, motivo: c.motivo, ...res })
      procesadas++
    } catch (err: any) {
      logger.error({
        modulo: 'cron-campanas',
        mensaje: `Error procesando campaña ${c.id}`,
        contexto: { error: String(err) },
      })
      resultados.push({ id: c.id, nombre: c.nombre, motivo: c.motivo, ok: false, error: String(err) })
    }
  }

  return NextResponse.json({ ok: true, procesadas, resultados })
}
