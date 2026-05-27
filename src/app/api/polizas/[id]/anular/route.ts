import { NextResponse } from 'next/server'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { registrarEventoBitacora } from '@/lib/bitacora-poliza'
import { eliminarArchivosRenovacionLatente, obtenerCadenaHijasRenovadas } from '@/lib/storage-utils'
import { hoyAR } from '@/lib/utils'
import {
  ERRORES,
  respuestaError,
  respuestaExito,
  manejarErrores,
  ErrorAplicacion,
  logger,
} from '@/lib/errores'
import { ESTADOS_BAJA_PERMITIDA, ESTADO_POLIZA } from '@/lib/polizas-estados'
import { requireLicenciaActiva } from '@/lib/licencia-guard'

export const POST = manejarErrores(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params

  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  await requireLicenciaActiva()

  const supabase = getSupabaseAdmin()

  // Cargar póliza con datos de ownership
  const { data: poliza, error: errPol } = await supabase
    .from('polizas')
    .select('id, estado, numero_poliza, asegurado:personas!asegurado_id (id, usuario_id)')
    .eq('id', id)
    .single()

  if (errPol || !poliza) {
    return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO, {
      detalle: 'Póliza no encontrada',
    })
  }

  // Verificar acceso por cartera
  const owns = requireOwnership(usuario, {
    usuario_id: (poliza as any).asegurado?.usuario_id ?? null,
  })
  if (owns) return owns

  // Validar estado
  if (!ESTADOS_BAJA_PERMITIDA.includes((poliza as any).estado)) {
    return respuestaError(ERRORES.NEG_OPERACION_INVALIDA, {
      detalle: `No se puede anular una póliza en estado ${(poliza as any).estado}. Solo se puede anular si está VIGENTE, PROGRAMADA o RENOVADA.`,
    })
  }

  // Validar que no haya siniestros activos. Si los hay, hay que cerrarlos o rechazarlos antes.
  const { count: siniestrosAbiertos } = await supabase
    .from('siniestros')
    .select('id', { count: 'exact', head: true })
    .eq('poliza_id', id)
    .not('estado', 'in', '("FINALIZADO","RECHAZADO")')
  if (siniestrosAbiertos && siniestrosAbiertos > 0) {
    return respuestaError(ERRORES.NEG_OPERACION_INVALIDA, {
      detalle: `No se puede anular: hay ${siniestrosAbiertos} siniestro(s) activo(s) en esta póliza. Cerralos o rechazalos primero.`,
    })
  }

  const body = await request.json()
  const { motivo_baja, observaciones_baja, fecha_baja } = body

  if (!motivo_baja) {
    return respuestaError(ERRORES.VALID_CAMPO_REQUERIDO, {
      campos: { motivo_baja: 'El motivo de anulación es obligatorio' },
    })
  }

  const estadoAnterior = (poliza as any).estado

  // Actualizar póliza
  const { error: errUpdate } = await supabase
    .from('polizas')
    .update({
      estado: ESTADO_POLIZA.ANULADA,
      motivo_baja,
      fecha_baja: fecha_baja || hoyAR(),
      observaciones_baja: observaciones_baja || null,
    })
    .eq('id', id)

  if (errUpdate) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
      detalle: errUpdate.message,
      contexto: { poliza_id: id },
    })
  }

  // Registrar en bitácora
  await registrarEventoBitacora(supabase, {
    poliza_id: id,
    tipo_evento: 'ANULACION',
    estado_anterior: estadoAnterior,
    estado_nuevo: ESTADO_POLIZA.ANULADA,
    motivo: motivo_baja,
    observaciones: observaciones_baja || null,
    usuario_id: usuario.id,
  })

  // Eliminar pólizas hijas RENOVADAS (latentes) recursivamente — limpia storage + DB
  const hijas = await obtenerCadenaHijasRenovadas(supabase, id)
  for (const hija of hijas) {
    const result = await eliminarArchivosRenovacionLatente(supabase, hija.numero_poliza, hija.id)
    if (!result.ok) {
      logger.warn({
        modulo: 'polizas',
        mensaje: `No se pudo limpiar storage de renovación hija ${hija.numero_poliza}`,
        contexto: { error: result.error, poliza_id: hija.id },
      })
    }
    await supabase.from('riesgos').delete().eq('poliza_id', hija.id)
    await supabase.from('polizas').delete().eq('id', hija.id)
  }

  // Limpiar notificaciones vinculadas
  await supabase
    .from('notificaciones')
    .delete()
    .eq('entidad_tipo', 'poliza')
    .eq('entidad_id', id)

  return respuestaExito({
    estado: ESTADO_POLIZA.ANULADA,
    hijas_eliminadas: hijas.length,
  })
}, { modulo: 'polizas' })
