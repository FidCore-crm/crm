import { NextResponse } from 'next/server'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { ensureEndosoFolder } from '@/lib/storage-utils'
import {
  ERRORES,
  respuestaError,
  respuestaExito,
  manejarErrores,
  ErrorAplicacion,
  logger,
} from '@/lib/errores'
import { requireLicenciaActiva } from '@/lib/licencia-guard'

export const POST = manejarErrores(async (request: Request) => {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  await requireLicenciaActiva()

  let body: any
  try {
    body = await request.json()
  } catch {
    return respuestaError(ERRORES.VALID_FORMATO_INVALIDO, { detalle: 'Body inválido' })
  }

  const polizaId: string | undefined = body?.poliza_id
  const motivo: string = (body?.motivo || '').toString().trim()
  const fecha: string = (body?.fecha || '').toString().trim()
  const observaciones: string | null = body?.observaciones
    ? String(body.observaciones).trim()
    : null
  const numeroEndosoManual: number | undefined = body?.numero_endoso

  if (!polizaId || !motivo || !fecha) {
    return respuestaError(ERRORES.VALID_CAMPO_REQUERIDO, {
      campos: {
        ...(polizaId ? {} : { poliza_id: 'requerido' }),
        ...(motivo ? {} : { motivo: 'requerido' }),
        ...(fecha ? {} : { fecha: 'requerido' }),
      },
    })
  }

  const supabase = getSupabaseAdmin()

  const { data: poliza } = await supabase
    .from('polizas')
    .select('id, numero_poliza, asegurado:personas!asegurado_id (usuario_id)')
    .eq('id', polizaId)
    .maybeSingle()

  if (!poliza) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)

  const owns = requireOwnership(usuario, {
    usuario_id: (poliza as any).asegurado?.usuario_id ?? null,
  })
  if (owns) return owns

  // Resolución atómica del próximo numero_endoso.
  // - Si vino numero_endoso manual: lo respetamos. La constraint
  //   UNIQUE(poliza_id, numero_endoso) se encarga de rechazar duplicados.
  // - Si no, llamamos a generar_numero_endoso(poliza_id) que toma un lock
  //   pesimista sobre la póliza y devuelve max+1, evitando race conditions.
  let numero = numeroEndosoManual
  if (!numero || numero < 1) {
    const { data: numData, error: numErr } = await (supabase as any)
      .rpc('generar_numero_endoso', { p_poliza_id: polizaId })
    if (numErr || numData === null || numData === undefined) {
      throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
        detalle: numErr?.message ?? 'No se pudo generar el número de endoso',
        contexto: { tabla: 'endosos', operacion: 'generar_numero_endoso', poliza_id: polizaId },
      })
    }
    numero = Number(numData)
  }

  const { data: creado, error } = await supabase
    .from('endosos')
    .insert({
      poliza_id: polizaId,
      numero_endoso: numero,
      fecha,
      motivo,
      observaciones,
    } as any)
    .select('id, numero_endoso, fecha, motivo, observaciones, created_at')
    .single()

  if (error || !creado) {
    // 23505 → violación del UNIQUE compuesto. Mensaje claro al PAS.
    if ((error as any)?.code === '23505') {
      return respuestaError(ERRORES.NEG_OPERACION_INVALIDA, {
        detalle: `Ya existe un endoso N° ${numero} para esta póliza. Reintentá.`,
      })
    }
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
      detalle: error?.message,
      contexto: { tabla: 'endosos', operacion: 'insert' },
    })
  }

  try {
    await ensureEndosoFolder((poliza as any).numero_poliza, (creado as any).id)
  } catch (err) {
    logger.warn({
      modulo: 'endosos',
      endpoint: '/api/endosos',
      mensaje: 'No se pudo crear carpeta del endoso (no bloqueante)',
      contexto: {
        numero_poliza: (poliza as any).numero_poliza,
        endoso_id: (creado as any).id,
        error: err instanceof Error ? err.message : String(err),
      },
    })
  }

  return respuestaExito({ endoso: creado })
}, { modulo: 'endosos' })
