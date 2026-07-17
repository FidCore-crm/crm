import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { ERRORES, respuestaError, respuestaExito, manejarErrores, ErrorAplicacion } from '@/lib/errores'
import { tieneAccesoTotal } from '@/lib/cartera-filter'
import { validarYNormalizarSiniestro } from '@/lib/siniestros-validacion'
import { esEstadoTerminal } from '@/lib/siniestros-estados'
import { registrarEventoBitacoraSiniestro } from '@/lib/bitacora-siniestro'
import { requireLicenciaActiva } from '@/lib/licencia-guard'

export const GET = manejarErrores(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)

  const supabase = getSupabaseAdmin()

  const { data: siniestro, error } = await supabase
    .from('siniestros')
    .select('id, numero_caso, persona_id, deleted_at')
    .eq('id', id)
    .is('deleted_at', null)
    .single()
  if (error || !siniestro) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)

  // Filtro de cartera
  if (usuario.acceso_cartera === 'PROPIA') {
    const { data: persona } = await supabase.from('personas').select('usuario_id').eq('id', (siniestro as any).persona_id).single()
    if (persona && (persona as any).usuario_id && (persona as any).usuario_id !== usuario.id) {
      return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)
    }
  }

  const [{ count: bitacora }, { count: archivos }] = await Promise.all([
    supabase
      .from('siniestro_bitacora')
      .select('id', { count: 'exact', head: true })
      .eq('siniestro_id', id),
    supabase
      .from('siniestro_archivos')
      .select('id', { count: 'exact', head: true })
      .eq('siniestro_id', id),
  ])

  return respuestaExito({
    puede_eliminar: true,
    resumen: {
      bitacora: bitacora ?? 0,
      archivos: archivos ?? 0,
    },
  })
}, { modulo: 'siniestros' })

/**
 * Soft-delete: marca `deleted_at` en vez de borrar físicamente. El cron
 * `/api/cron/siniestros-purgar` se encarga del DELETE real (bitácora,
 * archivos en disco, notificaciones) cuando pasan 30 días en la papelera.
 * Hasta entonces se puede restaurar con `POST /api/siniestros/[id]/restaurar`.
 */
export const DELETE = manejarErrores(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params

  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)
  if (usuario.rol !== 'ADMIN') return respuestaError(ERRORES.PERM_SIN_PERMISO)

  await requireLicenciaActiva()

  const supabase = getSupabaseAdmin()

  const { data: siniestro, error } = await supabase
    .from('siniestros')
    .select('id, numero_caso, estado, deleted_at')
    .eq('id', id)
    .single()
  if (error || !siniestro) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)

  if ((siniestro as any).deleted_at) {
    return respuestaError(ERRORES.NEG_OPERACION_INVALIDA, {
      detalle: 'El siniestro ya está en la papelera',
    })
  }

  const { error: errSoft } = await supabase
    .from('siniestros')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by_usuario_id: usuario.id,
    })
    .eq('id', id)

  if (errSoft) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
      detalle: errSoft.message,
      contexto: { tabla: 'siniestros', operacion: 'soft-delete', id },
    })
  }

  await registrarEventoBitacoraSiniestro(supabase, {
    siniestro_id: id,
    tipo: 'ELIMINACION',
    estado_anterior: (siniestro as any).estado,
    usuario_id: usuario.id,
  })

  return respuestaExito({
    soft_deleted: true,
    numero_caso: (siniestro as any).numero_caso,
    purga_definitiva_en_dias: 30,
  })
}, { modulo: 'siniestros' })

/**
 * PATCH /api/siniestros/[id]
 *
 * Edición parcial del siniestro: numero_siniestro, fechas, montos, datos del
 * tercero, descripción, lugar, detalle por ramo, notas. NO permite cambiar
 * el estado — para eso usar POST /api/siniestros/[id]/cambiar-estado.
 *
 * Bloquea ediciones sobre siniestros en estado terminal (FINALIZADO/RECHAZADO),
 * salvo la carga del numero_siniestro (que la compañía suele dar después).
 */
export const PATCH = manejarErrores(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params

  await requireLicenciaActiva()

  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return respuestaError(ERRORES.VALID_FORMATO_INVALIDO)
  }

  if ('estado' in body) {
    return respuestaError(ERRORES.NEG_OPERACION_INVALIDA, {
      detalle: 'El estado se cambia con POST /api/siniestros/[id]/cambiar-estado',
    })
  }

  const supabase = getSupabaseAdmin()

  const { data: actual, error: errSel } = await supabase
    .from('siniestros')
    .select('id, persona_id, estado, fecha_ocurrencia, fecha_denuncia, monto_estimado, monto_liquidado, updated_at')
    .eq('id', id)
    .is('deleted_at', null)
    .single()
  if (errSel || !actual) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)

  // Filtro de cartera
  if (!tieneAccesoTotal(usuario)) {
    const { data: persona } = await supabase
      .from('personas')
      .select('usuario_id')
      .eq('id', (actual as any).persona_id)
      .single()
    if (persona && (persona as any).usuario_id && (persona as any).usuario_id !== usuario.id) {
      return respuestaError(ERRORES.PERM_RECURSO_AJENO)
    }
  }

  // Optimistic concurrency check (#81)
  if (
    body.if_match_updated_at &&
    !body.force_overwrite &&
    (actual as any).updated_at &&
    body.if_match_updated_at !== (actual as any).updated_at
  ) {
    return respuestaError(ERRORES.NEG_CONFLICTO_CONCURRENCIA, {
      registro_actual: actual,
    })
  }

  // Si el siniestro está en estado terminal, solo permitimos cargar
  // numero_siniestro (la compañía lo asigna después del cierre del caso).
  const estadoTerminal = esEstadoTerminal((actual as any).estado)
  if (estadoTerminal) {
    const camposPermitidos = new Set(['numero_siniestro'])
    const camposEnBody = Object.keys(body)
    const noPermitidos = camposEnBody.filter(k => !camposPermitidos.has(k))
    if (noPermitidos.length > 0) {
      return respuestaError(ERRORES.NEG_OPERACION_INVALIDA, {
        detalle: `Siniestro en estado terminal. Solo se puede editar: ${Array.from(camposPermitidos).join(', ')}`,
      })
    }
  }

  const validacion = validarYNormalizarSiniestro(body, 'editar', {
    fecha_ocurrencia: (actual as any).fecha_ocurrencia,
    fecha_denuncia: (actual as any).fecha_denuncia,
    monto_estimado: (actual as any).monto_estimado,
    monto_liquidado: (actual as any).monto_liquidado,
  })
  if (!validacion.ok) {
    return respuestaError(ERRORES.VALID_CAMPO_REQUERIDO, { campos: validacion.campos })
  }

  // Solo aplicamos los campos que vinieron en el body.
  const payload: Record<string, any> = {}
  const camposEditables = [
    'numero_siniestro', 'fecha_ocurrencia', 'fecha_denuncia', 'fecha_cierre',
    'hora_siniestro', 'tipo_siniestro', 'descripcion', 'detalle_siniestro',
    'lugar_siniestro', 'localidad_siniestro',
    'monto_estimado', 'monto_liquidado', 'franquicia_aplicada', 'monto_cobrado',
    'tercero_nombre', 'tercero_dni', 'tercero_telefono', 'tercero_patente',
    'notas',
  ]
  for (const campo of camposEditables) {
    if (body[campo] !== undefined) {
      payload[campo] = (validacion.datos as any)[campo]
    }
  }

  if (Object.keys(payload).length === 0) {
    return respuestaExito({ actualizado: false })
  }

  // Detectar cambios reales para no escribir bitácoras vacías.
  const camposModificados = Object.keys(payload).filter((k) => {
    const antes = (actual as any)[k]
    const ahora = payload[k]
    const a = antes === '' || antes === undefined ? null : antes
    const b = ahora === '' || ahora === undefined ? null : ahora
    return JSON.stringify(a) !== JSON.stringify(b)
  })
  if (camposModificados.length === 0) {
    return respuestaExito({ actualizado: false })
  }

  // Marcamos fecha_ultimo_movimiento porque cambiaron datos del caso.
  payload.fecha_ultimo_movimiento = new Date().toISOString()

  const { data: sinActualizado, error: errUpdate } = await supabase
    .from('siniestros')
    .update(payload)
    .eq('id', id)
    .select('updated_at')
    .single()

  if (errUpdate) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
      detalle: errUpdate.message,
      contexto: { tabla: 'siniestros', operacion: 'update', id },
    })
  }

  const camposVisibles = camposModificados.filter(c => c !== 'fecha_ultimo_movimiento')
  await registrarEventoBitacoraSiniestro(supabase, {
    siniestro_id: id,
    tipo: 'EDICION',
    campos_modificados: camposVisibles,
    usuario_id: usuario.id,
  })

  return respuestaExito({
    actualizado: true,
    campos_modificados: camposVisibles,
    updated_at: (sinActualizado as any)?.updated_at ?? null,
  })
}, { modulo: 'siniestros' })
