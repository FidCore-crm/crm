import { NextResponse } from 'next/server'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { registrarEventoBitacora } from '@/lib/bitacora-poliza'
import { requireLicenciaActiva } from '@/lib/licencia-guard'
import {
  ERRORES,
  respuestaError,
  respuestaExito,
  manejarErrores,
  ErrorAplicacion,
} from '@/lib/errores'
import { hoyAR } from '@/lib/utils'

type EstadoRehabilitado = 'PROGRAMADA' | 'VIGENTE' | 'NO_VIGENTE'

function hoyDate(): Date {
  // Usar hoyAR() para que entre 21-24hs ARG el cálculo no quede 1 día
  // adelantado (en UTC ya cambió de día). hoyAR() devuelve 'YYYY-MM-DD' en
  // zona Argentina; construimos un Date local con hora 00:00:00.
  const [y, m, d] = hoyAR().split('-').map(Number)
  return new Date(y, m - 1, d)
}

function toDate(iso: string): Date {
  const d = new Date(iso)
  d.setHours(0, 0, 0, 0)
  return d
}

function calcularEstadoRehabilitacion(
  fechaInicio: string,
  fechaFin: string,
): EstadoRehabilitado {
  const hoy = hoyDate().getTime()
  const fi = toDate(fechaInicio).getTime()
  const ff = toDate(fechaFin).getTime()
  if (hoy < fi) return 'PROGRAMADA'
  if (hoy > ff) return 'NO_VIGENTE'
  return 'VIGENTE'
}

export const POST = manejarErrores(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  await requireLicenciaActiva()

  const { id } = await params
  let body: any
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const supabase = getSupabaseAdmin()

  const { data: poliza } = await supabase
    .from('polizas')
    .select(`
      id, numero_poliza, estado, fecha_inicio, fecha_fin,
      motivo_baja, fecha_baja, observaciones_baja, updated_at,
      asegurado:personas!asegurado_id (id, usuario_id)
    `)
    .eq('id', id)
    .maybeSingle()

  if (!poliza) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)

  const owns = requireOwnership(usuario, {
    usuario_id: (poliza as any).asegurado?.usuario_id ?? null,
  })
  if (owns) return owns

  // Optimistic concurrency (#81). Solo en la operación real, no en el preview.
  if (
    body?.preview !== true &&
    body?.if_match_updated_at &&
    !body?.force_overwrite &&
    (poliza as any).updated_at &&
    body.if_match_updated_at !== (poliza as any).updated_at
  ) {
    return respuestaError(ERRORES.NEG_CONFLICTO_CONCURRENCIA, {
      registro_actual: poliza,
    })
  }

  const estadoActual = (poliza as any).estado as string
  if (estadoActual !== 'CANCELADA' && estadoActual !== 'ANULADA') {
    return respuestaError(ERRORES.NEG_OPERACION_INVALIDA, {
      detalle: 'Solo se pueden rehabilitar pólizas canceladas o anuladas',
    })
  }

  const estadoNuevo = calcularEstadoRehabilitacion(
    (poliza as any).fecha_inicio,
    (poliza as any).fecha_fin,
  )

  const advertencias: string[] = []

  if (estadoNuevo === 'NO_VIGENTE') {
    advertencias.push('La póliza ya venció, se rehabilitará como NO_VIGENTE (histórica).')
  }

  // Si va a quedar VIGENTE, advertir si hay otra póliza del mismo asegurado
  // que cubre la misma ventana (puede ser una renovación que ya tomó su lugar).
  // No bloqueamos — el PAS debe decidir, pero le mostramos el conflicto.
  if (estadoNuevo === 'VIGENTE') {
    const aseguradoId = (poliza as any).asegurado_id
    const fInicio = (poliza as any).fecha_inicio
    const fFin = (poliza as any).fecha_fin
    if (aseguradoId && fInicio && fFin) {
      const { data: superposiciones } = await supabase
        .from('polizas')
        .select('id, numero_poliza, fecha_inicio, fecha_fin')
        .eq('asegurado_id', aseguradoId)
        .eq('estado', 'VIGENTE')
        .neq('id', id)
        .or(`and(fecha_inicio.lte.${fFin},fecha_fin.gte.${fInicio})`)
      if (superposiciones && superposiciones.length > 0) {
        const nums = (superposiciones as any[]).map(p => p.numero_poliza).join(', ')
        advertencias.push(
          `El asegurado ya tiene ${superposiciones.length} póliza(s) VIGENTE(S) cubriendo total o parcialmente este período (${nums}). Si rehabilitás, quedarán dos pólizas vigentes superpuestas.`,
        )
      }
    }
  }

  const { data: hijasExistentes } = await supabase
    .from('polizas')
    .select('id, numero_poliza, estado')
    .eq('poliza_origen_id', id)
  if (!hijasExistentes || hijasExistentes.length === 0) {
    advertencias.push(
      'Esta póliza pudo haber sido renovada en su momento. La renovación fue eliminada al cancelar y NO se restaura automáticamente. Si querés la renovación, tenés que crearla de nuevo.',
    )
  }

  const fechaBaja = (poliza as any).fecha_baja
  if (fechaBaja) {
    const { data: sinPosteriores } = await supabase
      .from('siniestros')
      .select('id, estado')
      .eq('poliza_id', id)
      .gte('fecha_denuncia', fechaBaja)
    const activos = (sinPosteriores || []).filter(
      (s: any) => !['FINALIZADO', 'RECHAZADO'].includes(s.estado),
    )
    if (activos.length > 0) {
      advertencias.push(
        `Hay ${activos.length} siniestro${activos.length !== 1 ? 's' : ''} registrado${activos.length !== 1 ? 's' : ''} después de la baja que siguen activos.`,
      )
    }
  }

  if (body?.preview === true) {
    return respuestaExito({
      preview: true,
      estado_actual: estadoActual,
      estado_nuevo: estadoNuevo,
      advertencias,
    })
  }

  const motivoRehab: string = (body?.motivo || 'Rehabilitación manual').toString().trim()
  const observacionesRehab: string | null = body?.observaciones
    ? String(body.observaciones).trim()
    : null

  const { error: errUpd } = await supabase
    .from('polizas')
    .update({
      estado: estadoNuevo,
      motivo_baja: null,
      fecha_baja: null,
      observaciones_baja: null,
    } as any)
    .eq('id', id)

  if (errUpd) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
      detalle: errUpd.message,
      contexto: { tabla: 'polizas', operacion: 'update', id },
    })
  }

  await registrarEventoBitacora(supabase, {
    poliza_id: id,
    tipo_evento: 'REHABILITACION',
    estado_anterior: estadoActual,
    estado_nuevo: estadoNuevo,
    motivo: motivoRehab,
    observaciones: observacionesRehab,
    usuario_id: usuario.id,
  })

  try {
    await supabase.from('notificaciones').insert({
      tipo: 'POLIZA_REHABILITADA',
      prioridad: 'INFORMATIVA',
      titulo: 'Póliza rehabilitada',
      mensaje: `La póliza ${(poliza as any).numero_poliza} fue rehabilitada como ${estadoNuevo}.`,
      entidad_tipo: 'poliza',
      entidad_id: id,
      url: `/crm/polizas/${id}`,
      leida: false,
      usuario_id: usuario.id,
    } as any)
  } catch {
    // No bloqueante
  }

  return respuestaExito({
    poliza_id: id,
    estado_anterior: estadoActual,
    estado_nuevo: estadoNuevo,
    advertencias,
  })
}, { modulo: 'polizas' })
