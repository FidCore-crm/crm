import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import {
  ERRORES,
  ErrorAplicacion,
  manejarErrores,
  respuestaError,
  respuestaExito,
} from '@/lib/errores'
import { tieneAccesoTotal } from '@/lib/cartera-filter'
import { esTransicionValida } from '@/lib/siniestros-estados'
import { registrarEventoBitacoraSiniestro } from '@/lib/bitacora-siniestro'
import { requireLicenciaActiva } from '@/lib/licencia-guard'

/**
 * Cambia el estado de un siniestro respetando la máquina de estados.
 *
 * Body: { estado_nuevo: string; monto_liquidado?: number; motivo_rechazo?: string; nota?: string }
 *
 * - Valida que la transición sea permitida (`esTransicionValida`).
 * - Si el estado_nuevo es RECHAZADO, exige `motivo_rechazo`.
 * - Si se pasa `monto_liquidado`, valida que sea ≥ 0 y ≤ monto_estimado.
 * - Registra el evento en `siniestro_bitacora` con tipo ESTADO.
 * - Actualiza `fecha_cierre` automáticamente al pasar a FINALIZADO/RECHAZADO.
 * - Actualiza `fecha_ultimo_movimiento` para el cron de notificaciones.
 */
export const POST = manejarErrores(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params

  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)

  await requireLicenciaActiva()

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return respuestaError(ERRORES.VALID_FORMATO_INVALIDO)
  }

  const estadoNuevo: string = String(body.estado_nuevo ?? '').trim()
  if (!estadoNuevo) {
    return respuestaError(ERRORES.VALID_CAMPO_REQUERIDO, {
      campos: { estado_nuevo: 'Estado nuevo requerido' },
    })
  }

  const supabase = getSupabaseAdmin()

  // Cargar siniestro actual con info de propiedad y montos.
  const { data: siniestro, error: errSel } = await supabase
    .from('siniestros')
    .select('id, estado, persona_id, monto_estimado, monto_liquidado, fecha_denuncia')
    .eq('id', id)
    .is('deleted_at', null)
    .single()
  if (errSel || !siniestro) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)

  // Filtro de cartera
  if (!tieneAccesoTotal(usuario)) {
    const { data: persona } = await supabase
      .from('personas')
      .select('usuario_id')
      .eq('id', (siniestro as any).persona_id)
      .single()
    if (persona && (persona as any).usuario_id && (persona as any).usuario_id !== usuario.id) {
      return respuestaError(ERRORES.PERM_RECURSO_AJENO)
    }
  }

  const estadoActual = (siniestro as any).estado as string

  // Si el estado no cambia, no hacemos nada.
  if (estadoNuevo === estadoActual) {
    return respuestaExito({ actualizado: false })
  }

  // Validar transición contra la máquina de estados.
  if (!esTransicionValida(estadoActual, estadoNuevo)) {
    return respuestaError(ERRORES.NEG_OPERACION_INVALIDA, {
      campos: {
        estado_nuevo: `No se puede pasar de ${estadoActual} a ${estadoNuevo}`,
      },
    })
  }

  // Si va a RECHAZADO, exigir motivo.
  let motivoRechazo: string | null = null
  if (estadoNuevo === 'RECHAZADO') {
    motivoRechazo = String(body.motivo_rechazo ?? '').trim() || null
    if (!motivoRechazo) {
      return respuestaError(ERRORES.VALID_CAMPO_REQUERIDO, {
        campos: { motivo_rechazo: 'El motivo del rechazo es obligatorio' },
      })
    }
  }

  // Validar monto_liquidado si vino.
  let montoLiquidado: number | null | undefined
  if (body.monto_liquidado !== undefined && body.monto_liquidado !== null && body.monto_liquidado !== '') {
    const m = typeof body.monto_liquidado === 'number'
      ? body.monto_liquidado
      : parseFloat(String(body.monto_liquidado).replace(/[^\d.-]/g, ''))
    if (isNaN(m) || !isFinite(m) || m < 0) {
      return respuestaError(ERRORES.VALID_FORMATO_INVALIDO, {
        campos: { monto_liquidado: 'Monto inválido' },
      })
    }
    const mEst = (siniestro as any).monto_estimado as number | null
    if (mEst !== null && mEst !== undefined && m > mEst) {
      return respuestaError(ERRORES.VALID_FORMATO_INVALIDO, {
        campos: { monto_liquidado: `No puede superar el monto estimado (${mEst})` },
      })
    }
    montoLiquidado = m
  }

  // Construir update.
  const updates: Record<string, any> = {
    estado: estadoNuevo,
    fecha_ultimo_movimiento: new Date().toISOString(),
  }
  if (montoLiquidado !== undefined) updates.monto_liquidado = montoLiquidado

  // Cierre automático al llegar a estados terminales.
  if (estadoNuevo === 'FINALIZADO' || estadoNuevo === 'RECHAZADO') {
    updates.fecha_cierre = new Date().toISOString()
  }

  if (motivoRechazo) updates.motivo_rechazo = motivoRechazo

  const { error: errUpdate } = await supabase
    .from('siniestros')
    .update(updates)
    .eq('id', id)

  if (errUpdate) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
      detalle: errUpdate.message,
      contexto: { tabla: 'siniestros', operacion: 'cambiar-estado', id },
    })
  }

  // Construir nota de la bitácora.
  const nota = String(body.nota ?? '').trim() || null
  let texto: string | null = null
  if (motivoRechazo) {
    texto = `Motivo del rechazo: ${motivoRechazo}${nota ? ` — ${nota}` : ''}`
  } else if (montoLiquidado !== undefined) {
    texto = `Monto liquidado actualizado a ${montoLiquidado}${nota ? ` — ${nota}` : ''}`
  } else if (nota) {
    texto = nota
  }

  await registrarEventoBitacoraSiniestro(supabase, {
    siniestro_id: id,
    tipo: 'ESTADO',
    estado_anterior: estadoActual,
    estado_nuevo: estadoNuevo,
    monto_actualizado: montoLiquidado ?? null,
    texto,
    usuario_id: usuario.id,
  })

  return respuestaExito({
    actualizado: true,
    estado_nuevo: estadoNuevo,
    fecha_cierre: updates.fecha_cierre ?? null,
  })
}, { modulo: 'siniestros' })
