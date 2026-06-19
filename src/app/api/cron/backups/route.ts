import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { ejecutarBackup } from '@/lib/backup-runner'
import { validarCronSecret } from '@/lib/cron-auth'
import { hoyAR } from '@/lib/utils'

// GET — Cron de backups (llamado por systemd timer)
export async function GET(request: Request) {
  const authError = await validarCronSecret(request)
  if (authError) return authError

  const supabase = getSupabaseAdmin()

  const { data: config } = await supabase
    .from('configuracion_backups')
    .select('activo, hora_backup')
    .limit(1)
    .maybeSingle()

  if (!config || !(config as any).activo) {
    return NextResponse.json({
      ok: true,
      mensaje: 'Sistema de backups desactivado',
    })
  }

  // Verificar si ya se hizo backup hoy (gate anti-duplicación).
  // Usamos hoyAR() para que el "hoy" del cron sea el día calendario argentino,
  // no UTC. Entre 21:00 y 23:59 ARG, el día UTC ya cambió: si comparáramos contra
  // UTC el cron podría disparar 2 backups dentro del mismo día calendario AR.
  const hoy = hoyAR()
  // Inicio del día AR en UTC: 2026-05-26 00:00 ARG = 2026-05-26 03:00 UTC (ART = UTC-3).
  const inicioDiaAR_UTC = `${hoy}T03:00:00.000Z`
  const { data: backupHoy } = await supabase
    .from('backups')
    .select('id, estado')
    .gte('fecha_inicio', inicioDiaAR_UTC)
    .in('estado', ['COMPLETADO', 'COMPLETADO_CON_ERRORES', 'EN_PROCESO'])
    .limit(1)
    .maybeSingle()

  if (backupHoy) {
    return NextResponse.json({
      ok: true,
      mensaje: 'Ya se realizo backup hoy',
    })
  }

  const result = await ejecutarBackup({ tipo: 'AUTOMATICO' })

  return NextResponse.json({
    ok: result.ok,
    mensaje: result.ok
      ? `Backup completado: ${result.nombre} (${result.duracion_segundos}s)`
      : `Backup fallo: ${result.error}`,
    resultado: result,
  })
}
