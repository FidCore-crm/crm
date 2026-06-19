import { NextResponse } from 'next/server'
import { validarCronSecret } from '@/lib/cron-auth'
import { encolarEmailSistema } from '@/lib/comunicaciones-sender'
import { logger } from '@/lib/errores'

// POST — Notificar al admin que el sistema de actualizaciones disparó un rollback
//
// Lo llama `scripts/aplicar-actualizacion.sh` al final del rollback automático.
// El script vive en el HOST (fuera del container) y se comunica con el CRM por
// HTTP loopback. Auth con CRON_SECRET (igual que el resto de crons internos).
//
// Cuerpo esperado:
//   {
//     "version_intentada": "1.0.16",
//     "version_actual":    "1.0.15",
//     "motivo_fallo":      "Build de Docker falló: ...",
//     "rollback_exitoso":  true | false
//   }
//
// Nota: el evento ROLLBACK_UPDATE está marcado es_critico=true, así que NO
// depende de toggles informativos — siempre se envía al admin.
export async function POST(request: Request) {
  const authError = await validarCronSecret(request)
  if (authError) return authError

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 })
  }

  const version_intentada = String(body.version_intentada ?? '').trim() || 'desconocida'
  const version_actual    = String(body.version_actual    ?? '').trim() || 'desconocida'
  const motivo_fallo      = String(body.motivo_fallo      ?? '').trim() || 'sin detalles'
  const rollback_exitoso  = body.rollback_exitoso === true

  const resultado_rollback = rollback_exitoso
    ? `Exitoso — el sistema volvió a v${version_actual}.`
    : 'INCOMPLETO — revisar manualmente el servidor.'

  try {
    const result = await encolarEmailSistema({
      tipo_evento: 'ROLLBACK_UPDATE',
      variables_extra: {
        version_intentada,
        version_actual,
        motivo_fallo,
        resultado_rollback,
        fecha_evento: new Date().toISOString(),
      },
    })

    logger.warn({
      modulo: 'updater',
      mensaje: 'Rollback automático del updater notificado',
      contexto: { version_intentada, version_actual, rollback_exitoso, envios_creados: result.envios_creados },
    })

    return NextResponse.json({ ok: true, envios_creados: result.envios_creados })
  } catch (err: any) {
    logger.error({
      modulo: 'updater',
      mensaje: 'Falló el encolado de notificación de rollback',
      contexto: { err: String(err?.message ?? err) },
    })
    // No tiramos 500: para el script bash este endpoint es best-effort.
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 200 })
  }
}
