import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { validarCronSecret } from '@/lib/cron-auth'
import { logger } from '@/lib/errores'
import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cron/limpiar-campanas-storage
 *
 * Limpia `storage/campanas/{campana_id}/` para campañas en estado terminal
 * (COMPLETADA / CANCELADA) hace más de N días.
 *
 * Contexto (v1.0.180): desde el refactor async de v1.0.179, los adjuntos de
 * envíos masivos se guardan en `storage/campanas/{id}/` para sobrevivir al
 * request y a envíos programados. Una vez que la campaña completó y pasaron
 * los N días de retención, esos archivos ya no aportan valor operativo
 * (los emails ya se enviaron con los adjuntos, el historial mantiene la
 * lista de nombres de archivo en `email_envios.archivos_adjuntos`).
 *
 * Criterio:
 *   - Estado: COMPLETADA o CANCELADA.
 *   - fecha_fin_ejecucion (o updated_at si no la tiene) < NOW() - N días.
 *   - N configurable en `configuracion_comunicaciones.retener_adjuntos_campana_dias`
 *     (default 30).
 *
 * NO borra la fila de mailing_campanas — solo los archivos físicos. La
 * metadata (nombres, tamaños, resultados) queda para el historial.
 *
 * Idempotente: si la carpeta ya no existe (o nunca hubo adjuntos), skip.
 *
 * Protegido con CRON_SECRET. Se llama desde scripts/startup-crons-lentos.sh.
 */
export async function GET(request: Request) {
  const authError = await validarCronSecret(request)
  if (authError) return authError

  const supabase = getSupabaseAdmin()

  // Leer retención configurada (default 30 días)
  const { data: config } = await supabase
    .from('configuracion_comunicaciones')
    .select('retener_adjuntos_campana_dias')
    .limit(1)
    .maybeSingle()
  const dias = (config as any)?.retener_adjuntos_campana_dias ?? 30

  const limite = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()

  const { data: candidatas, error } = await supabase
    .from('mailing_campanas')
    .select('id, estado, fecha_fin_ejecucion, updated_at')
    .in('estado', ['COMPLETADA', 'CANCELADA'])
    .or(`fecha_fin_ejecucion.lt.${limite},and(fecha_fin_ejecucion.is.null,updated_at.lt.${limite})`)

  if (error) {
    return NextResponse.json({ ok: false, error: 'No se pudo listar campañas' }, { status: 500 })
  }

  const projectRoot = process.env.PROJECT_ROOT || process.cwd()
  const baseCampanas = path.join(projectRoot, 'storage', 'campanas')

  let carpetas_borradas = 0
  let mb_liberados = 0
  const errores: string[] = []

  for (const c of (candidatas ?? []) as any[]) {
    const carpeta = path.join(baseCampanas, c.id)
    if (!fs.existsSync(carpeta)) continue

    try {
      // Calcular tamaño antes de borrar (para el log)
      let tamano = 0
      for (const nombre of fs.readdirSync(carpeta)) {
        try {
          const stat = fs.statSync(path.join(carpeta, nombre))
          if (stat.isFile()) tamano += stat.size
        } catch { /* skip archivo con error */ }
      }
      fs.rmSync(carpeta, { recursive: true, force: true })
      carpetas_borradas++
      mb_liberados += tamano / (1024 * 1024)
    } catch (err: any) {
      errores.push(`${c.id}: ${err?.message}`)
      logger.warn({
        modulo: 'cron',
        mensaje: 'No se pudo borrar carpeta de campaña',
        contexto: { campana_id: c.id, error: err?.message },
      })
    }
  }

  const total_mb = Number(mb_liberados.toFixed(2))
  logger.info({
    modulo: 'cron',
    mensaje: `Limpieza de adjuntos de campañas: ${carpetas_borradas} borradas, ${total_mb} MB liberados`,
    contexto: { carpetas_borradas, mb_liberados: total_mb, retencion_dias: dias },
  })

  return NextResponse.json({
    ok: true,
    carpetas_borradas,
    mb_liberados: total_mb,
    retencion_dias: dias,
    errores: errores.slice(0, 20),
  })
}
