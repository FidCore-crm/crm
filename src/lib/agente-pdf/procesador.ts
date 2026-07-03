// ============================================================
// Procesador async — corre fire-and-forget al iniciar una carga
// de PDF. Lee el archivo, llama a la IA, mapea catálogos, valida,
// y deja la fila de pdf_procesamientos en estado EXTRAIDO listo
// para la revisión del PAS.
// ============================================================

import path from 'path'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { encolarEmailSistema } from '@/lib/comunicaciones-sender'
import { extraerDatosDePDF, compararPolizasConIA } from './extractor'
import { mapearCatalogos } from './mapeador-catalogos'
import { validarDatosExtraidosPoliza, validarDatosExtraidosEndoso } from './validador'
import { notificarPDF } from './notificaciones-helper'
import { logger } from '@/lib/errores'

const STORAGE_ROOT =
  process.env.NEXT_STORAGE_PATH ||
  process.env.STORAGE_ROOT ||
  path.join(process.cwd(), 'storage')
import type {
  DatosExtraidosPoliza,
  DatosExtraidosEndoso,
  TipoOperacionPDF,
  MapeosCatalogos,
  CampoDudoso,
} from './types'

/**
 * Error interno para señalar que el procesamiento fue cancelado por el PAS
 * mientras corríamos. Se atrapa específicamente en el catch principal para
 * salir silenciosamente sin marcar FALLIDO ni notificar.
 */
class ProcesamientoCanceladoError extends Error {
  constructor() {
    super('Procesamiento cancelado por el usuario')
    this.name = 'ProcesamientoCanceladoError'
  }
}

async function cargarContextoPolizaOrigen(
  supabase: any,
  polizaOrigenId: string
): Promise<{
  descripcion: string
  dni_cuil?: string
  numero?: string
} | null> {
  const { data } = await supabase
    .from('polizas')
    .select('id, numero_poliza, fecha_inicio, fecha_fin, asegurado:personas!asegurado_id (dni_cuil, apellido, nombre, razon_social)')
    .eq('id', polizaOrigenId)
    .maybeSingle()

  if (!data) return null
  const aseg = (data as any).asegurado || {}
  const nombre = aseg.razon_social || [aseg.apellido, aseg.nombre].filter(Boolean).join(', ')
  const descripcion = `Póliza ${(data as any).numero_poliza} — asegurado ${nombre} (DNI/CUIT ${aseg.dni_cuil || 's/d'}), vigencia ${(data as any).fecha_inicio} → ${(data as any).fecha_fin}`

  return {
    descripcion,
    dni_cuil: aseg.dni_cuil,
    numero: (data as any).numero_poliza,
  }
}

/**
 * Actualiza el estado filtrando por los estados previos aceptables. Si la fila
 * fue cancelada (o movida) por otro proceso entre medio, el update no toca nada
 * y tiramos `ProcesamientoCanceladoError` para que el caller aborte limpio.
 */
async function transicionarEstado(
  supabase: any,
  procesamientoId: string,
  estadosPermitidos: string[],
  patch: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await supabase
    .from('pdf_procesamientos')
    .update(patch as any)
    .eq('id', procesamientoId)
    .in('estado', estadosPermitidos)
    .select('id')

  if (error) throw new Error(`No se pudo actualizar estado: ${error.message}`)
  if (!data || (data as unknown[]).length === 0) {
    throw new ProcesamientoCanceladoError()
  }
}

async function estadoActual(
  supabase: any,
  procesamientoId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('pdf_procesamientos')
    .select('estado')
    .eq('id', procesamientoId)
    .maybeSingle()
  return (data as any)?.estado ?? null
}

export async function procesarPDFAsync(procesamientoId: string): Promise<void> {
  const supabase = getSupabaseAdmin()

  // Timing por etapa. Loguear al final para poder medir cuánto se va en IA
  // vs pre/post (mapeo, validación, DB). Sin esto optimizar es a ciegas.
  const timings: Record<string, number> = {}
  const inicioTotal = Date.now()

  try {
    // 1. Marcar como procesando — sólo si estaba PENDIENTE.
    // Si /cancelar ya lo movió a CANCELADO, el update no toca nada y salimos.
    await transicionarEstado(
      supabase,
      procesamientoId,
      ['PENDIENTE'],
      { estado: 'PROCESANDO' },
    )

    // 2. Cargar procesamiento
    const { data: proc } = await supabase
      .from('pdf_procesamientos')
      .select('id, estado, tipo_operacion, poliza_origen_id, ruta_temporal, nombre_archivo, usuario_id')
      .eq('id', procesamientoId)
      .maybeSingle()

    if (!proc) throw new Error('Procesamiento no encontrado')
    // Puede haber sido cancelado entre el UPDATE de arriba y esta lectura.
    if ((proc as any).estado !== 'PROCESANDO') {
      throw new ProcesamientoCanceladoError()
    }

    const tipoOperacion = (proc as any).tipo_operacion as TipoOperacionPDF
    const rutaPDF = (proc as any).ruta_temporal as string
    const polizaOrigenId = (proc as any).poliza_origen_id as string | null
    const usuarioId = (proc as any).usuario_id as string | null
    const nombreArchivo = (proc as any).nombre_archivo as string

    // 3. Cargar contexto si hay póliza origen
    let contexto: { descripcion: string; dni_cuil?: string; numero?: string } | null = null
    if (polizaOrigenId) {
      contexto = await cargarContextoPolizaOrigen(supabase, polizaOrigenId)
    }

    // 4. Llamar a la IA. Para RENOVACION arrancamos en paralelo la comparación
    // con el PDF de la póliza anterior (si hay archivo principal marcado en la
    // póliza origen). Así ambas terminan al mismo tiempo y el PAS ve el
    // análisis en la pantalla de revisión sin sumar espera.
    const tIA = Date.now()

    let promComparacion: Promise<{
      poliza_origen_id: string
      archivo_viejo_id: string
      estado: 'COMPLETADA' | 'FALLIDA'
      cambios?: unknown[]
      resumen?: string
      error?: string | null
      tokens_usados?: number
      costo_usd?: number
      duracion_ms?: number
    } | null> | null = null

    if (tipoOperacion === 'RENOVACION' && polizaOrigenId) {
      const inicioCmp = Date.now()
      promComparacion = (async () => {
        try {
          const { data: principalRow } = await supabase
            .from('poliza_archivos')
            .select('id, ruta')
            .eq('poliza_id', polizaOrigenId)
            .eq('es_poliza_principal', true)
            .limit(1)
            .maybeSingle()

          if (!principalRow) {
            // Sin PDF principal en la póliza origen → no hay con qué comparar.
            // La pantalla de revisión mostrará opción para elegir manualmente.
            return null
          }

          const rutaViejaAbs = path.resolve(STORAGE_ROOT, (principalRow as { ruta: string }).ruta)
          if (!rutaViejaAbs.startsWith(STORAGE_ROOT)) return null

          const resultado = await compararPolizasConIA(rutaViejaAbs, rutaPDF)
          if (!resultado.ok) {
            return {
              poliza_origen_id: polizaOrigenId,
              archivo_viejo_id: (principalRow as { id: string }).id,
              estado: 'FALLIDA' as const,
              error: resultado.error || 'Falló la comparación',
              duracion_ms: Date.now() - inicioCmp,
            }
          }
          return {
            poliza_origen_id: polizaOrigenId,
            archivo_viejo_id: (principalRow as { id: string }).id,
            estado: 'COMPLETADA' as const,
            cambios: resultado.cambios || [],
            resumen: resultado.resumen || '',
            tokens_usados: resultado.tokens_total,
            costo_usd: resultado.costo_usd,
            duracion_ms: Date.now() - inicioCmp,
          }
        } catch (err: any) {
          logger.warn({
            modulo: 'agente-pdf',
            mensaje: 'Comparación paralela falló (no bloquea el procesamiento)',
            contexto: { procesamiento_id: procesamientoId, error: String(err?.message || err) },
          })
          return null
        }
      })()
    }

    const [extraccion, comparacion] = await Promise.all([
      extraerDatosDePDF(rutaPDF, tipoOperacion, {
        poliza_origen_descripcion: contexto?.descripcion,
      }),
      promComparacion ?? Promise.resolve(null),
    ])
    timings.ms_ia = Date.now() - tIA

    // Re-chequear cancelación después de la llamada cara a la IA: si el PAS
    // canceló mientras esperábamos a Claude, no queremos pisar el estado
    // CANCELADO con EXTRAIDO.
    if ((await estadoActual(supabase, procesamientoId)) !== 'PROCESANDO') {
      throw new ProcesamientoCanceladoError()
    }

    if (!extraccion.ok || !extraccion.datos) {
      throw new Error(extraccion.error || 'La IA no pudo extraer datos del PDF')
    }

    // 5. Mapear catálogos + validar
    const tMapeo = Date.now()
    let mapeos: MapeosCatalogos | null = null
    let dudosos: CampoDudoso[] = []

    if (tipoOperacion === 'ENDOSO') {
      dudosos = validarDatosExtraidosEndoso(extraccion.datos as DatosExtraidosEndoso)
    } else {
      mapeos = await mapearCatalogos(extraccion.datos as DatosExtraidosPoliza)
      dudosos = validarDatosExtraidosPoliza(
        extraccion.datos as DatosExtraidosPoliza,
        mapeos,
        tipoOperacion,
        contexto
          ? { poliza_origen_dni_cuil: contexto.dni_cuil, poliza_origen_numero: contexto.numero }
          : undefined
      )
    }
    timings.ms_mapeo_validacion = Date.now() - tMapeo

    // 6. Guardar todo, pero sólo si seguimos siendo los dueños del estado.
    // Si /cancelar nos ganó la carrera, el update no toca nada.
    // Si corrió la comparación paralela, adjuntamos su resultado y sumamos
    // los tokens al total.
    const comparacionResultado = comparacion
      ? { ...comparacion, creado_en: new Date().toISOString() }
      : null
    const tokensExtra = (comparacion?.tokens_usados as number) || 0
    const costoExtra = (comparacion?.costo_usd as number) || 0

    await transicionarEstado(
      supabase,
      procesamientoId,
      ['PROCESANDO'],
      {
        estado: 'EXTRAIDO',
        datos_extraidos: extraccion.datos as any,
        mapeos_catalogos: mapeos as any,
        campos_dudosos: dudosos as any,
        tokens_usados: extraccion.tokens_total + tokensExtra,
        costo_estimado: extraccion.costo_usd + costoExtra,
        comparacion_resultado: comparacionResultado,
      },
    )

    timings.ms_total = Date.now() - inicioTotal
    logger.info({
      modulo: 'agente-pdf',
      mensaje: 'Procesamiento PDF completado',
      contexto: {
        procesamiento_id: procesamientoId,
        tipo_operacion: tipoOperacion,
        ms_total: timings.ms_total,
        ms_ia: timings.ms_ia,
        ms_mapeo_validacion: timings.ms_mapeo_validacion,
        ms_otros: timings.ms_total - (timings.ms_ia || 0) - (timings.ms_mapeo_validacion || 0),
        dudosos: dudosos.length,
      },
    })

    // 7. Notificar al PAS
    const urlRevisar = `/crm/agente-pdf/${procesamientoId}` // pantalla del Paso 2
    await notificarPDF({
      procesamiento_id: procesamientoId,
      tipo: 'PDF_LISTO_PARA_REVISAR',
      titulo: 'PDF listo para revisar',
      mensaje:
        dudosos.length > 0
          ? `El PDF se procesó con ${dudosos.length} campo${dudosos.length !== 1 ? 's' : ''} a revisar`
          : 'El PDF se procesó sin dudosos — listo para aprobar',
      usuario_id: usuarioId,
      url: urlRevisar,
      prioridad: 'ADVERTENCIA',
    })

    // Notificación por email al admin (además de la notificación in-app).
    // Errores de notificación no deben propagar: la extracción fue OK.
    try {
      const { obtenerUrlCRM } = await import('@/lib/urls-publicas')
      const urlBase = (await obtenerUrlCRM()) || ''
      await encolarEmailSistema({
        tipo_evento: 'PDF_PROCESADO',
        variables_extra: {
          nombre_pdf: nombreArchivo || 'archivo',
          tipo_operacion: tipoOperacion,
          fecha_procesamiento: new Date().toLocaleString('es-AR'),
          url_revision: `${urlBase}${urlRevisar}`,
        },
      })
    } catch (err) {
      logger.warn({
        modulo: 'agente-pdf',
        mensaje: 'No se pudo encolar email de sistema PDF_PROCESADO',
        contexto: { procesamiento_id: procesamientoId, error: String(err) },
      })
    }
  } catch (err: any) {
    // Salida silenciosa si el PAS canceló — ya está en estado CANCELADO y
    // /cancelar limpió el archivo temporal.
    if (err instanceof ProcesamientoCanceladoError) {
      logger.info({
        modulo: 'agente-pdf',
        mensaje: 'Procesamiento cancelado por el usuario durante el async',
        contexto: { procesamiento_id: procesamientoId },
      })
      return
    }

    const mensaje = err?.message || 'Error desconocido al procesar el PDF'
    const supabaseErr = getSupabaseAdmin()

    // Sólo marcar FALLIDO si seguimos en PROCESANDO o PENDIENTE — nunca pisar
    // un CANCELADO o APROBADO.
    const { data: updatedFail } = await (supabaseErr
      .from('pdf_procesamientos') as any)
      .update({ estado: 'FALLIDO', error_mensaje: mensaje })
      .eq('id', procesamientoId)
      .in('estado', ['PENDIENTE', 'PROCESANDO'])
      .select('id')

    // Si el update no tocó nada (p.ej., quedó CANCELADO), no hay nada que notificar.
    if (!updatedFail || (updatedFail as unknown[]).length === 0) return

    const { data: proc } = await supabaseErr
      .from('pdf_procesamientos')
      .select('usuario_id, nombre_archivo, tipo_operacion')
      .eq('id', procesamientoId)
      .maybeSingle()

    try {
      await notificarPDF({
        procesamiento_id: procesamientoId,
        tipo: 'PDF_FALLIDO',
        titulo: 'El procesamiento del PDF falló',
        mensaje,
        usuario_id: ((proc as any)?.usuario_id || null) as string | null,
        prioridad: 'CRITICA',
      })
    } catch (notifErr) {
      logger.warn({
        modulo: 'agente-pdf',
        mensaje: 'No se pudo notificar al PAS del fallo del PDF',
        contexto: { procesamiento_id: procesamientoId, error: String(notifErr) },
      })
    }

    try {
      await encolarEmailSistema({
        tipo_evento: 'PDF_FALLIDO',
        variables_extra: {
          nombre_pdf: ((proc as any)?.nombre_archivo as string) || 'archivo',
          tipo_operacion: ((proc as any)?.tipo_operacion as string) || 'desconocida',
          error_mensaje: mensaje,
        },
      })
    } catch (emailErr) {
      logger.warn({
        modulo: 'agente-pdf',
        mensaje: 'No se pudo encolar email de sistema PDF_FALLIDO',
        contexto: { procesamiento_id: procesamientoId, error: String(emailErr) },
      })
    }
  }
}
