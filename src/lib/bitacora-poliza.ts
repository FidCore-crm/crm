// ============================================================
// Helper append-only para registrar eventos en poliza_bitacora.
// Puede usarse tanto desde server (admin client) como client
// (browser client). La tabla tiene RLS permisiva.
// ============================================================

import { logger } from '@/lib/errores/logger'

export type TipoEventoBitacora =
  | 'CREACION'
  | 'CAMBIO_ESTADO'
  | 'CANCELACION'
  | 'ANULACION'
  | 'REHABILITACION'
  | 'RENOVACION_CREADA'
  | 'RENOVACION_ACTIVADA'
  | 'EDICION'

export interface BitacoraEventoInput {
  poliza_id: string
  tipo_evento: TipoEventoBitacora
  estado_anterior?: string | null
  estado_nuevo?: string | null
  motivo?: string | null
  observaciones?: string | null
  usuario_id?: string | null
}

/**
 * Inserta un evento en poliza_bitacora. No lanza errores —
 * los registra en consola para no romper el flujo principal.
 * `supabase` puede ser el cliente admin del server o el cliente
 * browser — ambos tienen permiso de INSERT por la RLS permisiva.
 */
export async function registrarEventoBitacora(
  supabase: any,
  evento: BitacoraEventoInput
): Promise<void> {
  try {
    const { error } = await supabase.from('poliza_bitacora').insert({
      poliza_id: evento.poliza_id,
      tipo_evento: evento.tipo_evento,
      estado_anterior: evento.estado_anterior ?? null,
      estado_nuevo: evento.estado_nuevo ?? null,
      motivo: evento.motivo ?? null,
      observaciones: evento.observaciones ?? null,
      usuario_id: evento.usuario_id ?? null,
    })
    if (error) {
      logger.warn({ modulo: 'bitacora-poliza', mensaje: 'Insert falló', contexto: { error: error.message } })
    }
  } catch (err: any) {
    logger.warn({ modulo: 'bitacora-poliza', mensaje: 'Excepción', contexto: { error: err?.message || String(err) } })
  }
}
