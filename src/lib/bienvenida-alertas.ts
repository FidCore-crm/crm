// ============================================================
// Notificaciones in-app cuando la bienvenida automática no se
// puede encolar por falta de email en el cliente.
//
// Historia: hasta v1.0.87 los helpers `encolarEmailAutomaticoPoliza` y
// `encolarBienvenidaCliente` hacían `return` silencioso ante `!per.email`.
// Sin fila en `email_envios`, sin warning, el PAS nunca se enteraba.
// A partir de v1.0.88 se crea una notificación in-app ADVERTENCIA
// (con anti-spam por ventana temporal) para que el PAS lo vea en la
// campana y cargue el email a mano.
// ============================================================

import { getSupabaseAdmin } from '@/lib/supabase/server'
import { logger } from '@/lib/errores'

const TIPO_NOTIF = 'BIENVENIDA_SIN_EMAIL'
const VENTANA_ANTISPAM_DIAS_DEFAULT = 3

export type ContextoBienvenidaFallida = 'CLIENTE' | 'POLIZA' | 'RENOVACION'

interface PersonaMinima {
  id: string
  nombre: string | null
  apellido: string | null
  razon_social: string | null
  usuario_id: string | null
}

/**
 * Crea la notificación in-app cuando no se puede enviar bienvenida por
 * falta de email. Idempotente por persona: si ya hay una notificación
 * abierta del mismo tipo dentro de la ventana anti-spam, no crea otra.
 *
 * Nunca tira: los helpers de emails no deben fallar por errores de
 * notificaciones. Cualquier error queda en el logger.
 */
export async function notificarBienvenidaSinEmail(params: {
  persona: PersonaMinima
  contexto: ContextoBienvenidaFallida
  poliza_numero?: string | null
}): Promise<void> {
  const supabase = getSupabaseAdmin()
  try {
    const antispamDias = await obtenerVentanaAntispam(supabase)
    const ventanaMs = antispamDias * 24 * 60 * 60 * 1000
    const desde = new Date(Date.now() - ventanaMs).toISOString()

    // Anti-spam: si ya hay una no-leída reciente para esta persona, no dupliquemos.
    const { data: existente } = await supabase
      .from('notificaciones')
      .select('id')
      .eq('tipo', TIPO_NOTIF)
      .eq('entidad_id', params.persona.id)
      .eq('leida', false)
      .gte('created_at', desde)
      .limit(1)
      .maybeSingle()
    if (existente) return

    const nombreCliente =
      params.persona.razon_social ||
      [params.persona.apellido, params.persona.nombre].filter(Boolean).join(', ') ||
      'el cliente'

    const { titulo, mensaje } = armarTexto(params.contexto, nombreCliente, params.poliza_numero)

    await supabase.from('notificaciones').insert({
      tipo: TIPO_NOTIF,
      prioridad: 'ADVERTENCIA',
      titulo,
      mensaje,
      entidad_tipo: 'persona',
      entidad_id: params.persona.id,
      url: `/crm/personas/${params.persona.id}`,
      leida: false,
      usuario_id: params.persona.usuario_id,
    } as any)
  } catch (err) {
    logger.warn({
      modulo: 'bienvenida-alertas',
      mensaje: 'No se pudo crear notificación BIENVENIDA_SIN_EMAIL',
      contexto: { persona_id: params.persona.id, contexto: params.contexto, error: String(err) },
    })
  }
}

async function obtenerVentanaAntispam(supabase: any): Promise<number> {
  try {
    const { data } = await supabase
      .from('configuracion_notificaciones')
      .select('antispam_dias, activa')
      .eq('tipo', TIPO_NOTIF)
      .maybeSingle()
    const cfg = data as { antispam_dias?: number | null; activa?: boolean } | null
    if (cfg && cfg.activa === false) return 0
    if (cfg && typeof cfg.antispam_dias === 'number' && cfg.antispam_dias > 0) {
      return cfg.antispam_dias
    }
  } catch {
    // ignoramos y usamos default
  }
  return VENTANA_ANTISPAM_DIAS_DEFAULT
}

function armarTexto(
  contexto: ContextoBienvenidaFallida,
  nombreCliente: string,
  polizaNumero: string | null | undefined,
): { titulo: string; mensaje: string } {
  const numero = polizaNumero ? ` N° ${polizaNumero}` : ''
  switch (contexto) {
    case 'CLIENTE':
      return {
        titulo: 'Bienvenida no enviada: cliente sin email',
        mensaje: `${nombreCliente} se cargó sin email, así que no recibió la bienvenida automática. Cargale el email desde la ficha para poder comunicarte.`,
      }
    case 'POLIZA':
      return {
        titulo: 'Bienvenida de póliza no enviada: cliente sin email',
        mensaje: `Se activó la póliza${numero} de ${nombreCliente} pero no se envió el email de bienvenida porque el cliente no tiene email cargado. Cargá el email desde la ficha.`,
      }
    case 'RENOVACION':
      return {
        titulo: 'Aviso de renovación no enviado: cliente sin email',
        mensaje: `Se renovó la póliza${numero} de ${nombreCliente} pero no se envió el aviso porque el cliente no tiene email cargado. Cargá el email desde la ficha.`,
      }
  }
}
