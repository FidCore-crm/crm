import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { validarCronSecret } from '@/lib/cron-auth'
import { logger } from '@/lib/errores'
import { purgarSiniestroDefinitivamente } from '@/lib/siniestros-purga'

export const maxDuration = 300

const DIAS_RETENCION_PAPELERA = 30

/**
 * Cron diario que purga siniestros con `deleted_at` > 30 días.
 * Borra físicamente el siniestro, su bitácora (CASCADE), archivos en disco
 * y notificaciones vinculadas.
 *
 * Llamado desde scripts/startup-crons.sh. Protegido con CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const validacion = await validarCronSecret(request)
  if (validacion) return validacion

  const supabase = getSupabaseAdmin()

  const limite = new Date(Date.now() - DIAS_RETENCION_PAPELERA * 24 * 60 * 60 * 1000)

  const { data: siniestros, error } = await supabase
    .from('siniestros')
    .select('id, numero_caso, deleted_at')
    .not('deleted_at', 'is', null)
    .lt('deleted_at', limite.toISOString())

  if (error) {
    logger.error({
      modulo: 'cron-siniestros-purgar',
      mensaje: 'Error consultando papelera',
      contexto: { error: error.message },
    })
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const lista = (siniestros ?? []) as any[]
  let purgados = 0
  const errores: Array<{ id: string; error: string }> = []

  for (const s of lista) {
    try {
      await purgarSiniestroDefinitivamente(s.id, supabase)
      purgados++
    } catch (err: any) {
      logger.warn({
        modulo: 'cron-siniestros-purgar',
        mensaje: 'Error purgando siniestro',
        contexto: { siniestro_id: s.id, error: err?.message ?? String(err) },
      })
      errores.push({ id: s.id, error: err?.message ?? String(err) })
    }
  }

  return NextResponse.json({
    ok: true,
    revisados: lista.length,
    purgados,
    errores,
    dias_retencion: DIAS_RETENCION_PAPELERA,
  })
}
