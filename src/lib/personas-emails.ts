// ============================================================
// Encolado de email automático de "bienvenida del cliente".
//
// A diferencia del email "póliza emitida" (que se manda cada vez que una
// póliza pasa a VIGENTE), la bienvenida se manda UNA SOLA VEZ por persona,
// cuando se emite su primera póliza VIGENTE. Sirve como saludo formal de
// incorporación del cliente a la organización del PAS.
//
// Anti-duplicado vía la columna `personas.bienvenida_cliente_encolada_en`:
// el primer caller exitoso la setea a NOW(), los siguientes la ven seteada
// y salen sin hacer nada. El backfill de la migración 094 marca todas las
// personas existentes con NOW() para evitar disparos retroactivos.
// ============================================================

import { encolarEmail } from '@/lib/comunicaciones-sender'
import { logger } from '@/lib/errores'
import { notificarBienvenidaSinEmail } from '@/lib/bienvenida-alertas'

/**
 * Encola la bienvenida del cliente para una persona. Idempotente: si la
 * persona ya tiene `bienvenida_cliente_encolada_en` no nulo, no hace nada.
 *
 * Llamar después de encolar la "póliza emitida" (no antes — si el cliente
 * no tiene email o el toggle de bienvenida está off, no queremos abortar
 * el flujo de la póliza por la bienvenida).
 *
 * NO tira: cualquier error se loggea con logger.warn — la bienvenida no es
 * crítica.
 */
export async function encolarBienvenidaCliente(
  supabase: any,
  persona_id: string,
): Promise<void> {
  try {
    // 1) Verificar toggle del sistema y del tipo
    const { data: config } = await supabase
      .from('configuracion_comunicaciones')
      .select('activo, envio_automatico_bienvenida_cliente')
      .limit(1)
      .maybeSingle()
    const cc = config as any
    if (!cc?.activo) return
    if (!cc.envio_automatico_bienvenida_cliente) return

    // 2) Verificar SMTP
    const { data: correoConfig } = await supabase
      .from('configuracion_correos')
      .select('configurado')
      .limit(1)
      .maybeSingle()
    if (!(correoConfig as any)?.configurado) return

    // 3) Verificar persona: existe + tiene email + no es importada + no recibió bienvenida
    const { data: persona } = await supabase
      .from('personas')
      .select('id, nombre, apellido, razon_social, email, origen_creacion, bienvenida_cliente_encolada_en, usuario_id')
      .eq('id', persona_id)
      .maybeSingle()

    if (!persona) return
    const per = persona as any
    // Los importados NO deben recibir bienvenida (vienen de otra cartera).
    if (per.origen_creacion === 'IMPORTACION') return
    // Idempotencia: si ya se encoló antes (o si ya se emitió una alerta que
    // marcó el timestamp), no hacemos nada.
    if (per.bienvenida_cliente_encolada_en) return
    if (!per.email) {
      // Fail-visible: alerta in-app y marcamos el timestamp para no repetir
      // la alerta en cada cron (el anti-spam del helper también lo cubre,
      // pero doble protección no cuesta).
      await notificarBienvenidaSinEmail({
        persona: {
          id: per.id,
          nombre: per.nombre,
          apellido: per.apellido,
          razon_social: per.razon_social,
          usuario_id: per.usuario_id,
        },
        contexto: 'CLIENTE',
      })
      return
    }

    // 4) Marcar el timestamp ANTES de encolar para garantizar idempotencia
    // bajo carreras del cron. Si dos workers llaman a la vez, solo el primero
    // pasa el UPDATE-condicional; el segundo ve el timestamp ya seteado y sale.
    const ahora = new Date().toISOString()
    const { data: marcada } = await supabase
      .from('personas')
      .update({ bienvenida_cliente_encolada_en: ahora })
      .eq('id', persona_id)
      .is('bienvenida_cliente_encolada_en', null)
      .select('id')
      .maybeSingle()

    if (!marcada) return // otro worker se nos adelantó

    const nombre = per.razon_social
      || [per.apellido, per.nombre].filter(Boolean).join(', ')
      || per.nombre
      || ''

    // 5) Encolar el email
    const resultado = await encolarEmail({
      plantilla_codigo: 'bienvenida_cliente',
      destinatario: { email: per.email, nombre, persona_id: per.id },
      tipo_envio: 'AUTOMATICO_BIENVENIDA_CLIENTE',
      anti_spam: false, // la idempotencia la garantiza el timestamp en personas
    })

    // 6) Si encolarEmail falló por validación (ej: email_bajas), revertir
    // el timestamp para permitir un reintento manual desde la ficha.
    if (!resultado.ok && !resultado.envio_id) {
      await supabase
        .from('personas')
        .update({ bienvenida_cliente_encolada_en: null })
        .eq('id', persona_id)
        .eq('bienvenida_cliente_encolada_en', ahora) // solo si seguimos siendo nosotros
    }
  } catch (err) {
    logger.warn({
      modulo: 'personas-emails',
      mensaje: 'No se pudo encolar bienvenida del cliente',
      contexto: { persona_id, error: String(err) },
    })
  }
}
