import { NextResponse } from 'next/server'
import path from 'path'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { compararPolizasConIA } from '@/lib/agente-pdf/extractor'
import { obtenerCatalogoCoberturasCompania } from '@/lib/agente-pdf/catalogo-coberturas-compania'
import { checkLicenciaActiva } from '@/lib/licencia-guard'
import { logger } from '@/lib/errores'

const STORAGE_ROOT =
  process.env.NEXT_STORAGE_PATH ||
  process.env.STORAGE_ROOT ||
  path.join(process.cwd(), 'storage')

/**
 * Comparación IA disparada manualmente desde la pantalla de revisión del
 * wizard. Se usa cuando la póliza origen no tiene ningún archivo marcado como
 * es_poliza_principal (típicamente pólizas legacy cargadas a mano). El PAS
 * elige cuál PDF de la póliza origen usar como referencia.
 *
 * Body: { archivo_viejo_id: string }
 *
 * Efectos:
 *  1. Marca el archivo elegido como es_poliza_principal en la póliza origen,
 *     para que futuras renovaciones lo tomen automáticamente.
 *  2. Corre compararPolizasConIA de forma síncrona (el frontend espera con
 *     spinner).
 *  3. Guarda el resultado en pdf_procesamientos.comparacion_resultado — mismo
 *     lugar donde vive el resultado de la comparación paralela.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo

  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  const { id } = await params
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 })
  }

  const archivoViejoId = typeof body?.archivo_viejo_id === 'string' ? body.archivo_viejo_id : null
  if (!archivoViejoId) {
    return NextResponse.json({ ok: false, error: 'Falta archivo_viejo_id' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // 1. Validar procesamiento
  const { data: proc } = await supabase
    .from('pdf_procesamientos')
    .select('id, tipo_operacion, poliza_origen_id, estado, ruta_temporal, usuario_id')
    .eq('id', id)
    .maybeSingle()

  if (!proc) {
    return NextResponse.json({ ok: false, error: 'Procesamiento no encontrado' }, { status: 404 })
  }

  const owns = requireOwnership(usuario, { usuario_id: (proc as any).usuario_id })
  if (owns) return owns

  if ((proc as any).tipo_operacion !== 'RENOVACION') {
    return NextResponse.json({ ok: false, error: 'Sólo aplica a renovaciones' }, { status: 400 })
  }

  const polizaOrigenId = (proc as any).poliza_origen_id as string | null
  if (!polizaOrigenId) {
    return NextResponse.json({ ok: false, error: 'La renovación no tiene póliza origen' }, { status: 400 })
  }

  // 2. Validar que el archivo pertenezca a la póliza origen
  const { data: archivoViejo } = await supabase
    .from('poliza_archivos')
    .select('id, poliza_id, ruta')
    .eq('id', archivoViejoId)
    .maybeSingle()

  if (!archivoViejo || (archivoViejo as any).poliza_id !== polizaOrigenId) {
    return NextResponse.json({ ok: false, error: 'El archivo elegido no pertenece a la póliza anterior' }, { status: 400 })
  }

  const rutaViejaAbs = path.resolve(STORAGE_ROOT, (archivoViejo as { ruta: string }).ruta)
  if (!rutaViejaAbs.startsWith(STORAGE_ROOT)) {
    return NextResponse.json({ ok: false, error: 'Ruta inválida' }, { status: 400 })
  }

  const rutaPDFNuevo = (proc as any).ruta_temporal as string
  if (!rutaPDFNuevo) {
    return NextResponse.json({ ok: false, error: 'No hay PDF nuevo para comparar' }, { status: 400 })
  }

  // 3. Marcar el archivo elegido como principal para futuras renovaciones.
  //    Primero desmarcamos cualquier otro principal previo en la póliza origen.
  try {
    await supabase
      .from('poliza_archivos')
      .update({ es_poliza_principal: false } as any)
      .eq('poliza_id', polizaOrigenId)
      .eq('es_poliza_principal', true)

    await supabase
      .from('poliza_archivos')
      .update({ es_poliza_principal: true } as any)
      .eq('id', archivoViejoId)
  } catch (err) {
    logger.warn({
      modulo: 'agente-pdf',
      mensaje: 'No se pudo marcar archivo como principal',
      contexto: { archivo_id: archivoViejoId, error: String(err) },
    })
  }

  // 4. Cargamos el catálogo de equivalencias de coberturas para la compañía
  //    de la póliza origen. La IA lo usa para resolver códigos comerciales
  //    (ej: "CF") a nombres canónicos ("Terceros Completo") sin inventar.
  const { data: polOrigen } = await supabase
    .from('polizas').select('compania_id').eq('id', polizaOrigenId).maybeSingle()
  const catalogo = await obtenerCatalogoCoberturasCompania(
    supabase,
    (polOrigen as { compania_id?: string } | null)?.compania_id ?? null,
  )

  // 5. Correr la comparación sincrónicamente. El frontend espera.
  const inicio = Date.now()
  const resultado = await compararPolizasConIA(rutaViejaAbs, rutaPDFNuevo, {
    companiaNombre: catalogo.companiaNombre,
    catalogoCoberturas: catalogo.equivalencias,
  })

  const comparacionResultado = resultado.ok
    ? {
        poliza_origen_id: polizaOrigenId,
        archivo_viejo_id: archivoViejoId,
        estado: 'COMPLETADA' as const,
        cambios: resultado.cambios || [],
        resumen: resultado.resumen || '',
        tokens_usados: resultado.tokens_total,
        costo_usd: resultado.costo_usd,
        duracion_ms: Date.now() - inicio,
        creado_en: new Date(inicio).toISOString(),
        completado_en: new Date().toISOString(),
        modo: resultado.modo || 'pdf_nativo',
      }
    : {
        poliza_origen_id: polizaOrigenId,
        archivo_viejo_id: archivoViejoId,
        estado: 'FALLIDA' as const,
        error: resultado.error || 'Error desconocido',
        duracion_ms: Date.now() - inicio,
        creado_en: new Date(inicio).toISOString(),
        completado_en: new Date().toISOString(),
        modo: resultado.modo || 'pdf_nativo',
      }

  await supabase
    .from('pdf_procesamientos')
    .update({ comparacion_resultado: comparacionResultado } as any)
    .eq('id', id)

  // Si la IA falló, devolver 500 con el error real en el payload en formato
  // estándar para que apiCall() del cliente pueda extraerlo. Antes se devolvía
  // { ok: false, comparacion: {...} } con status 200 — el cliente caía en el
  // fallback y mostraba "Error HTTP 200" al PAS sin la causa real.
  if (!resultado.ok) {
    const mensajeError = resultado.error || 'La comparación con IA falló'
    logger.error({
      modulo: 'agente-pdf',
      mensaje: 'Falló la comparación manual con IA',
      contexto: { procesamiento_id: id, archivo_viejo_id: archivoViejoId, error: mensajeError },
    })
    return NextResponse.json(
      {
        ok: false,
        error: {
          codigo: 'ERR_EXT_001',
          mensaje: mensajeError,
        },
        comparacion: comparacionResultado,
      },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, data: { comparacion: comparacionResultado } })
}
