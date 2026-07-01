/**
 * GET /api/cron/licencias
 *
 * Cron diario que mantiene el sistema de licencias:
 *   1. Rota licencias: si la ACTIVA venció, busca una ENCOLADA que cubra hoy y la promueve.
 *   2. Marca como EXPIRADA cualquier ENCOLADA que ya pasó (fecha_vencimiento < hoy).
 *   3. Genera notificaciones in-app + emails al admin según el escalonamiento:
 *        - 30, 15, 7 días antes del vencimiento (LICENCIA_POR_VENCER)
 *        - Al vencer y mientras siga en modo gracia interno (LICENCIA_EN_GRACIA)
 *        - Al pasar a BLOQUEADA
 *
 * Anti-spam: cada tipo de notificación tiene su ventana — no repetimos el mismo
 * aviso si ya se mandó hace menos de 24h.
 */

import type { NextRequest } from 'next/server'
import { manejarErrores, respuestaError, respuestaExito, ERRORES, logger } from '@/lib/errores'
import { validarCronSecret } from '@/lib/cron-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { rotarLicencias, obtenerEstadoLicencia, invalidarCacheEstado, DIAS_GRACIA_POST_VENCIMIENTO } from '@/lib/licencia'
import { esModoVps } from '@/lib/modo-instalacion'
import { obtenerAdminsActivos } from '@/lib/comunicaciones-sender'
import { enviarEmailFidCore, type TipoEmailFidCore } from '@/lib/fidcore-emails'

interface NotificacionInsertar {
  tipo: 'LICENCIA_POR_VENCER' | 'LICENCIA_VENCIDA' | 'LICENCIA_EN_GRACIA' | 'LICENCIA_BLOQUEADA'
  prioridad: 'CRITICA' | 'ADVERTENCIA' | 'INFORMATIVA'
  titulo: string
  mensaje: string
  url: string
}

const URL_LICENCIA = '/crm/configuracion/licencia'

function formatearFecha(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

/**
 * Inserta la notificación si no existe una del mismo tipo en las últimas 24h.
 * Devuelve true si se creó, false si fue anti-spammed.
 */
async function notificarAdminSiCorresponde(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  notif: NotificacionInsertar,
): Promise<boolean> {
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: existentes } = await supabase
    .from('notificaciones')
    .select('id')
    .eq('tipo', notif.tipo)
    .gte('created_at', desde)
    .limit(1)

  if (existentes && existentes.length > 0) return false

  await supabase.from('notificaciones').insert({
    tipo: notif.tipo,
    prioridad: notif.prioridad,
    titulo: notif.titulo,
    mensaje: notif.mensaje,
    url: notif.url,
    leida: false,
  })
  return true
}

/**
 * Envía un email DESDE FidCore AL admin del PAS.
 *
 * A diferencia del resto de eventos `sistema_*` (backup, PDF, error crítico),
 * los avisos de licencia NO los manda el CRM del PAS — los manda FidCore (la
 * empresa) usando un From `FidCore <pulzar.crm@gmail.com>` (Gmail real, para
 * que SPF no falle) y Reply-To `info@fidcore.com.ar` (alias que CF Email
 * Routing redirige al Gmail real). El SMTP sigue siendo el del PAS por
 * simplicidad, pero el From/Reply-To/firma se sobreescriben en
 * `enviarEmailFidCore()`.
 *
 * Esto evita que el PAS pueda editar el contenido (las plantillas son
 * hardcoded en `src/lib/fidcore-emails.ts`) y deja claro al cliente con quién
 * tiene que contactar para renovar.
 *
 * Síncrono y fire-and-forget por admin: si un email puntual falla, se loggea
 * pero el resto se envía.
 */
async function emitirEmailLicenciaDesdeFidCore(
  tipo: TipoEmailFidCore,
  variables: { dias_restantes?: number; plan?: string; fecha_vencimiento?: string },
): Promise<void> {
  try {
    const admins = await obtenerAdminsActivos()
    if (admins.length === 0) {
      logger.warn({
        modulo: 'cron-licencias',
        mensaje: 'No hay admins activos con email para notificar licencia',
        contexto: { tipo },
      })
      return
    }

    for (const admin of admins) {
      await enviarEmailFidCore({
        tipo,
        destinatarioEmail: admin.email,
        variables: { ...variables, nombre_admin: admin.nombre },
      })
    }
  } catch (err) {
    logger.warn({
      modulo: 'cron-licencias',
      mensaje: 'No se pudo enviar email FidCore de licencia',
      contexto: { error: String(err), tipo },
    })
  }
}

export const GET = manejarErrores(async (request: NextRequest) => {
  const errCron = await validarCronSecret(request)
  if (errCron) return errCron

  // En modo VPS (SaaS-managed) el sistema de licencias está desactivado —
  // el control de pago pasa por estado_servicio (endpoint /api/soporte).
  if (esModoVps()) {
    return respuestaExito({ skipped: true, motivo: 'Modo VPS — sistema de licencias desactivado' })
  }

  const supabase = getSupabaseAdmin()

  // ----- 1) Rotación de licencias -----
  const { promovidas, expiradas } = await rotarLicencias()

  // ----- 2) Marcar como EXPIRADA cualquier ENCOLADA ya vencida -----
  const hoy = new Date().toISOString().slice(0, 10)
  const { data: encoladasVencidas } = await supabase
    .from('licencias')
    .select('id')
    .eq('estado', 'ENCOLADA')
    .neq('plan', 'PERMANENTE')
    .lt('fecha_vencimiento', hoy)

  let encoladasExpiradas = 0
  if (encoladasVencidas && encoladasVencidas.length > 0) {
    const ids = encoladasVencidas.map((l) => l.id)
    await supabase.from('licencias').update({ estado: 'EXPIRADA' }).in('id', ids)
    encoladasExpiradas = ids.length
    invalidarCacheEstado()
  }

  // ----- 3) Evaluar estado y notificar según escalonamiento -----
  const estado = await obtenerEstadoLicencia({ forzar: true })

  const avisos: { tipo: string; enviado: boolean }[] = []

  // Si tiene activa permanente, no avisar nada
  if (estado.modo === 'ACTIVA' && estado.licencia_activa?.es_permanente) {
    return respuestaExito({
      promovidas,
      expiradas: expiradas + encoladasExpiradas,
      avisos,
      mensaje: 'Plan permanente — sin avisos.',
    })
  }

  // Caso 1: licencia activa por vencer
  if (estado.modo === 'ACTIVA' && estado.licencia_activa) {
    const dias = estado.licencia_activa.dias_restantes
    if (dias === 30 || dias === 15 || dias === 7) {
      const enviado = await notificarAdminSiCorresponde(supabase, {
        tipo: 'LICENCIA_POR_VENCER',
        prioridad: dias <= 7 ? 'CRITICA' : 'ADVERTENCIA',
        titulo: `Tu licencia vence en ${dias} días`,
        mensaje: `La licencia ${estado.licencia_activa.plan} vence el ${formatearFecha(estado.licencia_activa.fecha_vencimiento)}. Contactá a FidCore para renovar.`,
        url: URL_LICENCIA,
      })
      avisos.push({ tipo: 'POR_VENCER', enviado })

      if (enviado) {
        await emitirEmailLicenciaDesdeFidCore('LICENCIA_POR_VENCER', {
          dias_restantes: dias,
          plan: estado.licencia_activa.plan,
          fecha_vencimiento: formatearFecha(estado.licencia_activa.fecha_vencimiento),
        })
      }
    }
  }

  // Caso 2: licencia vencida (sigue funcionando temporalmente, ver lib/licencia.ts).
  // No mencionamos el concepto al admin: el mensaje es simplemente "venció, cargá una nueva".
  if (estado.modo === 'GRACIA' && estado.licencia_activa) {
    const enviado = await notificarAdminSiCorresponde(supabase, {
      tipo: 'LICENCIA_EN_GRACIA',
      prioridad: 'CRITICA',
      titulo: 'Tu licencia venció',
      mensaje: 'Cargá una nueva licencia para mantener todas las funciones activas.',
      url: URL_LICENCIA,
    })
    avisos.push({ tipo: 'GRACIA', enviado })

    if (enviado) {
      await emitirEmailLicenciaDesdeFidCore('LICENCIA_VENCIDA', {
        fecha_vencimiento: formatearFecha(estado.licencia_activa.fecha_vencimiento),
      })
    }
  }

  // Caso 3: bloqueada (vencida + sin gracia) o sin licencia
  if (estado.modo === 'BLOQUEADA' || estado.modo === 'SIN_LICENCIA') {
    const enviado = await notificarAdminSiCorresponde(supabase, {
      tipo: 'LICENCIA_BLOQUEADA',
      prioridad: 'CRITICA',
      titulo: estado.modo === 'SIN_LICENCIA' ? 'Activación pendiente' : 'Funciones de edición restringidas',
      mensaje:
        estado.modo === 'SIN_LICENCIA'
          ? 'Es necesario activar el sistema. Podés consultar tus clientes, pólizas y siniestros, pero el resto de las funciones queda bloqueado hasta cargar una licencia válida.'
          : 'Cargá una licencia válida para reactivar todas las funciones del sistema.',
      url: URL_LICENCIA,
    })
    avisos.push({ tipo: 'BLOQUEADA', enviado })

    // Solo mandamos email FidCore si el admin tiene una licencia previa
    // vencida (BLOQUEADA). Si nunca cargó ninguna (SIN_LICENCIA, ej. en
    // instalación nueva), el aviso por email no aplica — no sabemos quién es
    // el cliente todavía.
    if (enviado && estado.modo === 'BLOQUEADA') {
      await emitirEmailLicenciaDesdeFidCore('LICENCIA_BLOQUEADA', {})
    }
  }

  return respuestaExito({
    promovidas,
    expiradas: expiradas + encoladasExpiradas,
    modo_actual: estado.modo,
    avisos,
  })
}, { modulo: 'cron-licencias' })
