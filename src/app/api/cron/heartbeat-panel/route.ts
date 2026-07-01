/**
 * GET /api/cron/heartbeat-panel
 *
 * Reporta al panel de administración de FidCore (SaaS-managed) el estado
 * técnico de esta instalación: versión, último backup, estado del servicio.
 *
 * Se ejecuta desde el cron principal cada 4h. Es OPT-IN: si las env vars
 * `PANEL_URL` y `PANEL_HEARTBEAT_TOKEN` no están seteadas en `.env.docker`,
 * el cron devuelve `{ ok: true, skipped: true }` sin hacer nada — el
 * instalador setea esas vars solo si querés que la instalación reporte.
 *
 * Instalaciones on-premise antiguas o clientes que no quieran heartbeatear
 * no reciben cambios en su comportamiento.
 */

import type { NextRequest } from 'next/server'
import { manejarErrores, respuestaExito, logger } from '@/lib/errores'
import { validarCronSecret } from '@/lib/cron-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { obtenerInstalacionId } from '@/lib/instalacion-id'
import { obtenerModo } from '@/lib/modo-instalacion'
import { obtenerEstadoServicio } from '@/lib/estado-servicio'

// La versión se lee del package.json en runtime.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../../../../package.json') as { version: string }

async function ultimoBackupExitoso(): Promise<string | null> {
  try {
    const supabase = getSupabaseAdmin()
    const { data } = await supabase
      .from('backups')
      .select('fecha_fin')
      .eq('estado', 'COMPLETADO')
      .order('fecha_fin', { ascending: false })
      .limit(1)
      .maybeSingle()
    return (data as any)?.fecha_fin ?? null
  } catch {
    return null
  }
}

export const GET = manejarErrores(async (request: NextRequest) => {
  const errCron = await validarCronSecret(request)
  if (errCron) return errCron

  const panelUrl = process.env.PANEL_URL
  const token = process.env.PANEL_HEARTBEAT_TOKEN

  // Opt-in: si el PAS/instalador no configuró el panel, no reportamos.
  if (!panelUrl || !token) {
    return respuestaExito({ skipped: true, motivo: 'PANEL_URL o PANEL_HEARTBEAT_TOKEN no configuradas' })
  }

  const instalacionId = obtenerInstalacionId()
  const modo = obtenerModo()
  const version = pkg.version
  const estadoServicio = await obtenerEstadoServicio()
  const ultimoBackup = await ultimoBackupExitoso()

  // Hostname público. Preferimos el env var, sino fallback a la config de DB.
  let url: string | undefined = process.env.URL_CRM_PUBLICA
  if (!url) {
    try {
      const supabase = getSupabaseAdmin()
      const { data } = await supabase
        .from('configuracion')
        .select('url_crm')
        .limit(1)
        .maybeSingle()
      url = (data as any)?.url_crm ?? undefined
    } catch {
      // ignore
    }
  }
  const urlHost = url ? url.replace(/^https?:\/\//, '').replace(/\/$/, '') : undefined

  const payload = {
    instalacion_id: instalacionId,
    url: urlHost,
    version,
    modelo: modo,
    estado_servicio: estadoServicio.estado,
    ultimo_backup_at: ultimoBackup,
  }

  try {
    const res = await fetch(`${panelUrl.replace(/\/$/, '')}/api/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      // El heartbeat debe fallar rápido — si el panel está caído no queremos
      // bloquear el cron 30s esperando.
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      const texto = await res.text().catch(() => '')
      logger.warn({
        modulo: 'heartbeat-panel',
        mensaje: 'Panel rechazó el heartbeat',
        contexto: { status: res.status, respuesta: texto.slice(0, 200) },
      })
      return respuestaExito({
        skipped: false,
        enviado: false,
        error: `Panel devolvió ${res.status}`,
      })
    }

    return respuestaExito({
      enviado: true,
      instalacion_id: instalacionId,
      version,
    })
  } catch (err: any) {
    logger.warn({
      modulo: 'heartbeat-panel',
      mensaje: 'No se pudo contactar al panel',
      contexto: { error: err?.message || String(err) },
    })
    return respuestaExito({
      skipped: false,
      enviado: false,
      error: err?.message || 'Error de red',
    })
  }
}, { modulo: 'heartbeat-panel' })
