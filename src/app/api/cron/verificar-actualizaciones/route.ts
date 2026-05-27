/**
 * GET /api/cron/verificar-actualizaciones
 *
 * Cron que corre cada 4h (junto al resto en startup-crons.sh).
 *
 * Tareas:
 *   1. Consulta GitHub por el último release y compara con la versión actual.
 *   2. Si hay versión nueva:
 *      - Genera notificación in-app `ACTUALIZACION_DISPONIBLE` (una sola vez
 *        por versión — anti-spam por entidad_id = tag del release).
 *      - NO actualiza automáticamente. Solo notifica.
 *   3. Si el toggle `verificar_updates_automatico` está apagado, no notifica.
 *
 * Diseño: no aplicamos updates en automático. El PAS tiene que apretar
 * "Actualizar" o "Programar". Esto es Opción A del roadmap de updates.
 */

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { validarCronSecret } from '@/lib/cron-auth'
import { logger } from '@/lib/errores'
import { consultarUltimaActualizacion } from '@/lib/updater'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const authError = await validarCronSecret(request)
  if (authError) return authError

  try {
    const supabase = getSupabaseAdmin()

    // Toggle global
    const { data: config } = await supabase
      .from('configuracion')
      .select('verificar_updates_automatico')
      .limit(1)
      .maybeSingle()

    if ((config as any)?.verificar_updates_automatico === false) {
      return NextResponse.json({ ok: true, skipped: 'toggle apagado' })
    }

    // Consultar GitHub (forzando para que el cron siempre haga la llamada real)
    const resultado = await consultarUltimaActualizacion({ forzar: true })

    if (!resultado.hay_actualizacion || !resultado.ultimo_release) {
      return NextResponse.json({
        ok: true,
        version_actual: resultado.version_actual,
        sin_updates: true,
      })
    }

    const release = resultado.ultimo_release

    // Anti-spam: evitar generar 100 notificaciones para la misma versión
    // si el cron corre muchas veces antes de que el PAS la lea.
    // Usamos entidad_id = `release:<tag>` como huella.
    const huella = `release:${release.tag}`
    const { data: existente } = await supabase
      .from('notificaciones')
      .select('id')
      .eq('tipo', 'ACTUALIZACION_DISPONIBLE')
      .eq('entidad_id', huella)
      .limit(1)
      .maybeSingle()

    if (existente) {
      return NextResponse.json({
        ok: true,
        version_actual: resultado.version_actual,
        version_disponible: release.version,
        notificacion_ya_existia: true,
      })
    }

    // Generar notificación in-app
    const { error: errNotif } = await (supabase.from('notificaciones') as any).insert({
      tipo: 'ACTUALIZACION_DISPONIBLE',
      prioridad: 'INFORMATIVA',
      titulo: `Nueva versión disponible: Pulzar v${release.version}`,
      mensaje: `Una nueva versión del CRM está lista para instalar. Ver detalles en Configuración → Actualizaciones.`,
      entidad_tipo: 'actualizacion',
      entidad_id: huella,
      url: '/crm/configuracion/actualizaciones',
      usuario_id: null, // global para todos los admins
      leida: false,
    })

    if (errNotif) {
      logger.warn({
        modulo: 'cron-verificar-actualizaciones',
        mensaje: 'No se pudo crear notificación de update disponible',
        contexto: { error: errNotif.message, version: release.version },
      })
    }

    return NextResponse.json({
      ok: true,
      version_actual: resultado.version_actual,
      version_disponible: release.version,
      notificacion_creada: !errNotif,
    })
  } catch (err: any) {
    logger.error({
      modulo: 'cron-verificar-actualizaciones',
      mensaje: 'Error en cron de verificación de updates',
      contexto: { error: String(err) },
    })
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error desconocido' },
      { status: 500 },
    )
  }
}
