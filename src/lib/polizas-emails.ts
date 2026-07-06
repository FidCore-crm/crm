// ============================================================
// Encolado de emails automáticos al cliente al activar/crear pólizas.
// Compartido entre el cron, el endpoint PATCH (auto-transición) y el
// aplicador de PDF — una sola fuente de verdad para no perder envíos
// ni mandar duplicados.
// ============================================================

import { encolarEmail } from '@/lib/comunicaciones-sender'
import { logger } from '@/lib/errores'
import { notificarBienvenidaSinEmail } from '@/lib/bienvenida-alertas'

export type TipoEmailAutomaticoPoliza = 'AUTOMATICO_BIENVENIDA' | 'AUTOMATICO_RENOVACION'

/**
 * Encola un email automático para una póliza que acaba de activarse.
 * Valida toggles del sistema + SMTP configurado. El anti-spam vive dentro
 * de encolarEmail (idempotente por póliza+tipo).
 */
export async function encolarEmailAutomaticoPoliza(
  supabase: any,
  polizaId: string,
  tipoEnvio: TipoEmailAutomaticoPoliza,
): Promise<void> {
  try {
    // Verificar toggle correspondiente
    const { data: config } = await supabase
      .from('configuracion_comunicaciones')
      .select('activo, envio_automatico_bienvenida_poliza, envio_automatico_renovaciones')
      .limit(1)
      .maybeSingle()
    const cc = config as any
    if (!cc?.activo) return
    if (tipoEnvio === 'AUTOMATICO_BIENVENIDA' && !cc.envio_automatico_bienvenida_poliza) return
    if (tipoEnvio === 'AUTOMATICO_RENOVACION' && !cc.envio_automatico_renovaciones) return

    // Verificar SMTP
    const { data: correoConfig } = await supabase
      .from('configuracion_correos')
      .select('configurado')
      .limit(1)
      .maybeSingle()
    if (!(correoConfig as any)?.configurado) return

    // Cargar datos
    const { data: poliza } = await supabase
      .from('polizas')
      .select('id, numero_poliza, asegurado_id')
      .eq('id', polizaId)
      .maybeSingle()
    if (!poliza) return
    const p = poliza as any

    const { data: persona } = await supabase
      .from('personas')
      .select('id, nombre, apellido, razon_social, email, usuario_id')
      .eq('id', p.asegurado_id)
      .maybeSingle()
    if (!persona) return
    const per = persona as any
    if (!per.email) {
      // Fail-visible: alerta in-app para que el PAS cargue el email
      // y pueda comunicarse. Sin esto el evento queda invisible.
      await notificarBienvenidaSinEmail({
        persona: {
          id: per.id,
          nombre: per.nombre,
          apellido: per.apellido,
          razon_social: per.razon_social,
          usuario_id: per.usuario_id,
        },
        contexto: tipoEnvio === 'AUTOMATICO_RENOVACION' ? 'RENOVACION' : 'POLIZA',
        poliza_numero: p.numero_poliza,
      })
      return
    }

    const nombre = per.razon_social
      || [per.apellido, per.nombre].filter(Boolean).join(', ')
      || per.nombre
      || ''
    const plantilla = tipoEnvio === 'AUTOMATICO_BIENVENIDA' ? 'bienvenida_poliza' : 'renovacion_poliza'

    await encolarEmail({
      plantilla_codigo: plantilla,
      destinatario: { email: per.email, nombre, persona_id: per.id },
      poliza_id: p.id,
      tipo_envio: tipoEnvio,
      anti_spam: true,
    })
  } catch (err) {
    logger.warn({
      modulo: 'polizas-emails',
      mensaje: 'No se pudo encolar email automático',
      contexto: { poliza_id: polizaId, tipo: tipoEnvio, error: String(err) },
    })
  }
}
