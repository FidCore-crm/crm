import { NextResponse } from 'next/server'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { deleteEndosoFolder } from '@/lib/storage-utils'
import {
  ERRORES,
  respuestaError,
  respuestaExito,
  manejarErrores,
  ErrorAplicacion,
} from '@/lib/errores'
import { requireLicenciaActiva } from '@/lib/licencia-guard'

async function cargarEndoso(supabase: any, id: string) {
  const { data } = await supabase
    .from('endosos')
    .select(
      'id, poliza_id, numero_endoso, fecha, motivo, observaciones, created_at, updated_at, polizas:polizas!poliza_id (id, numero_poliza, asegurado:personas!asegurado_id (usuario_id))',
    )
    .eq('id', id)
    .maybeSingle()
  return data
}

export const PATCH = manejarErrores(async (
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
    return respuestaError(ERRORES.VALID_FORMATO_INVALIDO, { detalle: 'Body inválido' })
  }

  const supabase = getSupabaseAdmin()
  const existente = await cargarEndoso(supabase, id)
  if (!existente) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)

  const owns = requireOwnership(usuario, {
    usuario_id: (existente as any).polizas?.asegurado?.usuario_id ?? null,
  })
  if (owns) return owns

  // Optimistic concurrency (#81)
  if (
    body?.if_match_updated_at &&
    !body?.force_overwrite &&
    (existente as any).updated_at &&
    body.if_match_updated_at !== (existente as any).updated_at
  ) {
    return respuestaError(ERRORES.NEG_CONFLICTO_CONCURRENCIA, {
      registro_actual: existente,
    })
  }

  const patch: any = {}
  if (typeof body.motivo === 'string') patch.motivo = body.motivo.trim()
  if (typeof body.fecha === 'string') patch.fecha = body.fecha
  if ('observaciones' in body) {
    patch.observaciones = body.observaciones ? String(body.observaciones).trim() : null
  }
  if (typeof body.numero_endoso === 'number' && body.numero_endoso > 0) {
    patch.numero_endoso = Math.floor(body.numero_endoso)
  }

  if (Object.keys(patch).length === 0) {
    return respuestaError(ERRORES.VALID_CAMPO_REQUERIDO, {
      detalle: 'Nada para actualizar',
    })
  }

  const { data: actualizado, error } = await supabase
    .from('endosos')
    .update(patch)
    .eq('id', id)
    .select('id, numero_endoso, fecha, motivo, observaciones, created_at')
    .single()

  if (error) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
      detalle: error.message,
      contexto: { tabla: 'endosos', operacion: 'update', id },
    })
  }

  return respuestaExito({ endoso: actualizado })
}, { modulo: 'endosos' })

export const DELETE = manejarErrores(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  await requireLicenciaActiva()

  const { id } = await params
  const supabase = getSupabaseAdmin()
  const existente = await cargarEndoso(supabase, id)
  if (!existente) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)

  const owns = requireOwnership(usuario, {
    usuario_id: (existente as any).polizas?.asegurado?.usuario_id ?? null,
  })
  if (owns) return owns

  const numeroPoliza = (existente as any).polizas?.numero_poliza

  if (numeroPoliza) {
    try {
      await deleteEndosoFolder(numeroPoliza, id)
    } catch {
      // No bloqueante
    }
  }

  const { error } = await supabase.from('endosos').delete().eq('id', id)
  if (error) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
      detalle: error.message,
      contexto: { tabla: 'endosos', operacion: 'delete', id },
    })
  }

  return respuestaExito({ ok: true })
}, { modulo: 'endosos' })
