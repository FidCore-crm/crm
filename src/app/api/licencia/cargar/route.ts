/**
 * POST /api/licencia/cargar
 *
 * Admin sube un archivo .lic. El backend:
 *   1. Parsea el JSON
 *   2. Verifica firma Ed25519 con la llave pública embebida
 *   3. Verifica que el instalacion_id coincida con este server
 *   4. Determina si va a ACTIVA o ENCOLADA según la fecha de inicio
 *   5. Guarda en la tabla, marca como REEMPLAZADA cualquier otra que pise
 *
 * Reglas:
 *   - Si la licencia ya empezó (fecha_inicio <= hoy) → reemplaza la ACTIVA actual
 *     (queda como REEMPLAZADA) y queda esta como ACTIVA.
 *   - Si la licencia empieza en el futuro (fecha_inicio > hoy) → queda ENCOLADA.
 *   - Si ya existe una ENCOLADA con la misma fecha_inicio, la pisa.
 */

import type { NextRequest } from 'next/server'
import { manejarErrores, respuestaExito, respuestaError, ERRORES, ErrorAplicacion } from '@/lib/errores'
import { requireAdmin } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { verificarLicencia, invalidarCacheEstado, type ArchivoLicencia } from '@/lib/licencia'

export const POST = manejarErrores(async (request: NextRequest) => {
  const auth = await requireAdmin(request)
  if (auth instanceof Response) {
    return respuestaError(ERRORES.PERM_SIN_PERMISO)
  }
  const usuario = auth

  // Aceptamos JSON directo o multipart (archivo)
  const contentType = request.headers.get('content-type') ?? ''

  let archivoData: unknown
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    const file = formData.get('archivo')
    if (!(file instanceof Blob)) {
      throw new ErrorAplicacion(ERRORES.VALID_CAMPO_REQUERIDO, {
        detalle: 'Falta el campo "archivo" (multipart)',
      })
    }
    const texto = await file.text()
    try {
      archivoData = JSON.parse(texto)
    } catch {
      throw new ErrorAplicacion(ERRORES.VALID_FORMATO_INVALIDO, {
        detalle: 'El archivo no es un JSON válido',
      })
    }
  } else {
    try {
      archivoData = await request.json()
    } catch {
      throw new ErrorAplicacion(ERRORES.VALID_FORMATO_INVALIDO, {
        detalle: 'El body no es JSON válido',
      })
    }
  }

  // Verificar firma + instalacion_id
  const verificacion = verificarLicencia(archivoData)
  if (!verificacion.ok || !verificacion.payload) {
    throw new ErrorAplicacion(ERRORES.VALID_FORMATO_INVALIDO, {
      detalle: verificacion.motivo ?? 'Licencia inválida',
    })
  }

  const payload = verificacion.payload
  const lic = archivoData as ArchivoLicencia

  const supabase = getSupabaseAdmin()
  const hoy = new Date().toISOString().slice(0, 10)

  // Determinar estado de la nueva licencia
  const esActivable = payload.fecha_inicio <= hoy
  const yaVencida = payload.plan !== 'PERMANENTE' && payload.fecha_vencimiento < hoy

  if (yaVencida) {
    throw new ErrorAplicacion(ERRORES.NEG_OPERACION_INVALIDA, {
      detalle: `Esta licencia ya venció el ${payload.fecha_vencimiento}. No tiene sentido cargarla.`,
    })
  }

  // Anti-duplicado: chequear si ya cargamos una licencia con la misma firma
  const { data: existentes } = await supabase
    .from('licencias')
    .select('id')
    .eq('firma', lic.firma)
    .limit(1)

  if (existentes && existentes.length > 0) {
    throw new ErrorAplicacion(ERRORES.NEG_OPERACION_INVALIDA, {
      detalle: 'Esta licencia ya está cargada en el sistema.',
    })
  }

  if (esActivable) {
    // Pasa la activa actual a REEMPLAZADA
    await supabase
      .from('licencias')
      .update({ estado: 'REEMPLAZADA' })
      .eq('estado', 'ACTIVA')

    // Insertar como ACTIVA
    const { data: nueva, error } = await supabase
      .from('licencias')
      .insert({
        cliente: payload.cliente,
        razon_social: payload.razon_social,
        instalacion_id: payload.instalacion_id,
        plan: payload.plan,
        fecha_inicio: payload.fecha_inicio,
        fecha_vencimiento: payload.fecha_vencimiento,
        fecha_emision: payload.fecha_emision,
        notas: payload.notas,
        payload_completo: payload,
        firma: lic.firma,
        estado: 'ACTIVA',
        cargada_por_usuario_id: usuario.id,
      })
      .select('id')
      .single()

    if (error) {
      throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
        detalle: error.message,
      })
    }

    invalidarCacheEstado()

    return respuestaExito({
      id: nueva.id,
      estado: 'ACTIVA',
      mensaje: `Licencia ${payload.plan} activada. Vence el ${payload.fecha_vencimiento}.`,
    })
  } else {
    // Insertar como ENCOLADA
    // Si ya hay una encolada con la misma fecha_inicio, la marcamos REEMPLAZADA
    await supabase
      .from('licencias')
      .update({ estado: 'REEMPLAZADA' })
      .eq('estado', 'ENCOLADA')
      .eq('fecha_inicio', payload.fecha_inicio)

    const { data: nueva, error } = await supabase
      .from('licencias')
      .insert({
        cliente: payload.cliente,
        razon_social: payload.razon_social,
        instalacion_id: payload.instalacion_id,
        plan: payload.plan,
        fecha_inicio: payload.fecha_inicio,
        fecha_vencimiento: payload.fecha_vencimiento,
        fecha_emision: payload.fecha_emision,
        notas: payload.notas,
        payload_completo: payload,
        firma: lic.firma,
        estado: 'ENCOLADA',
        cargada_por_usuario_id: usuario.id,
      })
      .select('id')
      .single()

    if (error) {
      throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
        detalle: error.message,
      })
    }

    invalidarCacheEstado()

    return respuestaExito({
      id: nueva.id,
      estado: 'ENCOLADA',
      mensaje: `Licencia ${payload.plan} encolada. Se activa el ${payload.fecha_inicio}.`,
    })
  }
}, { modulo: 'licencia' })
