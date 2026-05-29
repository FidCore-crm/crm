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
 * Procesa hasta 50 emails por ciclo, en este orden:
 *   1. ENCOLADO con `enviar_despues_de <= NOW()`
 *   2. FALLIDO con `error_tipo=TRANSITORIO`, `intentos < 4` y
 *      `proximo_intento_en <= NOW()` (backoff exponencial 30m/2h/8h/24h)
 *
 * Si un email falla, el procesador clasifica el error:
 *   - TRANSITORIO (timeout/4XX/rate limit) → programa el próximo intento
 *   - PERMANENTE (email inválido/5.X.X) → FALLIDO definitivo, no reintentar
 *
 * Notifica al admin (EMAIL_AUTOMATICO_FALLIDO) cuando un AUTOMATICO_* a
 * cliente falla. Los SISTEMA_* solo se loggean (anti-bucle).
 *
 * maxDuration = 300s (5 min).
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

  // Tomar hasta 50 emails listos para procesar (ENCOLADO o FALLIDO con
  // backoff cumplido). Priorizamos ALTA sobre NORMAL.
  const ahora = new Date().toISOString()
  const [encoladosRes, fallidosRes] = await Promise.all([
    supabase
      .from('email_envios')
      .select('id, tipo_envio, destinatario_email, persona_id')
      .eq('estado', 'ENCOLADO')
      .lte('enviar_despues_de', ahora)
      .order('prioridad', { ascending: false })
      .order('enviar_despues_de', { ascending: true })
      .order('fecha_creacion', { ascending: true })
      .limit(50),
    supabase
      .from('email_envios')
      .select('id, tipo_envio, destinatario_email, persona_id')
      .eq('estado', 'FALLIDO')
      .eq('error_tipo', 'TRANSITORIO')
      .lt('intentos', 4)
      .not('proximo_intento_en', 'is', null)
      .lte('proximo_intento_en', ahora)
      .order('prioridad', { ascending: false })
      .order('proximo_intento_en', { ascending: true })
      .limit(50),
  ])

  if (encoladosRes.error || fallidosRes.error) {
    return NextResponse.json({ ok: false, error: 'Error al obtener los datos' }, { status: 500 })
  }
  // Mergeamos respetando el límite de 50, priorizando los ENCOLADOS frescos.
  const encolados = [
    ...(encoladosRes.data ?? []),
    ...(fallidosRes.data ?? []),
  ].slice(0, 50)

  if (encolados.length === 0) {
    // Aprovechamos el ciclo (sin trabajo) para chequear si hay cola atrasada
    // y avisar al admin si corresponde.
    await alertarSiColaAtrasada(supabase)
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

  // Después de procesar, chequear si quedaron muchos atrasados — eso señala
  // un problema sistémico (SMTP malo, etc.) y vale avisar al admin.
  await alertarSiColaAtrasada(supabase)

  return NextResponse.json({
    ok: true,
    procesados: encolados.length,
    exitosos,
    fallidos,
    errores: errores.slice(0, 20), // truncar
  })
}

/**
 * Si hay más de UMBRAL emails ENCOLADO esperando hace >24h, encola una
 * notificación in-app al admin. Anti-spam: no repetir el aviso si ya hay
 * una notif COLA_EMAILS_ATRASADA en las últimas 24h.
 *
 * No mandamos email Pulzar para esto porque puede ser justamente el SMTP
 * el que está fallando — la notif in-app + banner del CRM alcanzan.
 */
async function alertarSiColaAtrasada(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<void> {
  const UMBRAL = 5
  const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  try {
    const { count } = await supabase
      .from('email_envios')
      .select('id', { count: 'exact', head: true })
      .eq('estado', 'ENCOLADO')
      .lt('enviar_despues_de', hace24h)

    if ((count ?? 0) < UMBRAL) return

    // Anti-spam: si ya avisamos en las últimas 24h, no repetir.
    const { data: previa } = await supabase
      .from('notificaciones')
      .select('id')
      .eq('tipo', 'COLA_EMAILS_ATRASADA')
      .gte('created_at', hace24h)
      .limit(1)
    if (previa && previa.length > 0) return

    await (supabase.from('notificaciones') as any).insert({
      tipo: 'COLA_EMAILS_ATRASADA',
      prioridad: 'CRITICA',
      titulo: 'La cola de emails está atrasada',
      mensaje: `Hay ${count} emails encolados hace más de 24 horas. Revisá la configuración SMTP y el estado del cron.`,
      url: '/crm/comunicaciones',
      leida: false,
    })
  } catch (err: any) {
    logger.warn({ modulo: 'cron', mensaje: 'No se pudo chequear/notificar cola atrasada', contexto: { error: err?.message } })
  }
}
