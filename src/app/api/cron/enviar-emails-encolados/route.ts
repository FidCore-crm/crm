import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { validarCronSecret } from '@/lib/cron-auth'
import { procesarEmailEncolado, encolarEmailSistema } from '@/lib/comunicaciones-sender'
import { logger } from '@/lib/errores'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * GET /api/cron/enviar-emails-encolados
 *
 * Procesa la cola de emails ENCOLADO con `enviar_despues_de <= NOW()`.
 * Máximo 50 emails por ciclo, con delay configurable entre cada uno
 * (configuracion_comunicaciones.delay_entre_envios_automaticos_seg).
 *
 * Si un email falla, crea una notificación tipo EMAIL_AUTOMATICO_FALLIDO
 * para que el admin lo vea en el panel.
 *
 * maxDuration = 300s (5 min) para que quepan los 50 emails × 10s delay.
 */
export async function GET(request: Request) {
  const authError = await validarCronSecret(request)
  if (authError) return authError

  const supabase = getSupabaseAdmin()

  // Leer delay config
  const { data: config } = await supabase
    .from('configuracion_comunicaciones')
    .select('activo, delay_entre_envios_automaticos_seg')
    .limit(1)
    .maybeSingle()

  if (!config || !(config as any).activo) {
    return NextResponse.json({ ok: true, mensaje: 'Sistema de comunicaciones desactivado' })
  }

  const delaySeg = (config as any).delay_entre_envios_automaticos_seg ?? 10

  // Tomar hasta 50 emails encolados listos para enviar.
  // Priorizamos ALTA (críticos del sistema) sobre NORMAL, luego por fecha
  // programada y por orden de creación. El índice
  // `idx_email_envios_cola_priorizada` acompaña este ORDER BY.
  const ahora = new Date().toISOString()
  const { data: encolados, error } = await supabase
    .from('email_envios')
    .select('id, tipo_envio, destinatario_email, persona_id')
    .eq('estado', 'ENCOLADO')
    .lte('enviar_despues_de', ahora)
    .order('prioridad', { ascending: false })
    .order('enviar_despues_de', { ascending: true })
    .order('fecha_creacion', { ascending: true })
    .limit(50)

  if (error) {
    return NextResponse.json({ ok: false, error: 'Error al obtener los datos' }, { status: 500 })
  }
  if (!encolados || encolados.length === 0) {
    return NextResponse.json({ ok: true, procesados: 0 })
  }

  let exitosos = 0
  let fallidos = 0
  const errores: string[] = []

  for (let i = 0; i < encolados.length; i++) {
    const row = encolados[i] as any
    const envioId = row.id as string
    const tipoEnvio = row.tipo_envio as string
    try {
      const res = await procesarEmailEncolado(envioId)
      if (res.ok) {
        exitosos++
      } else {
        fallidos++
        if (res.error) errores.push(`${envioId}: ${res.error}`)

        // Notificar al admin SOLO si falló un email automático al CLIENTE
        // (AUTOMATICO_*). Los SISTEMA_* que fallan NO se notifican por email
        // para evitar bucles infinitos (un email de sistema fallido generaría
        // otro email de sistema, que podría fallar, etc.). Los logs del cron
        // son la única traza para esos casos.
        if (tipoEnvio.startsWith('AUTOMATICO_')) {
          try {
            // Resolver nombre del cliente si hay persona_id
            let nombreCliente = 'Cliente'
            if (row.persona_id) {
              const { data: per } = await supabase
                .from('personas')
                .select('nombre, apellido, razon_social')
                .eq('id', row.persona_id)
                .maybeSingle()
              if (per) {
                const p = per as any
                nombreCliente = p.razon_social || [p.nombre, p.apellido].filter(Boolean).join(' ').trim() || 'Cliente'
              }
            }

            await encolarEmailSistema({
              tipo_evento: 'EMAIL_AUTOMATICO_FALLIDO',
              variables_extra: {
                nombre_cliente: nombreCliente,
                email_destinatario: row.destinatario_email || '',
                tipo_email: tipoEnvio,
                fecha_intento: new Date().toLocaleString('es-AR'),
                error_mensaje: res.error || 'error desconocido',
              },
            })
          } catch (notifErr: any) {
            logger.warn({ modulo: 'cron', mensaje: 'No se pudo encolar notificación de fallo de email', contexto: { envio_id: envioId, error: notifErr?.message } })
          }
        } else {
          // Email de sistema fallido: solo loggear
          logger.error({ modulo: 'cron', mensaje: 'Email de sistema falló', contexto: { tipo_envio: tipoEnvio, envio_id: envioId, error: res.error } })
        }
      }
    } catch (err: any) {
      fallidos++
      errores.push(`${envioId}: ${err?.message}`)
    }

    // Delay entre envíos (excepto después del último)
    if (i < encolados.length - 1 && delaySeg > 0) {
      await new Promise((resolve) => setTimeout(resolve, delaySeg * 1000))
    }
  }

  return NextResponse.json({
    ok: true,
    procesados: encolados.length,
    exitosos,
    fallidos,
    errores: errores.slice(0, 20), // truncar
  })
}
