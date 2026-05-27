/**
 * GET /api/cron/licencias
 *
 * Cron diario que mantiene el sistema de licencias:
 *   1. Rota licencias: si la ACTIVA venció, busca una ENCOLADA que cubra hoy y la promueve.
 *   2. Marca como EXPIRADA cualquier ENCOLADA que ya pasó (fecha_vencimiento < hoy).
 *   3. Genera notificaciones in-app + emails al admin según el escalonamiento:
 *        - 30, 15, 7 días antes del vencimiento (LICENCIA_POR_VENCER)
 *        - El día del vencimiento (entra en gracia)
 *        - Cada día del período de gracia
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
import { encolarEmailSistema, type TipoEventoSistema } from '@/lib/comunicaciones-sender'

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

async function emitirEmailSistemaLicencia(
  tipo_evento: TipoEventoSistema,
  variables_extra: Record<string, string>,
): Promise<void> {
  try {
    await encolarEmailSistema({ tipo_evento, variables_extra })
  } catch (err) {
    logger.warn({
      modulo: 'cron-licencias',
      mensaje: 'No se pudo encolar email de sistema para licencia',
      contexto: { error: String(err), tipo_evento },
    })
  }
}

export const GET = manejarErrores(async (request: NextRequest) => {
  const errCron = await validarCronSecret(request)
  if (errCron) return errCron

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
        mensaje: `La licencia ${estado.licencia_activa.plan} vence el ${formatearFecha(estado.licencia_activa.fecha_vencimiento)}. Contactá a Pulzar para renovar.`,
        url: URL_LICENCIA,
      })
      avisos.push({ tipo: 'POR_VENCER', enviado })

      if (enviado) {
        await emitirEmailSistemaLicencia('LICENCIA_POR_VENCER', {
          dias_restantes: String(dias),
          plan: estado.licencia_activa.plan,
          fecha_vencimiento: formatearFecha(estado.licencia_activa.fecha_vencimiento),
        })
      }
    }
  }

  // Caso 2: licencia en período de gracia
  if (estado.modo === 'GRACIA' && estado.licencia_activa && estado.dias_gracia_restantes !== null) {
    const fechaBloqueo = new Date()
    fechaBloqueo.setDate(fechaBloqueo.getDate() + estado.dias_gracia_restantes)
    const fechaBloqueoIso = fechaBloqueo.toISOString().slice(0, 10)

    const enviado = await notificarAdminSiCorresponde(supabase, {
      tipo: 'LICENCIA_EN_GRACIA',
      prioridad: 'CRITICA',
      titulo: 'Tu licencia venció',
      mensaje: `Quedan ${estado.dias_gracia_restantes} días para cargar una nueva licencia y mantener todas las funciones activas.`,
      url: URL_LICENCIA,
    })
    avisos.push({ tipo: 'GRACIA', enviado })

    if (enviado) {
      await emitirEmailSistemaLicencia('LICENCIA_EN_GRACIA', {
        dias_gracia: String(estado.dias_gracia_restantes),
        fecha_vencimiento: formatearFecha(estado.licencia_activa.fecha_vencimiento),
        fecha_bloqueo: formatearFecha(fechaBloqueoIso),
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

    if (enviado) {
      await emitirEmailSistemaLicencia('LICENCIA_BLOQUEADA', {})
    }
  }

  return respuestaExito({
    promovidas,
    expiradas: expiradas + encoladasExpiradas,
    modo_actual: estado.modo,
    avisos,
  })
}, { modulo: 'cron-licencias' })
