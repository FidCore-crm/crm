import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { generarNumeroCaso } from '@/lib/numero-caso'
import { mkdir } from 'fs/promises'
import path from 'path'
import {
  ERRORES,
  respuestaError,
  respuestaExito,
  manejarErrores,
  ErrorAplicacion,
  logger,
} from '@/lib/errores'
import { validarYNormalizarSiniestro } from '@/lib/siniestros-validacion'
import { registrarEventoBitacoraSiniestro } from '@/lib/bitacora-siniestro'
import { requireLicenciaActiva } from '@/lib/licencia-guard'

const STORAGE_ROOT = path.join(process.cwd(), 'storage')

export const POST = manejarErrores(async (request: Request) => {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)

  await requireLicenciaActiva()

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return respuestaError(ERRORES.VALID_FORMATO_INVALIDO)
  }

  const supabase = getSupabaseAdmin()

  // ── Validación de campos requeridos ──────────────────────
  if (!body.persona_id || !body.poliza_id) {
    return respuestaError(ERRORES.VALID_CAMPO_REQUERIDO, {
      campos: {
        ...(body.persona_id ? {} : { persona_id: 'Persona requerida' }),
        ...(body.poliza_id ? {} : { poliza_id: 'Póliza requerida' }),
      },
    })
  }

  // ── Validar y normalizar fechas/montos/datos ─────────────
  const validacion = validarYNormalizarSiniestro(body, 'crear')
  if (!validacion.ok) {
    return respuestaError(ERRORES.VALID_CAMPO_REQUERIDO, { campos: validacion.campos })
  }
  const datos = validacion.datos

  // ── Verificar póliza y que la persona sea su asegurado ───
  const { data: poliza, error: errPoliza } = await supabase
    .from('polizas')
    .select('id, asegurado_id, tomador_id, estado')
    .eq('id', body.poliza_id)
    .single()
  if (errPoliza || !poliza) {
    return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO, {
      campos: { poliza_id: 'Póliza no encontrada' },
    })
  }

  // La persona debe ser el asegurado o el tomador de la póliza.
  const personaIdReq: string = body.persona_id
  const esAsegurado = (poliza as any).asegurado_id === personaIdReq
  const esTomador = (poliza as any).tomador_id === personaIdReq
  if (!esAsegurado && !esTomador) {
    return respuestaError(ERRORES.NEG_OPERACION_INVALIDA, {
      campos: { persona_id: 'La persona no es asegurado ni tomador de esta póliza' },
    })
  }

  // No permitimos siniestros sobre pólizas anuladas.
  if ((poliza as any).estado === 'ANULADA') {
    return respuestaError(ERRORES.NEG_OPERACION_INVALIDA, {
      campos: { poliza_id: 'No se pueden cargar siniestros sobre una póliza anulada' },
    })
  }

  // Si viene riesgo_id, debe pertenecer a esa póliza.
  if (body.riesgo_id) {
    const { data: riesgo } = await supabase
      .from('riesgos')
      .select('id, poliza_id')
      .eq('id', body.riesgo_id)
      .single()
    if (!riesgo || (riesgo as any).poliza_id !== body.poliza_id) {
      return respuestaError(ERRORES.NEG_OPERACION_INVALIDA, {
        campos: { riesgo_id: 'El riesgo no pertenece a esta póliza' },
      })
    }
  }

  // ── Filtro de cartera ────────────────────────────────────
  if (usuario.rol !== 'ADMIN' && usuario.acceso_cartera === 'PROPIA') {
    const { data: persona } = await supabase
      .from('personas')
      .select('usuario_id')
      .eq('id', personaIdReq)
      .single()
    if (persona && (persona as any).usuario_id && (persona as any).usuario_id !== usuario.id) {
      return respuestaError(ERRORES.PERM_RECURSO_AJENO)
    }
  }

  // ── Generar número de caso atómico ───────────────────────
  const numeroCaso = await generarNumeroCaso()

  // ── Insertar siniestro ───────────────────────────────────
  const { data: siniestro, error } = await supabase
    .from('siniestros')
    .insert({
      numero_caso: numeroCaso,
      numero_siniestro: null,
      persona_id: personaIdReq,
      poliza_id: body.poliza_id,
      riesgo_id: body.riesgo_id ?? null,
      fecha_ocurrencia: datos.fecha_ocurrencia ?? null,
      fecha_denuncia: datos.fecha_denuncia,
      tipo_siniestro: datos.tipo_siniestro ?? null,
      estado: 'DENUNCIADO',
      monto_estimado: datos.monto_estimado ?? null,
      descripcion: datos.descripcion,
      detalle_siniestro: datos.detalle_siniestro ?? null,
      hora_siniestro: datos.hora_siniestro ?? null,
      lugar_siniestro: datos.lugar_siniestro ?? null,
      localidad_siniestro: datos.localidad_siniestro ?? null,
      tercero_nombre: datos.tercero_nombre ?? null,
      tercero_dni: datos.tercero_dni ?? null,
      tercero_telefono: datos.tercero_telefono ?? null,
      tercero_patente: datos.tercero_patente ?? null,
    })
    .select('id, numero_caso')
    .single()

  if (error || !siniestro) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
      detalle: error?.message,
      contexto: { tabla: 'siniestros', operacion: 'insert' },
    })
  }

  // ── Crear carpeta en disco (con rollback si falla) ───────
  try {
    const carpeta = path.join(STORAGE_ROOT, 'siniestros', numeroCaso)
    await mkdir(carpeta, { recursive: true })
  } catch (carpetaErr: any) {
    await supabase.from('siniestros').delete().eq('id', siniestro.id)
    logger.error({
      codigo: ERRORES.EXT_STORAGE_NO_DISPONIBLE.codigo,
      modulo: 'siniestros',
      endpoint: '/api/siniestros/crear',
      mensaje: 'No se pudo crear la carpeta del siniestro; registro revertido',
      contexto: { numero_caso: numeroCaso, error: String(carpetaErr?.message || carpetaErr) },
    })
    throw new ErrorAplicacion(ERRORES.EXT_STORAGE_NO_DISPONIBLE, {
      detalle: carpetaErr?.message,
    })
  }

  // ── Registrar evento CREACION en bitácora ────────────────
  await registrarEventoBitacoraSiniestro(supabase, {
    siniestro_id: siniestro.id,
    tipo: 'CREACION',
    estado_nuevo: 'DENUNCIADO',
    usuario_id: usuario.id,
  })

  return respuestaExito({
    siniestro: {
      id: siniestro.id,
      numero_caso: siniestro.numero_caso,
    },
  })
}, { modulo: 'siniestros' })
