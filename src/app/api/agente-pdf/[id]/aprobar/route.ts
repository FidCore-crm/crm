import { NextResponse } from 'next/server'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { aplicarPolizaNueva, aplicarRenovacion, aplicarEndoso } from '@/lib/agente-pdf/aplicador'
import { insertarCatalogoUpsert } from '@/lib/importacion/importacion-final'
import { logger } from '@/lib/errores'
import { checkLicenciaActiva } from '@/lib/licencia-guard'
import type {
  DatosExtraidosPoliza,
  DatosExtraidosEndoso,
  MapeosCatalogos,
} from '@/lib/agente-pdf/types'

async function crearCatalogoSiFalta(
  supabase: any,
  tipoCodigo: string,
  nombre: string,
  metadata?: Record<string, unknown>,
): Promise<string | null> {
  if (!nombre) return null
  const { data: tipoRow } = await supabase
    .from('tipo_catalogo')
    .select('id')
    .eq('codigo', tipoCodigo)
    .maybeSingle()
  if (!tipoRow) return null
  const tipoId = (tipoRow as any).id as number

  try {
    return await insertarCatalogoUpsert(tipoId, nombre, metadata)
  } catch (err) {
    logger.warn({
      modulo: 'agente-pdf',
      mensaje: 'No se pudo crear cat\u00e1logo durante /aprobar',
      contexto: { tipo: tipoCodigo, nombre, error: String(err) },
    })
    return null
  }
}

/**
 * Aprende dos cosas sobre una cobertura existente elegida por el PAS:
 *  (a) equivalencia comercial: compa\u00f1\u00eda \u2192 texto del PDF.
 *  (b) `ramo_ids`: agrega el ramo actual si no estaba, as\u00ed la cobertura
 *      aparece filtrada correctamente en el form de nueva p\u00f3liza.
 *
 * Idempotente en ambas cosas. Soporta los dos formatos hist\u00f3ricos de
 * `metadata.equivalencias` (array o map).
 */
async function aprenderEquivalenciaCobertura(
  supabase: any,
  coberturaId: string,
  companiaId: string,
  textoPdf: string,
  ramoId?: string | null,
): Promise<void> {
  const { data: cob } = await supabase
    .from('catalogos')
    .select('metadata')
    .eq('id', coberturaId)
    .maybeSingle()
  if (!cob) return
  const metadata = { ...(((cob as any).metadata as Record<string, any>) ?? {}) }
  const equivalenciasActual = metadata.equivalencias
  const texto = textoPdf.trim()
  let cambio = false

  if (texto) {
    if (Array.isArray(equivalenciasActual)) {
      // Formato array: [{ compania_id, nombre_comercial }]
      const yaExiste = equivalenciasActual.some(
        (eq: any) =>
          eq?.compania_id === companiaId &&
          norm(eq?.nombre_comercial || eq?.nombre || eq?.texto) === norm(texto),
      )
      if (!yaExiste) {
        metadata.equivalencias = [
          ...equivalenciasActual,
          { compania_id: companiaId, nombre_comercial: texto },
        ]
        cambio = true
      }
    } else if (equivalenciasActual && typeof equivalenciasActual === 'object') {
      // Formato map: { [compania_id]: string }
      const map = { ...(equivalenciasActual as Record<string, unknown>) }
      const actual = map[companiaId]
      const actualTxt = typeof actual === 'string' ? actual : (actual as any)?.nombre_comercial
      if (norm(actualTxt) !== norm(texto)) {
        map[companiaId] = texto
        metadata.equivalencias = map
        cambio = true
      }
    } else {
      // Vac\u00edo \u2192 creamos como map (formato preferido para nuevas coberturas).
      metadata.equivalencias = { [companiaId]: texto }
      cambio = true
    }
  }

  // Agregar ramo_id al array si no estaba. Retrocompatible: si la cobertura
  // vieja no ten\u00eda metadata.ramo_ids seteado, arrancamos con el ramo actual.
  if (ramoId) {
    const ramoIdsActual = metadata.ramo_ids
    if (!Array.isArray(ramoIdsActual)) {
      metadata.ramo_ids = [ramoId]
      cambio = true
    } else if (!ramoIdsActual.includes(ramoId)) {
      metadata.ramo_ids = [...ramoIdsActual, ramoId]
      cambio = true
    }
  }

  if (!cambio) return
  await supabase
    .from('catalogos')
    .update({ metadata } as any)
    .eq('id', coberturaId)
}

function norm(s: string | null | undefined): string {
  return (s || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  const { id } = await params
  let body: any
  try { body = await request.json() } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 })
  }

  const datosFinales: DatosExtraidosPoliza | DatosExtraidosEndoso = body?.datos_finales
  const mapeosFinales: MapeosCatalogos | undefined = body?.mapeos_finales
  const catalogosACrear: {
    companias?: string[]
    ramos?: string[]
    coberturas?: string[]
  } = body?.catalogos_a_crear || {}
  const personaExistenteAccion: 'USAR' | 'ACTUALIZAR' =
    (['USAR', 'ACTUALIZAR'].includes(body?.persona_existente_accion)
      ? body.persona_existente_accion
      : 'USAR') as 'USAR' | 'ACTUALIZAR'

  if (!datosFinales) {
    return NextResponse.json({ ok: false, error: 'Faltan datos_finales' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const { data: proc } = await supabase
    .from('pdf_procesamientos')
    .select('id, tipo_operacion, poliza_origen_id, estado, ruta_temporal, nombre_archivo, usuario_id, comparacion_resultado')
    .eq('id', id)
    .maybeSingle()

  if (!proc) {
    return NextResponse.json({ ok: false, error: 'Procesamiento no encontrado' }, { status: 404 })
  }

  const owns = requireOwnership(usuario, { usuario_id: (proc as any).usuario_id })
  if (owns) return owns

  if ((proc as any).estado !== 'EXTRAIDO') {
    return NextResponse.json(
      { ok: false, error: `El procesamiento está en estado ${(proc as any).estado}, no se puede aprobar` },
      { status: 400 }
    )
  }

  try {
    // Crear catálogos nuevos si vinieron en el body.
    // Defensa contra abuso: saneamos nombres, limitamos cantidad por operación
    // y si el usuario no es ADMIN loggeamos la acción para trazabilidad.
    const MAX_CATALOGOS_POR_OP = 5
    const MAX_LEN_NOMBRE = 100

    const saneo = (lista: string[] | undefined): string[] => {
      if (!Array.isArray(lista)) return []
      return lista
        .map((n) => (typeof n === 'string' ? n.trim().slice(0, MAX_LEN_NOMBRE) : ''))
        .filter((n) => n.length > 0)
        .slice(0, MAX_CATALOGOS_POR_OP)
    }

    const companiasACrear = saneo(catalogosACrear.companias)
    const ramosACrear = saneo(catalogosACrear.ramos)
    const coberturasACrear = saneo(catalogosACrear.coberturas)

    if (
      usuario.rol !== 'ADMIN' &&
      (companiasACrear.length || ramosACrear.length || coberturasACrear.length)
    ) {
      logger.info({
        modulo: 'agente-pdf',
        mensaje: 'Usuario no-ADMIN creó catálogos desde /aprobar (auditoría)',
        contexto: {
          usuario_id: usuario.id,
          rol: usuario.rol,
          procesamiento_id: id,
          companias: companiasACrear,
          ramos: ramosACrear,
          coberturas: coberturasACrear,
        },
      })
    }

    const mapeos = { ...(mapeosFinales || {}) } as MapeosCatalogos
    for (const nombre of companiasACrear) {
      const nuevo = await crearCatalogoSiFalta(supabase, 'COMPANIA', nombre)
      if (nuevo && !mapeos.compania_id) mapeos.compania_id = nuevo
    }
    for (const nombre of ramosACrear) {
      const nuevo = await crearCatalogoSiFalta(supabase, 'RAMO', nombre)
      if (nuevo && !mapeos.ramo_id) mapeos.ramo_id = nuevo
    }
    // Coberturas: crear con metadata pre-poblada para que aparezcan filtradas
    // por ramo en los forms + con equivalencia auto-sembrada para la compañía
    // del PDF. Así el próximo PDF con el mismo texto se resuelve solo.
    const infoCob = mapeos.cobertura_info_config
    const textoPdfCob = infoCob?.texto_pdf?.trim() || null
    for (const nombre of coberturasACrear) {
      const metaCobertura: Record<string, unknown> = {}
      if (mapeos.ramo_id) metaCobertura.ramo_ids = [mapeos.ramo_id]
      if (mapeos.compania_id && textoPdfCob) {
        metaCobertura.equivalencias = { [mapeos.compania_id]: textoPdfCob }
      }
      const nuevo = await crearCatalogoSiFalta(supabase, 'COBERTURA', nombre, metaCobertura)
      if (nuevo && !mapeos.cobertura_id) mapeos.cobertura_id = nuevo
    }

    // Aprendizaje automático: si el mapeador no reconoció la cobertura (venía
    // con texto_pdf en cobertura_info_config) y el PAS terminó eligiendo una
    // existente, guardamos la equivalencia + ramo_id. Idempotente — no duplica
    // si ya estaba. Cubre también el caso "creé al vuelo" porque acabamos de
    // setear cobertura_id arriba.
    if (mapeos.cobertura_id && mapeos.compania_id && textoPdfCob) {
      try {
        await aprenderEquivalenciaCobertura(
          supabase,
          mapeos.cobertura_id,
          mapeos.compania_id,
          textoPdfCob,
          mapeos.ramo_id,
        )
      } catch (err) {
        // No bloquea la aprobación — solo loguea.
        logger.warn({
          modulo: 'agente-pdf',
          mensaje: 'No se pudo aprender equivalencia de cobertura',
          contexto: {
            cobertura_id: mapeos.cobertura_id,
            compania_id: mapeos.compania_id,
            texto_pdf: textoPdfCob,
            error: String(err),
          },
        })
      }
    }

    let resultado: {
      poliza_id?: string
      endoso_id?: string
      persona_id?: string
      accion_ejecutada?: string
      archivo_id_nuevo?: string | null
    } = {}

    const tipo = (proc as any).tipo_operacion
    const rutaPDF = (proc as any).ruta_temporal
    const nombreArchivo = (proc as any).nombre_archivo

    if (tipo === 'POLIZA_NUEVA') {
      resultado = await aplicarPolizaNueva({
        procesamiento_id: id,
        datos: datosFinales as DatosExtraidosPoliza,
        mapeos,
        ruta_pdf: rutaPDF,
        nombre_archivo: nombreArchivo,
        usuario_id: usuario.id,
        persona_existente_accion: personaExistenteAccion,
      })
    } else if (tipo === 'RENOVACION') {
      resultado = await aplicarRenovacion({
        procesamiento_id: id,
        poliza_origen_id: (proc as any).poliza_origen_id,
        datos: datosFinales as DatosExtraidosPoliza,
        mapeos,
        ruta_pdf: rutaPDF,
        nombre_archivo: nombreArchivo,
        persona_existente_accion: personaExistenteAccion,
        usuario_id: usuario.id,
      })
    } else if (tipo === 'ENDOSO') {
      resultado = await aplicarEndoso({
        procesamiento_id: id,
        poliza_id: (proc as any).poliza_origen_id,
        datos: datosFinales as DatosExtraidosEndoso,
        ruta_pdf: rutaPDF,
        nombre_archivo: nombreArchivo,
      })
    }

    // Copiar el resultado de la comparación (si corrió durante el
    // procesamiento) desde pdf_procesamientos.comparacion_resultado hacia
    // polizas.comparacion_ia. La comparación ya se hizo en paralelo con la
    // extracción; acá solo persistimos el histórico en la póliza.
    if (tipo === 'RENOVACION' && resultado.poliza_id && resultado.archivo_id_nuevo) {
      const compResultado = (proc as any).comparacion_resultado
      if (compResultado && typeof compResultado === 'object') {
        try {
          const comparacionParaPoliza = {
            ...compResultado,
            archivo_nuevo_id: resultado.archivo_id_nuevo,
            completado_en: (compResultado as any).completado_en || new Date().toISOString(),
          }
          await supabase
            .from('polizas')
            .update({ comparacion_ia: comparacionParaPoliza } as any)
            .eq('id', resultado.poliza_id)
        } catch (err) {
          logger.warn({
            modulo: 'agente-pdf',
            mensaje: 'No se pudo copiar comparacion_resultado a polizas.comparacion_ia',
            contexto: { poliza_nueva_id: resultado.poliza_id, error: String(err) },
          })
        }
      }
    }

    // Persistir accion_ejecutada dentro de datos_extraidos.meta_aplicacion
    // para que la pantalla de éxito pueda leerla sin migración de schema.
    if (resultado.accion_ejecutada) {
      const { data: procActual } = await supabase
        .from('pdf_procesamientos')
        .select('datos_extraidos')
        .eq('id', id)
        .maybeSingle()
      const prev = ((procActual as any)?.datos_extraidos || {}) as Record<string, any>
      const merged = {
        ...prev,
        meta_aplicacion: {
          accion_ejecutada: resultado.accion_ejecutada,
          persona_id: resultado.persona_id || null,
        },
      }
      await supabase
        .from('pdf_procesamientos')
        .update({ datos_extraidos: merged } as any)
        .eq('id', id)
    }

    return NextResponse.json({
      ok: true,
      ...resultado,
      redirect_url: resultado.poliza_id
        ? `/crm/polizas/${resultado.poliza_id}`
        : undefined,
    })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error al aplicar' },
      { status: 500 }
    )
  }
}
