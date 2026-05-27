import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { validarCronSecret } from '@/lib/cron-auth'
import { logger } from '@/lib/errores'
import { purgarPersonaDefinitivamente } from '@/lib/personas-purga'

export const maxDuration = 300

const DIAS_RETENCION_PAPELERA = 30

/**
 * Cron diario que purga personas con `deleted_at` > 30 días.
 * Borra físicamente la persona, su cascada (pólizas, siniestros, tareas,
 * archivos en disco) y notificaciones vinculadas.
 *
 * Llamado desde scripts/startup-crons.sh.
 * Protegido con CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const validacion = await validarCronSecret(request)
  if (validacion) return validacion

  const supabase = getSupabaseAdmin()

  const limite = new Date(Date.now() - DIAS_RETENCION_PAPELERA * 24 * 60 * 60 * 1000)

  const { data: personas, error } = await supabase
    .from('personas')
    .select('id, dni_cuil, deleted_at')
    .not('deleted_at', 'is', null)
    .lt('deleted_at', limite.toISOString())

  if (error) {
    logger.error({ modulo: 'cron-personas-purgar', mensaje: 'Error consultando papelera', contexto: { error: error.message } })
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const lista = (personas ?? []) as any[]
  let purgadas = 0
  const errores: Array<{ id: string; error: string }> = []

  for (const p of lista) {
    try {
      await purgarPersonaDefinitivamente(p.id, supabase)
      purgadas++
    } catch (err: any) {
      logger.warn({
        modulo: 'cron-personas-purgar',
        mensaje: 'Error purgando persona',
        contexto: { persona_id: p.id, error: err?.message ?? String(err) },
      })
      errores.push({ id: p.id, error: err?.message ?? String(err) })
    }
  }

  return NextResponse.json({
    ok: true,
    revisadas: lista.length,
    purgadas,
    errores,
    dias_retencion: DIAS_RETENCION_PAPELERA,
  })
}
