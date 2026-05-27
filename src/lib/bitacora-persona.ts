// ============================================================
// Helper append-only para registrar eventos en persona_bitacora.
// Mismo patrón que bitacora-poliza.ts. No tira: si la inserción
// falla, se loguea con logger.warn y la operación principal sigue.
// ============================================================

import { logger } from '@/lib/errores/logger'

export type TipoEventoBitacoraPersona =
  | 'CREACION'
  | 'EDICION'
  | 'CAMBIO_ESTADO'
  | 'ELIMINACION'
  | 'RESTAURACION'
  | 'PURGA_DEFINITIVA'

export interface BitacoraPersonaInput {
  persona_id: string
  tipo_evento: TipoEventoBitacoraPersona
  estado_anterior?: string | null
  estado_nuevo?: string | null
  campos_modificados?: string[] | null
  motivo?: string | null
  observaciones?: string | null
  usuario_id?: string | null
}

export async function registrarEventoBitacoraPersona(
  supabase: any,
  evento: BitacoraPersonaInput,
): Promise<void> {
  try {
    const { error } = await supabase.from('persona_bitacora').insert({
      persona_id: evento.persona_id,
      tipo_evento: evento.tipo_evento,
      estado_anterior: evento.estado_anterior ?? null,
      estado_nuevo: evento.estado_nuevo ?? null,
      campos_modificados: evento.campos_modificados ?? null,
      motivo: evento.motivo ?? null,
      observaciones: evento.observaciones ?? null,
      usuario_id: evento.usuario_id ?? null,
    })
    if (error) {
      logger.warn({ modulo: 'bitacora-persona', mensaje: 'Insert falló', contexto: { error: error.message } })
    }
  } catch (err: any) {
    logger.warn({ modulo: 'bitacora-persona', mensaje: 'Excepción', contexto: { error: err?.message || String(err) } })
  }
}
