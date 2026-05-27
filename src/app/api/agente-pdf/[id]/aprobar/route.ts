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
  nombre: string
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
    return await insertarCatalogoUpsert(tipoId, nombre)
  } catch (err) {
    logger.warn({
      modulo: 'agente-pdf',
      mensaje: 'No se pudo crear cat\u00e1logo durante /aprobar',
      contexto: { tipo: tipoCodigo, nombre, error: String(err) },
    })
    return null
  }
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
    .select('id, tipo_operacion, poliza_origen_id, estado, ruta_temporal, nombre_archivo, usuario_id')
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
    for (const nombre of coberturasACrear) {
      const nuevo = await crearCatalogoSiFalta(supabase, 'COBERTURA', nombre)
      if (nuevo && !mapeos.cobertura_id) mapeos.cobertura_id = nuevo
    }

    let resultado: { poliza_id?: string; endoso_id?: string; persona_id?: string; accion_ejecutada?: string } = {}

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
