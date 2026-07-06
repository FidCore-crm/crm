import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { ERRORES, respuestaError, respuestaExito, manejarErrores, ErrorAplicacion, logger } from '@/lib/errores'
import { tieneAccesoTotal } from '@/lib/cartera-filter'
import { validarYNormalizarPersona } from '@/lib/personas-validacion'
import { registrarEventoBitacoraPersona } from '@/lib/bitacora-persona'
import { requireLicenciaActiva } from '@/lib/licencia-guard'
import { variantesBusquedaIdentificador } from '@/lib/identificador-persona'

// Obtener toda la cadena de renovaciones hacia abajo (iterativa).
// Usado solo por el GET de preview de eliminación.
async function obtenerCadenaAbajo(supabase: any, polizaId: string): Promise<{ id: string; numero_poliza: string }[]> {
  const resultado: { id: string; numero_poliza: string }[] = []
  const cola = [polizaId]

  while (cola.length > 0) {
    const currentId = cola.shift()!
    const { data: hijas } = await supabase
      .from('polizas')
      .select('id, numero_poliza')
      .eq('poliza_origen_id', currentId)
    for (const h of (hijas ?? []) as any[]) {
      resultado.push({ id: h.id, numero_poliza: h.numero_poliza })
      cola.push(h.id)
    }
  }

  return resultado
}

export const GET = manejarErrores(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)

  const supabase = getSupabaseAdmin()

  const { data: persona, error } = await supabase
    .from('personas')
    .select('id, apellido, nombre, dni_cuil, usuario_id, deleted_at')
    .eq('id', id)
    .is('deleted_at', null)
    .single()
  if (error || !persona) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)

  // Filtro de cartera: PROPIA solo ve sus clientes
  if (usuario.acceso_cartera === 'PROPIA' && (persona as any).usuario_id && (persona as any).usuario_id !== usuario.id) {
    return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)
  }

  // Validar: pólizas vigentes
  const { count: vigentes } = await supabase.from('polizas').select('id', { count: 'exact', head: true }).eq('asegurado_id', id).eq('estado', 'VIGENTE')
  if (vigentes && vigentes > 0) {
    return NextResponse.json({
      ok: false,
      motivo: 'POLIZAS_VIGENTES',
      cantidad: vigentes,
      mensaje: `No se puede eliminar este cliente porque tiene ${vigentes} póliza(s) vigente(s). Cancelá o anulá las pólizas vigentes primero.`,
    }, { status: 400 })
  }

  // Obtener todas las pólizas directas + cadenas, con detalle para mostrar
  const { data: polizasDirectas } = await supabase
    .from('polizas')
    .select('id, numero_poliza, fecha_inicio, fecha_fin, estado')
    .eq('asegurado_id', id)
    .order('fecha_fin', { ascending: false })
  const pIds = (polizasDirectas ?? []).map((p: any) => p.id)
  let allPolizaIds = [...pIds]
  for (const pId of pIds) {
    const hijas = await obtenerCadenaAbajo(supabase, pId)
    allPolizaIds.push(...hijas.map(h => h.id))
  }
  allPolizaIds = Array.from(new Set(allPolizaIds))

  // Detalle de pólizas (las directas — limitamos a 10 para no llenar el modal)
  const detallePolizas = (polizasDirectas ?? []).slice(0, 10).map((p: any) => ({
    numero_poliza: p.numero_poliza,
    fecha_fin: p.fecha_fin,
    estado: p.estado,
  }))

  // Calcular resumen
  const { count: tareas } = await supabase.from('tareas').select('id', { count: 'exact', head: true }).eq('persona_id', id)

  // Siniestros de toda la cadena + directos
  const { data: sinDirectosData } = await supabase
    .from('siniestros')
    .select('id, numero_caso, fecha_denuncia, estado')
    .eq('persona_id', id)
    .order('fecha_denuncia', { ascending: false })
  let siniestros = (sinDirectosData ?? []).length
  let detalleSiniestros = (sinDirectosData ?? []).slice(0, 10).map((s: any) => ({
    numero_caso: s.numero_caso,
    fecha_denuncia: s.fecha_denuncia,
    estado: s.estado,
  }))
  if (allPolizaIds.length > 0) {
    const { count: sinPolizas } = await supabase
      .from('siniestros')
      .select('id', { count: 'exact', head: true })
      .in('poliza_id', allPolizaIds)
      .neq('persona_id', id)
    siniestros += sinPolizas ?? 0
  }

  // Archivos
  let archivos_polizas = 0
  let archivos_siniestros = 0
  if (allPolizaIds.length > 0) {
    const { count: ap } = await supabase.from('poliza_archivos').select('id', { count: 'exact', head: true }).in('poliza_id', allPolizaIds)
    archivos_polizas = ap ?? 0
  }
  const { data: sinIds } = await supabase.from('siniestros').select('id').eq('persona_id', id)
  const sIds = (sinIds ?? []).map((s: any) => s.id)
  if (sIds.length > 0) {
    const { count: as_ } = await supabase.from('siniestro_archivos').select('id', { count: 'exact', head: true }).in('siniestro_id', sIds)
    archivos_siniestros = as_ ?? 0
  }

  // Oportunidades y cotizaciones (pueden no existir)
  let oportunidades = 0
  let cotizaciones = 0
  try {
    const { count: o } = await supabase.from('oportunidades').select('id', { count: 'exact', head: true }).eq('persona_id', id)
    oportunidades = o ?? 0
  } catch (err) {
    // Silenciado: tabla oportunidades puede no existir en todas las instalaciones
    logger.warn({ modulo: 'personas', mensaje: 'Error contando oportunidades para preview de eliminación', contexto: { persona_id: id, error: String(err) } })
  }
  try {
    const { count: c } = await supabase.from('cotizaciones').select('id', { count: 'exact', head: true }).eq('persona_id', id)
    cotizaciones = c ?? 0
  } catch (err) {
    // Silenciado: tabla cotizaciones puede no existir en todas las instalaciones
    logger.warn({ modulo: 'personas', mensaje: 'Error contando cotizaciones para preview de eliminación', contexto: { persona_id: id, error: String(err) } })
  }

  return respuestaExito({
    puede_eliminar: true,
    resumen: {
      polizas: pIds.length,
      siniestros,
      tareas: tareas ?? 0,
      oportunidades,
      cotizaciones,
      archivos_polizas,
      archivos_siniestros,
    },
    detalle: {
      polizas: detallePolizas,
      siniestros: detalleSiniestros,
    },
  })
}, { modulo: 'personas' })

/**
 * Soft-delete: marca deleted_at en vez de borrar físicamente.
 * El cron `/api/cron/personas-purgar` se encarga del DELETE real (con cascada
 * y archivos físicos) cuando pasan 30 días en la papelera. Hasta entonces
 * la persona se puede restaurar con `POST /api/personas/[id]/restaurar`.
 *
 * El parámetro de querystring `purgar=1` fuerza la eliminación inmediata
 * (uso interno desde el cron de purga — protegido por validarCronSecret).
 */
export const DELETE = manejarErrores(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)
  if (usuario.rol !== 'ADMIN') return respuestaError(ERRORES.PERM_SIN_PERMISO)

  await requireLicenciaActiva()

  const supabase = getSupabaseAdmin()

  const { data: persona, error } = await supabase
    .from('personas')
    .select('id, apellido, nombre, estado, deleted_at')
    .eq('id', id)
    .single()
  if (error || !persona) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)

  if ((persona as any).deleted_at) {
    // Ya está en papelera. No se vuelve a marcar.
    return respuestaError(ERRORES.NEG_OPERACION_INVALIDA, {
      detalle: 'La persona ya está en la papelera',
    })
  }

  // Validación: si tiene pólizas VIGENTES no se puede mandar a la papelera.
  const { count: vigentes } = await supabase
    .from('polizas')
    .select('id', { count: 'exact', head: true })
    .eq('asegurado_id', id)
    .eq('estado', 'VIGENTE')
  if (vigentes && vigentes > 0) {
    return NextResponse.json({
      ok: false,
      motivo: 'POLIZAS_VIGENTES',
      cantidad: vigentes,
      mensaje: `No se puede eliminar este cliente porque tiene ${vigentes} póliza(s) vigente(s). Cancelá o anulá las pólizas vigentes primero.`,
    }, { status: 400 })
  }

  // Soft-delete: marca timestamp + auditor.
  const { error: errSoft } = await supabase
    .from('personas')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by_usuario_id: usuario.id,
    })
    .eq('id', id)

  if (errSoft) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
      detalle: errSoft.message,
      contexto: { tabla: 'personas', operacion: 'soft-delete', id },
    })
  }

  await registrarEventoBitacoraPersona(supabase, {
    persona_id: id,
    tipo_evento: 'ELIMINACION',
    estado_anterior: (persona as any).estado,
    usuario_id: usuario.id,
  })

  return respuestaExito({
    soft_deleted: true,
    purga_definitiva_en_dias: 30,
  })
}, { modulo: 'personas' })


export const PATCH = manejarErrores(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)

  await requireLicenciaActiva()

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return respuestaError(ERRORES.VALID_FORMATO_INVALIDO)
  }

  const supabase = getSupabaseAdmin()

  // Cargar persona actual con todos los campos comparables para detectar cambios.
  const { data: actual, error: errSelect } = await supabase
    .from('personas')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single()
  if (errSelect || !actual) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)

  // Filtro de cartera: PROPIA solo puede tocar sus clientes (también previene
  // bypass del control que vivía solo en el frontend).
  if (!tieneAccesoTotal(usuario) && (actual as any).usuario_id && (actual as any).usuario_id !== usuario.id) {
    return respuestaError(ERRORES.PERM_RECURSO_AJENO)
  }

  // Optimistic concurrency check (#81): si el cliente envía `if_match_updated_at`
  // y ese valor no coincide con el `updated_at` actual de la DB, significa que
  // otro usuario modificó el registro entre la carga y este save. Devolvemos
  // 409 con el registro actual para que el frontend pueda mostrar diff.
  // El cliente puede saltearse el check no enviando `if_match_updated_at` (o
  // enviando `force_overwrite: true`) para hacer last-write-wins explícito.
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

  const validacion = validarYNormalizarPersona(body, 'editar')
  if (!validacion.ok) {
    return respuestaError(ERRORES.VALID_CAMPO_REQUERIDO, { campos: validacion.campos })
  }
  const datos = validacion.datos

  // Si se intenta cambiar tipo_persona y hay pólizas asociadas, bloquear.
  // Cambiar de FÍSICA a JURÍDICA (o viceversa) cuando ya existen pólizas con
  // este asegurado deja inconsistente la naturaleza legal del contrato.
  if (
    body.tipo_persona !== undefined &&
    datos.tipo_persona !== (actual as any).tipo_persona
  ) {
    const { count: polizasAsociadas } = await supabase
      .from('polizas')
      .select('id', { count: 'exact', head: true })
      .eq('asegurado_id', id)
    if (polizasAsociadas && polizasAsociadas > 0) {
      return respuestaError(ERRORES.NEG_OPERACION_INVALIDA, {
        detalle: `No se puede cambiar el tipo de persona porque tiene ${polizasAsociadas} póliza(s) asociada(s).`,
        campos: {
          tipo_persona: `Tiene ${polizasAsociadas} póliza(s) asociada(s) — primero anulalas o transferí el asegurado`,
        },
      })
    }
  }

  // Si cambió el dni_cuil, chequear duplicado con variantes (DNI ⇄ CUIL derivable).
  if (datos.dni_cuil && datos.dni_cuil !== (actual as any).dni_cuil) {
    const variantesDupe = variantesBusquedaIdentificador(datos.dni_cuil, datos.tipo_persona)
    if (variantesDupe.length > 0) {
      const { data: existente } = await supabase
        .from('personas')
        .select('id')
        .in('dni_cuil', variantesDupe)
        .neq('id', id)
        .limit(1)
      if (existente && existente.length > 0) {
        return respuestaError(ERRORES.DB_REGISTRO_DUPLICADO, {
          campos: { dni_cuil: 'Ya existe un cliente con este DNI/CUIT' },
        })
      }
    }
  }

  // Construir payload de update — solo claves presentes en el body (PATCH parcial).
  //
  // NOTA: `estado` NO está en la lista. Se computa automáticamente vía el trigger
  // fn_sincronizar_estado_persona ante cambios en pólizas. Para cambios manuales
  // usar los endpoints dedicados `/api/personas/[id]/bloquear` y `/desbloquear`.
  const payload: Record<string, any> = {}
  const camposPosibles: Array<keyof typeof datos> = [
    'tipo_persona', 'apellido', 'nombre', 'razon_social', 'dni_cuil',
    'fecha_nacimiento',
    'email', 'email_secundario', 'telefono', 'telefono_secundario', 'whatsapp',
    'origen', 'segmento', 'canal_preferido', 'acepta_marketing',
    'calle', 'numero', 'piso_depto', 'barrio', 'localidad', 'provincia',
    'codigo_postal', 'pais',
  ]
  for (const campo of camposPosibles) {
    if (body[campo] !== undefined) {
      payload[campo] = (datos as any)[campo]
    }
  }

  if (Object.keys(payload).length === 0) {
    return respuestaExito({ actualizado: false })
  }

  // Detectar cambios reales comparando con los valores actuales (después de
  // normalización). Si lo único que vino en el body coincide con lo que ya
  // está en la DB, no registramos bitácora de EDICION.
  const camposModificados = Object.keys(payload).filter((k) => {
    const antes = (actual as any)[k]
    const ahora = payload[k]
    // Tratamos null/undefined/'' como equivalentes para evitar falsos cambios.
    const antesNorm = antes === undefined || antes === null || antes === '' ? null : antes
    const ahoraNorm = ahora === undefined || ahora === null || ahora === '' ? null : ahora
    return antesNorm !== ahoraNorm
  })

  if (camposModificados.length === 0) {
    // El payload no aportó cambios reales — devolvemos OK sin update ni bitácora.
    return respuestaExito({ actualizado: false })
  }

  const { error: errUpdate } = await supabase
    .from('personas')
    .update(payload)
    .eq('id', id)

  if (errUpdate) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
      detalle: errUpdate.message,
      contexto: { tabla: 'personas', operacion: 'update', id },
    })
  }

  // Si cambió el estado, registrar CAMBIO_ESTADO en lugar de EDICION genérica.
  if (camposModificados.includes('estado')) {
    await registrarEventoBitacoraPersona(supabase, {
      persona_id: id,
      tipo_evento: 'CAMBIO_ESTADO',
      estado_anterior: (actual as any).estado,
      estado_nuevo: payload.estado,
      campos_modificados: camposModificados,
      usuario_id: usuario.id,
    })
  } else {
    await registrarEventoBitacoraPersona(supabase, {
      persona_id: id,
      tipo_evento: 'EDICION',
      campos_modificados: camposModificados,
      usuario_id: usuario.id,
    })
  }

  return respuestaExito({ actualizado: true, campos_modificados: camposModificados })
}, { modulo: 'personas' })
