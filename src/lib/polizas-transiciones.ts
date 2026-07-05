// ============================================================
// Helpers de transición de estado de pólizas.
//
// Misma lógica que ejecuta el cron, exportada como funciones
// puras para que el endpoint PATCH también pueda transicionar
// inmediatamente cuando el usuario edita las fechas en lugar
// de hacer esperar 4h al cron.
// ============================================================

import { transicionarArchivosRenovacion, limpiarDocumentacion } from '@/lib/storage-utils'
import { registrarEventoBitacora } from '@/lib/bitacora-poliza'
import { logger } from '@/lib/errores'
import { hoyAR } from '@/lib/utils'

export interface ResultadoTransicion {
  ok: boolean
  cambios: string[]
  errores?: string[]
}

/**
 * Activa una póliza RENOVADA latente: la pasa a VIGENTE, baja la origen a
 * NO_VIGENTE, mueve archivos documentacion_renovada → documentacion, y
 * registra bitácora. Idempotente: si la póliza ya no es RENOVADA, no hace nada.
 */
export async function activarRenovadaSiCorresponde(
  supabase: any,
  polizaId: string,
  usuarioId: string | null,
): Promise<ResultadoTransicion> {
  const cambios: string[] = []
  const errores: string[] = []
  const hoy = hoyAR()

  const { data: pol } = await supabase
    .from('polizas')
    .select('id, numero_poliza, estado, fecha_inicio, poliza_origen_id')
    .eq('id', polizaId)
    .maybeSingle()

  if (!pol) return { ok: false, cambios, errores: ['Póliza no encontrada'] }

  if ((pol as any).estado !== 'RENOVADA') return { ok: true, cambios }
  if (!(pol as any).poliza_origen_id) return { ok: true, cambios }
  if ((pol as any).fecha_inicio > hoy) return { ok: true, cambios }

  // 1) Pasar la nueva a VIGENTE (con candado de estado para idempotencia)
  const { data: activada } = await supabase
    .from('polizas')
    .update({ estado: 'VIGENTE' })
    .eq('id', polizaId)
    .eq('estado', 'RENOVADA')
    .select('id')
    .maybeSingle()

  if (!activada) return { ok: true, cambios } // ya la activó otro caller

  cambios.push(`Póliza ${(pol as any).numero_poliza} activada (RENOVADA → VIGENTE)`)

  // 2) Bajar la origen a NO_VIGENTE
  const { data: origenBajada } = await supabase
    .from('polizas')
    .update({ estado: 'NO_VIGENTE' })
    .eq('id', (pol as any).poliza_origen_id)
    .eq('estado', 'VIGENTE')
    .select('id, numero_poliza')
    .maybeSingle()

  if (origenBajada) {
    cambios.push(`Póliza origen ${(origenBajada as any).numero_poliza} → NO_VIGENTE`)
    await registrarEventoBitacora(supabase, {
      poliza_id: (pol as any).poliza_origen_id,
      tipo_evento: 'CAMBIO_ESTADO',
      estado_anterior: 'VIGENTE',
      estado_nuevo: 'NO_VIGENTE',
      motivo: 'Renovación activada, la póliza origen pasó a NO_VIGENTE',
      usuario_id: usuarioId,
    })
  }

  // 3) Bitácora en la nueva
  await registrarEventoBitacora(supabase, {
    poliza_id: polizaId,
    tipo_evento: 'RENOVACION_ACTIVADA',
    estado_anterior: 'RENOVADA',
    estado_nuevo: 'VIGENTE',
    motivo: 'Activación al guardar edición de fechas (sin esperar al cron)',
    usuario_id: usuarioId,
  })

  // 4) Mover archivos de la origen a la nueva
  const movimiento = await transicionarArchivosRenovacion(
    supabase,
    (pol as any).numero_poliza,
    (pol as any).poliza_origen_id,
    polizaId,
  )
  if (!movimiento.ok) {
    errores.push(`Falló movimiento de archivos: ${movimiento.error}`)
    logger.error({
      modulo: 'polizas-transiciones',
      mensaje: 'Falló transicionarArchivosRenovacion',
      contexto: { poliza_id: polizaId, error: movimiento.error },
    })
  } else if (movimiento.archivos_movidos > 0) {
    cambios.push(`${movimiento.archivos_movidos} archivo(s) movido(s) a la nueva póliza`)
  }

  // 5) Limpiar documentación de la origen (si hay)
  if (origenBajada) {
    await limpiarDocumentacion(supabase, (origenBajada as any).numero_poliza, (pol as any).poliza_origen_id)
  }

  // 6) Migrar tareas PENDIENTE/EN_PROCESO de la origen a la nueva póliza.
  // Al renovar, las tareas activas (típicamente recurrentes de gestión de
  // cobranza / seguimiento) tienen que quedar apuntando a la nueva póliza,
  // no a una que ya está NO_VIGENTE. Las COMPLETADAS/CANCELADAS se dejan
  // como histórico ligado a la póliza vieja.
  try {
    const { data: tareasMigradas } = await supabase
      .from('tareas')
      .update({ poliza_id: polizaId })
      .eq('poliza_id', (pol as any).poliza_origen_id)
      .in('estado', ['PENDIENTE', 'EN_PROCESO'])
      .select('id')
    if (tareasMigradas && tareasMigradas.length > 0) {
      cambios.push(`${tareasMigradas.length} tarea(s) migrada(s) a la nueva póliza`)
    }
  } catch (err) {
    // No es bloqueante — la póliza ya está VIGENTE y los archivos ya se movieron.
    // Log para diagnóstico si alguna vez falla.
    logger.warn({
      modulo: 'polizas-transiciones',
      mensaje: 'Falló migración de tareas al activar renovación',
      contexto: { poliza_id: polizaId, poliza_origen_id: (pol as any).poliza_origen_id, error: String(err) },
    })
  }

  return { ok: errores.length === 0, cambios, errores: errores.length > 0 ? errores : undefined }
}

/**
 * Si una póliza VIGENTE quedó con fecha_fin pasada y no tiene renovación
 * activa, la pasa a NO_VIGENTE y limpia su documentación.
 * Idempotente.
 */
export async function vencerPolizaSiCorresponde(
  supabase: any,
  polizaId: string,
  usuarioId: string | null,
): Promise<ResultadoTransicion> {
  const cambios: string[] = []
  const hoy = hoyAR()

  const { data: pol } = await supabase
    .from('polizas')
    .select('id, numero_poliza, estado, fecha_fin')
    .eq('id', polizaId)
    .maybeSingle()

  if (!pol) return { ok: false, cambios, errores: ['Póliza no encontrada'] }
  if ((pol as any).estado !== 'VIGENTE') return { ok: true, cambios }
  if ((pol as any).fecha_fin >= hoy) return { ok: true, cambios }

  // Verificar si tiene renovación activa antes de bajarla
  const { data: renovaciones } = await supabase
    .from('polizas')
    .select('id')
    .eq('poliza_origen_id', polizaId)
    .in('estado', ['RENOVADA', 'VIGENTE'])
    .limit(1)

  if (renovaciones && renovaciones.length > 0) return { ok: true, cambios } // tiene renovación, no vencer

  const { data: vencida } = await supabase
    .from('polizas')
    .update({ estado: 'NO_VIGENTE' })
    .eq('id', polizaId)
    .eq('estado', 'VIGENTE')
    .select('id, numero_poliza')
    .maybeSingle()

  if (!vencida) return { ok: true, cambios }

  cambios.push(`Póliza ${(vencida as any).numero_poliza} → NO_VIGENTE (fecha_fin pasada sin renovación)`)

  await limpiarDocumentacion(supabase, (vencida as any).numero_poliza, polizaId)
  await registrarEventoBitacora(supabase, {
    poliza_id: polizaId,
    tipo_evento: 'CAMBIO_ESTADO',
    estado_anterior: 'VIGENTE',
    estado_nuevo: 'NO_VIGENTE',
    motivo: 'Venció la fecha de fin sin renovación',
    usuario_id: usuarioId,
  })

  return { ok: true, cambios }
}

/**
 * Si una póliza PROGRAMADA llegó a su fecha de inicio, la pasa a VIGENTE.
 * Idempotente.
 */
export async function activarProgramadaSiCorresponde(
  supabase: any,
  polizaId: string,
  usuarioId: string | null,
): Promise<ResultadoTransicion> {
  const cambios: string[] = []
  const hoy = hoyAR()

  const { data: pol } = await supabase
    .from('polizas')
    .select('id, numero_poliza, estado, fecha_inicio')
    .eq('id', polizaId)
    .maybeSingle()

  if (!pol) return { ok: false, cambios, errores: ['Póliza no encontrada'] }
  if ((pol as any).estado !== 'PROGRAMADA') return { ok: true, cambios }
  if ((pol as any).fecha_inicio > hoy) return { ok: true, cambios }

  const { data: activada } = await supabase
    .from('polizas')
    .update({ estado: 'VIGENTE' })
    .eq('id', polizaId)
    .eq('estado', 'PROGRAMADA')
    .select('id')
    .maybeSingle()

  if (!activada) return { ok: true, cambios }

  cambios.push(`Póliza ${(pol as any).numero_poliza} activada (PROGRAMADA → VIGENTE)`)

  await registrarEventoBitacora(supabase, {
    poliza_id: polizaId,
    tipo_evento: 'CAMBIO_ESTADO',
    estado_anterior: 'PROGRAMADA',
    estado_nuevo: 'VIGENTE',
    motivo: 'Activación al guardar edición de fechas (sin esperar al cron)',
    usuario_id: usuarioId,
  })

  return { ok: true, cambios }
}
