// ============================================================
// Comparador de renovaciones — dispara comparación IA fire-and-forget
// después de que el PAS aprueba una renovación con PDF.
//
// Escribe el estado en polizas.comparacion_ia (JSONB) y notifica al PAS
// cuando termina. No bloquea el flujo de aprobación.
// ============================================================

import path from 'path'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { compararPolizasConIA } from './extractor'
import { logger } from '@/lib/errores'

const STORAGE_ROOT =
  process.env.NEXT_STORAGE_PATH ||
  process.env.STORAGE_ROOT ||
  path.join(process.cwd(), 'storage')

export interface EstadoComparacion {
  poliza_origen_id: string
  archivo_viejo_id: string
  archivo_nuevo_id: string
  estado: 'PROCESANDO' | 'COMPLETADA' | 'FALLIDA'
  cambios?: unknown[]
  resumen?: string
  error?: string | null
  tokens_usados?: number
  costo_usd?: number
  duracion_ms?: number
  creado_en: string
  completado_en?: string
}

/**
 * Dispara la comparación IA en background. Devuelve inmediatamente después
 * de escribir el estado PROCESANDO. El resultado final se guarda cuando la
 * IA termina.
 *
 * IMPORTANTE: fire-and-forget. El error interno NO se propaga al caller —
 * se guarda como FALLIDA en la póliza y se notifica al PAS.
 */
export async function iniciarComparacionEnBackground(params: {
  poliza_nueva_id: string
  poliza_origen_id: string
  archivo_viejo_id: string
  archivo_nuevo_id: string
  usuario_id?: string | null
}): Promise<void> {
  const { poliza_nueva_id, poliza_origen_id, archivo_viejo_id, archivo_nuevo_id, usuario_id } = params
  const supabase = getSupabaseAdmin()

  const estadoInicial: EstadoComparacion = {
    poliza_origen_id,
    archivo_viejo_id,
    archivo_nuevo_id,
    estado: 'PROCESANDO',
    creado_en: new Date().toISOString(),
  }

  // Guardar estado PROCESANDO. Si esto falla, ni siquiera arrancamos.
  const { error: errPre } = await supabase
    .from('polizas')
    .update({ comparacion_ia: estadoInicial as any } as any)
    .eq('id', poliza_nueva_id)

  if (errPre) {
    logger.error({
      modulo: 'agente-pdf',
      mensaje: 'No se pudo marcar comparación como PROCESANDO',
      contexto: { poliza_nueva_id, error: errPre.message },
    })
    return
  }

  // Fire-and-forget: no await del setImmediate para que el caller siga
  // procesando el response HTTP inmediatamente.
  setImmediate(() => {
    void ejecutarComparacion({ poliza_nueva_id, poliza_origen_id, archivo_viejo_id, archivo_nuevo_id, usuario_id })
  })
}

async function ejecutarComparacion(params: {
  poliza_nueva_id: string
  poliza_origen_id: string
  archivo_viejo_id: string
  archivo_nuevo_id: string
  usuario_id?: string | null
}): Promise<void> {
  const { poliza_nueva_id, poliza_origen_id, archivo_viejo_id, archivo_nuevo_id, usuario_id } = params
  const supabase = getSupabaseAdmin()
  const inicio = Date.now()

  try {
    // 1. Cargar rutas de ambos archivos
    const { data: archivos } = await supabase
      .from('poliza_archivos')
      .select('id, ruta, nombre')
      .in('id', [archivo_viejo_id, archivo_nuevo_id])

    const filas = (archivos || []) as Array<{ id: string; ruta: string; nombre: string }>
    const archivoViejo = filas.find(a => a.id === archivo_viejo_id)
    const archivoNuevo = filas.find(a => a.id === archivo_nuevo_id)

    if (!archivoViejo || !archivoNuevo) {
      throw new Error('No se encontraron los archivos para comparar')
    }

    // Validación de rutas (defensa contra path traversal — no debería
    // pasar porque las rutas vienen de la DB, pero es red de seguridad).
    const rutaViejaAbs = path.resolve(STORAGE_ROOT, archivoViejo.ruta)
    const rutaNuevaAbs = path.resolve(STORAGE_ROOT, archivoNuevo.ruta)
    if (!rutaViejaAbs.startsWith(STORAGE_ROOT) || !rutaNuevaAbs.startsWith(STORAGE_ROOT)) {
      throw new Error('Ruta de archivo inválida')
    }

    // 2. Llamar al comparador IA
    const resultado = await compararPolizasConIA(rutaViejaAbs, rutaNuevaAbs)

    if (!resultado.ok) {
      throw new Error(resultado.error || 'La IA no pudo comparar los PDFs')
    }

    // 3. Guardar resultado COMPLETADA
    const estadoFinal: EstadoComparacion = {
      poliza_origen_id,
      archivo_viejo_id,
      archivo_nuevo_id,
      estado: 'COMPLETADA',
      cambios: resultado.cambios || [],
      resumen: resultado.resumen || '',
      error: null,
      tokens_usados: resultado.tokens_total,
      costo_usd: resultado.costo_usd,
      duracion_ms: Date.now() - inicio,
      creado_en: new Date(inicio).toISOString(),
      completado_en: new Date().toISOString(),
    }

    await supabase
      .from('polizas')
      .update({ comparacion_ia: estadoFinal as any } as any)
      .eq('id', poliza_nueva_id)

    const cambiosMateriales = (resultado.cambios || []).filter(c => c.tipo === 'material').length

    logger.info({
      modulo: 'agente-pdf',
      mensaje: 'Comparación de renovación completada',
      contexto: {
        poliza_nueva_id,
        cambios_totales: resultado.cambios?.length ?? 0,
        cambios_materiales: cambiosMateriales,
        duracion_ms: Date.now() - inicio,
        tokens: resultado.tokens_total,
      },
    })

    // 4. Notificar al PAS
    await notificarComparacionCompletada({
      poliza_nueva_id,
      cambios_materiales: cambiosMateriales,
      cambios_totales: resultado.cambios?.length ?? 0,
      usuario_id,
    })
  } catch (err: any) {
    const mensaje = err?.message || 'Error desconocido comparando renovación'
    logger.error({
      modulo: 'agente-pdf',
      mensaje: 'Falló la comparación de renovación',
      contexto: { poliza_nueva_id, error: mensaje },
    })

    const estadoFallo: EstadoComparacion = {
      poliza_origen_id,
      archivo_viejo_id,
      archivo_nuevo_id,
      estado: 'FALLIDA',
      error: mensaje,
      duracion_ms: Date.now() - inicio,
      creado_en: new Date(inicio).toISOString(),
      completado_en: new Date().toISOString(),
    }

    try {
      await supabase
        .from('polizas')
        .update({ comparacion_ia: estadoFallo as any } as any)
        .eq('id', poliza_nueva_id)
    } catch (updErr) {
      logger.warn({
        modulo: 'agente-pdf',
        mensaje: 'No se pudo marcar comparación como FALLIDA',
        contexto: { poliza_nueva_id, error: String(updErr) },
      })
    }

    try {
      await notificarComparacionFallida({ poliza_nueva_id, error: mensaje, usuario_id })
    } catch (notifErr) {
      logger.warn({
        modulo: 'agente-pdf',
        mensaje: 'No se pudo notificar fallo de comparación',
        contexto: { poliza_nueva_id, error: String(notifErr) },
      })
    }
  }
}

async function notificarComparacionCompletada(params: {
  poliza_nueva_id: string
  cambios_materiales: number
  cambios_totales: number
  usuario_id?: string | null
}): Promise<void> {
  const supabase = getSupabaseAdmin()
  const { poliza_nueva_id, cambios_materiales, cambios_totales, usuario_id } = params

  const mensaje =
    cambios_materiales === 0
      ? 'Se completó el análisis de la renovación. No se detectaron cambios materiales.'
      : `Se detectaron ${cambios_materiales} cambio${cambios_materiales !== 1 ? 's' : ''} material${cambios_materiales !== 1 ? 'es' : ''} en la renovación (de ${cambios_totales} total${cambios_totales !== 1 ? 'es' : ''}).`

  const prioridad = cambios_materiales > 0 ? 'ADVERTENCIA' : 'INFORMATIVA'

  await supabase.from('notificaciones').insert({
    usuario_id: usuario_id || null,
    tipo: 'RENOVACION_COMPARACION_LISTA',
    titulo: 'Análisis de renovación listo',
    mensaje,
    entidad_tipo: 'poliza',
    entidad_id: poliza_nueva_id,
    url: `/crm/polizas/${poliza_nueva_id}#comparacion-ia`,
    prioridad,
    leida: false,
  } as any)
}

async function notificarComparacionFallida(params: {
  poliza_nueva_id: string
  error: string
  usuario_id?: string | null
}): Promise<void> {
  const supabase = getSupabaseAdmin()
  const { poliza_nueva_id, error, usuario_id } = params

  await supabase.from('notificaciones').insert({
    usuario_id: usuario_id || null,
    tipo: 'RENOVACION_COMPARACION_FALLIDA',
    titulo: 'Falló el análisis de renovación',
    mensaje: `No se pudo comparar la renovación con la póliza anterior: ${error.slice(0, 200)}`,
    entidad_tipo: 'poliza',
    entidad_id: poliza_nueva_id,
    url: `/crm/polizas/${poliza_nueva_id}`,
    prioridad: 'INFORMATIVA',
    leida: false,
  } as any)
}
