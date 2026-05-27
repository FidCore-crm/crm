// ============================================================
// Helper append-only para registrar eventos en siniestro_bitacora.
// Mismo patrón que bitacora-poliza y bitacora-persona. No tira:
// si la inserción falla, se loguea con logger.warn y la operación
// principal sigue.
// ============================================================

import { logger } from '@/lib/errores/logger'

export type TipoEventoBitacoraSiniestro =
  | 'NOTA'
  | 'ESTADO'
  | 'ARCHIVO'
  | 'CREACION'
  | 'EDICION'
  | 'ELIMINACION'
  | 'RESTAURACION'
  | 'PURGA_DEFINITIVA'

export interface BitacoraSiniestroInput {
  siniestro_id: string
  tipo: TipoEventoBitacoraSiniestro
  estado_anterior?: string | null
  estado_nuevo?: string | null
  monto_actualizado?: number | null
  texto?: string | null
  campos_modificados?: string[] | null
  usuario_id?: string | null
}

export async function registrarEventoBitacoraSiniestro(
  supabase: any,
  evento: BitacoraSiniestroInput,
): Promise<void> {
  try {
    const { error } = await supabase.from('siniestro_bitacora').insert({
      siniestro_id: evento.siniestro_id,
      tipo: evento.tipo,
      estado_anterior: evento.estado_anterior ?? null,
      estado_nuevo: evento.estado_nuevo ?? null,
      monto_actualizado: evento.monto_actualizado ?? null,
      texto: evento.texto ?? null,
      campos_modificados: evento.campos_modificados ?? null,
      usuario_id: evento.usuario_id ?? null,
    })
    if (error) {
      logger.warn({ modulo: 'bitacora-siniestro', mensaje: 'Insert falló', contexto: { error: error.message } })
    }
  } catch (err: any) {
    logger.warn({ modulo: 'bitacora-siniestro', mensaje: 'Excepción', contexto: { error: err?.message || String(err) } })
  }
}
