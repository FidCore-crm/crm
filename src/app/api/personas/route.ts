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
import { validarYNormalizarPersona } from '@/lib/personas-validacion'
import { registrarEventoBitacoraPersona } from '@/lib/bitacora-persona'
import { requireLicenciaActiva } from '@/lib/licencia-guard'
import { variantesBusquedaIdentificador } from '@/lib/identificador-persona'

export const POST = manejarErrores(async (request: NextRequest) => {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)

  await requireLicenciaActiva()

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return respuestaError(ERRORES.VALID_FORMATO_INVALIDO)
  }

  const validacion = validarYNormalizarPersona(body, 'crear')
  if (!validacion.ok) {
    return respuestaError(ERRORES.VALID_CAMPO_REQUERIDO, { campos: validacion.campos })
  }
  const datos = validacion.datos

  const supabase = getSupabaseAdmin()

  // Chequeo de duplicado con variantes: cubre el caso donde ya existe un
  // registro legacy guardado con CUIL en lugar de DNI (o viceversa).
  const variantesDupe = variantesBusquedaIdentificador(datos.dni_cuil, datos.tipo_persona)
  if (variantesDupe.length > 0) {
    const { data: existente } = await supabase
      .from('personas')
      .select('id, usuario_id')
      .in('dni_cuil', variantesDupe)
      .limit(1)

    if (existente && existente.length > 0) {
      // No exponer apellido/nombre del registro ajeno (PII de clientes de otros agentes).
      return respuestaError(ERRORES.DB_REGISTRO_DUPLICADO, {
        campos: { dni_cuil: 'Ya existe un cliente con este DNI/CUIT' },
      })
    }
  }

  // Asignación de owner: si el usuario no tiene acceso total, se autoasigna.
  // Si tiene acceso total (admin o agente con cartera TOTAL), respeta el
  // usuario_id del body si vino, si no se autoasigna.
  let usuario_id: string | null = usuario.id
  if (tieneAccesoTotal(usuario) && body.usuario_id !== undefined) {
    usuario_id = body.usuario_id || null
  }

  const payload: Record<string, any> = {
    ...datos,
    usuario_id,
    fecha_alta: new Date().toISOString(),
  }
  // Limpio campos undefined (de email/email_secundario en modo crear no aplican,
  // pero mantengo la simetría con PATCH).
  for (const k of Object.keys(payload)) {
    if (payload[k] === undefined) delete payload[k]
  }

  const { data: insertada, error } = await supabase
    .from('personas')
    .insert(payload)
    .select('id')
    .single()

  if (error || !insertada) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
      detalle: error?.message,
      contexto: { tabla: 'personas', operacion: 'insert' },
    })
  }

  await registrarEventoBitacoraPersona(supabase, {
    persona_id: (insertada as any).id,
    tipo_evento: 'CREACION',
    estado_nuevo: datos.estado,
    usuario_id: usuario.id,
  })

  return respuestaExito({ id: (insertada as any).id })
}, { modulo: 'personas' })
