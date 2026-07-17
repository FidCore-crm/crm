import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { rm } from 'fs/promises'
import path from 'path'
import { ERRORES, respuestaError, respuestaExito, manejarErrores, ErrorAplicacion, logger } from '@/lib/errores'
import { registrarEventoBitacora } from '@/lib/bitacora-poliza'
import {
  activarRenovadaSiCorresponde,
  activarProgramadaSiCorresponde,
  vencerPolizaSiCorresponde,
} from '@/lib/polizas-transiciones'
import { encolarEmailAutomaticoPoliza } from '@/lib/polizas-emails'
import { encolarBienvenidaCliente } from '@/lib/personas-emails'
import { requireLicenciaActiva } from '@/lib/licencia-guard'

const STORAGE_ROOT = path.resolve(process.cwd(), 'storage')

function safePath(base: string, ...segments: string[]): string {
  // path.resolve normaliza ".." y elimina "." sobrantes — más fuerte que path.join.
  const full = path.resolve(base, ...segments)
  // Asegurar que el path resultante esté dentro de base (con separador final
  // para evitar el caso /storage vs /storage-otro)
  const normalizedBase = base.endsWith(path.sep) ? base : base + path.sep
  if (!full.startsWith(normalizedBase) && full !== base) {
    throw new Error('Path traversal detected')
  }
  return full
}

// Obtener toda la cadena de renovaciones hacia abajo (iterativa con guard anti-ciclo)
async function obtenerCadenaAbajo(supabase: any, polizaId: string): Promise<{ id: string; numero_poliza: string }[]> {
  const resultado: { id: string; numero_poliza: string }[] = []
  const visitados = new Set<string>([polizaId])
  const cola = [polizaId]

  while (cola.length > 0) {
    const currentId = cola.shift()!
    const { data: hijas } = await supabase
      .from('polizas')
      .select('id, numero_poliza')
      .eq('poliza_origen_id', currentId)
    for (const h of (hijas ?? []) as any[]) {
      if (visitados.has(h.id)) continue
      visitados.add(h.id)
      resultado.push({ id: h.id, numero_poliza: h.numero_poliza })
      cola.push(h.id)
    }
  }

  return resultado
}

export const GET = manejarErrores(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)

  const supabase = getSupabaseAdmin()

  const { data: poliza, error } = await supabase.from('polizas').select('id, numero_poliza, estado, poliza_origen_id, asegurado_id').eq('id', id).single()
  if (error || !poliza) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)

  // Filtro de cartera
  if (usuario.acceso_cartera === 'PROPIA') {
    const { data: persona } = await supabase.from('personas').select('usuario_id').eq('id', (poliza as any).asegurado_id).single()
    if (persona && (persona as any).usuario_id && (persona as any).usuario_id !== usuario.id) {
      return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)
    }
  }

  // Obtener toda la cadena hacia abajo
  const hijas = await obtenerCadenaAbajo(supabase, id)
  const allPolizaIds = [id, ...hijas.map(h => h.id)]

  // Validar: siniestros abiertos en TODA la cadena
  const { data: sinAbiertos } = await supabase
    .from('siniestros')
    .select('id, numero_caso, estado, poliza_id')
    .in('poliza_id', allPolizaIds)
    .not('estado', 'in', '("FINALIZADO","RECHAZADO")')

  if (sinAbiertos && sinAbiertos.length > 0) {
    // Agrupar por póliza
    const porPoliza = new Map<string, number>()
    for (const s of sinAbiertos as any[]) {
      porPoliza.set(s.poliza_id, (porPoliza.get(s.poliza_id) ?? 0) + 1)
    }

    // Obtener números de póliza
    const detalleArr: { poliza: string; siniestros_abiertos: number }[] = []
    const mensajeParts: string[] = []
    for (const [pId, count] of Array.from(porPoliza.entries())) {
      const { data: pol } = await supabase.from('polizas').select('numero_poliza').eq('id', pId).single()
      const num = pol ? `#${(pol as any).numero_poliza}` : pId
      detalleArr.push({ poliza: num, siniestros_abiertos: count })
      mensajeParts.push(`Póliza ${num} tiene ${count} siniestro(s) abierto(s)`)
    }

    return NextResponse.json({
      ok: false,
      motivo: 'SINIESTROS_ABIERTOS',
      cantidad: sinAbiertos.length,
      mensaje: `No se puede eliminar porque hay ${sinAbiertos.length} siniestro(s) abierto(s). ${mensajeParts.join('. ')}. Cerrá o rechazá los siniestros primero.`,
      detalle: detalleArr,
    }, { status: 409 })
  }

  // Calcular resumen de toda la cadena
  const [
    { count: siniestros },
    { count: riesgos },
    { count: endosos },
    { count: archivos_polizas },
  ] = await Promise.all([
    supabase.from('siniestros').select('id', { count: 'exact', head: true }).in('poliza_id', allPolizaIds),
    supabase.from('riesgos').select('id', { count: 'exact', head: true }).in('poliza_id', allPolizaIds),
    supabase.from('endosos').select('id', { count: 'exact', head: true }).in('poliza_id', allPolizaIds),
    supabase.from('poliza_archivos').select('id', { count: 'exact', head: true }).in('poliza_id', allPolizaIds),
  ])

  const { data: sinIds } = await supabase.from('siniestros').select('id').in('poliza_id', allPolizaIds)
  let archivos_siniestros = 0
  if (sinIds && sinIds.length > 0) {
    const { count: as_ } = await supabase.from('siniestro_archivos').select('id', { count: 'exact', head: true }).in('siniestro_id', sinIds.map((s: any) => s.id))
    archivos_siniestros = as_ ?? 0
  }

  return respuestaExito({
    puede_eliminar: true,
    resumen: {
      polizas_total: allPolizaIds.length,
      siniestros: siniestros ?? 0,
      riesgos: riesgos ?? 0,
      endosos: endosos ?? 0,
      polizas_hijas: hijas.length,
      archivos_polizas: archivos_polizas ?? 0,
      archivos_siniestros,
    },
  })
}, { modulo: 'polizas' })

export const DELETE = manejarErrores(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)
  if (usuario.rol !== 'ADMIN') return respuestaError(ERRORES.PERM_SIN_PERMISO)

  await requireLicenciaActiva()

  const supabase = getSupabaseAdmin()

  // Snapshot de la póliza con datos para audit log
  const { data: poliza, error } = await supabase
    .from('polizas')
    .select(`
      id, numero_poliza, poliza_origen_id, estado, fecha_inicio, fecha_fin,
      asegurado_id, compania_id, ramo_id,
      asegurado:personas!asegurado_id (apellido, nombre, razon_social),
      compania:catalogos!compania_id (nombre),
      ramo:catalogos!ramo_id (nombre)
    `)
    .eq('id', id)
    .single()
  if (error || !poliza) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)

  // Obtener toda la cadena hacia abajo
  const hijas = await obtenerCadenaAbajo(supabase, id)
  const allPolizaIds = [id, ...hijas.map(h => h.id)]

  // Validar siniestros abiertos en toda la cadena
  const { count: abiertos } = await supabase
    .from('siniestros')
    .select('id', { count: 'exact', head: true })
    .in('poliza_id', allPolizaIds)
    .not('estado', 'in', '("FINALIZADO","RECHAZADO")')
  if (abiertos && abiertos > 0) {
    return NextResponse.json({ ok: false, motivo: 'SINIESTROS_ABIERTOS', mensaje: `Hay ${abiertos} siniestro(s) abierto(s) en la cadena` }, { status: 409 })
  }

  // Siniestros de toda la cadena
  const { data: siniestros } = await supabase.from('siniestros').select('id, numero_caso').in('poliza_id', allPolizaIds)

  // Tareas vinculadas (para notificaciones)
  const { data: tareasData } = await supabase.from('tareas').select('id').in('poliza_id', allPolizaIds)
  const tareaIds = (tareasData ?? []).map((t: any) => t.id)

  // 1. Borrar archivos físicos de siniestros
  let carpetas = 0
  for (const s of (siniestros ?? []) as any[]) {
    if (!s.numero_caso) continue
    try {
      await rm(safePath(STORAGE_ROOT, 'siniestros', s.numero_caso), { recursive: true, force: true })
      carpetas++
    } catch (err) {
      // No crítico: la carpeta del siniestro puede no existir en disco
      logger.warn({ modulo: 'polizas', mensaje: 'Error eliminando carpeta de siniestro', contexto: { numero_caso: s.numero_caso, error: String(err) } })
    }
  }

  // 2. Borrar archivos físicos de pólizas hijas (toda la carpeta)
  for (const h of hijas) {
    if (!h.numero_poliza) continue
    try {
      await rm(safePath(STORAGE_ROOT, 'polizas', h.numero_poliza), { recursive: true, force: true })
      carpetas++
    } catch (err) {
      // No crítico: la carpeta de la póliza hija puede no existir en disco
      logger.warn({ modulo: 'polizas', mensaje: 'Error eliminando carpeta de póliza hija', contexto: { numero_poliza: h.numero_poliza, error: String(err) } })
    }
  }

  // 3. Borrar archivos de la póliza principal
  const esRaiz = !(poliza as any).poliza_origen_id
  const numPol = (poliza as any).numero_poliza
  if (esRaiz) {
    // Es la raíz: borrar toda la carpeta (incluyendo inspección)
    try {
      await rm(safePath(STORAGE_ROOT, 'polizas', numPol), { recursive: true, force: true })
      carpetas++
    } catch (err) {
      // No crítico: la carpeta raíz de la póliza puede no existir en disco
      logger.warn({ modulo: 'polizas', mensaje: 'Error eliminando carpeta raíz de póliza', contexto: { numero_poliza: numPol, error: String(err) } })
    }
  } else {
    // No es raíz: borrar solo documentacion/ y documentacion_renovada/ (no inspección)
    try { await rm(safePath(STORAGE_ROOT, 'polizas', numPol, 'documentacion'), { recursive: true, force: true }) } catch (err) {
      // Silenciado: archivo/recurso puede no existir
      logger.warn({ modulo: 'polizas', mensaje: 'Error eliminando documentacion de póliza no-raíz', contexto: { numero_poliza: numPol, error: String(err) } })
    }
    try { await rm(safePath(STORAGE_ROOT, 'polizas', numPol, 'documentacion_renovada'), { recursive: true, force: true }) } catch (err) {
      // Silenciado: archivo/recurso puede no existir
      logger.warn({ modulo: 'polizas', mensaje: 'Error eliminando documentacion_renovada de póliza no-raíz', contexto: { numero_poliza: numPol, error: String(err) } })
    }
    // Intentar borrar carpeta padre si quedó vacía
    try {
      const { readdir } = await import('fs/promises')
      const dir = safePath(STORAGE_ROOT, 'polizas', numPol)
      const items = await readdir(dir)
      if (items.length === 0) await rm(dir, { recursive: true, force: true })
    } catch {
      // Silenciado: archivo/recurso puede no existir
    }
    carpetas++
  }

  // 4. Borrar notificaciones — agrupadas por entidad_tipo para evitar colisiones de UUID
  const sinIds = (siniestros ?? []).map((s: any) => s.id)
  if (allPolizaIds.length > 0) {
    await supabase.from('notificaciones').delete().eq('entidad_tipo', 'poliza').in('entidad_id', allPolizaIds)
  }
  if (sinIds.length > 0) {
    await supabase.from('notificaciones').delete().eq('entidad_tipo', 'siniestro').in('entidad_id', sinIds)
  }
  if (tareaIds.length > 0) {
    await supabase.from('notificaciones').delete().eq('entidad_tipo', 'tarea').in('entidad_id', tareaIds)
  }

  // 5. Audit log ANTES del DELETE — snapshot que sobrevive al CASCADE
  const aseg = (poliza as any).asegurado
  const aseguradoNombre = aseg?.razon_social
    || [aseg?.apellido, aseg?.nombre].filter(Boolean).join(', ')
    || null
  const motivoBody = await request.clone().json().catch(() => ({})) as any
  const motivo: string | null = motivoBody?.motivo ? String(motivoBody.motivo).trim() : null

  // Contar registros que se van a borrar para el audit
  const { count: cantRiesgos } = await supabase.from('riesgos').select('id', { count: 'exact', head: true }).in('poliza_id', allPolizaIds)
  const { count: cantEndosos } = await supabase.from('endosos').select('id', { count: 'exact', head: true }).in('poliza_id', allPolizaIds)
  const { count: cantArchivos } = await supabase.from('poliza_archivos').select('id', { count: 'exact', head: true }).in('poliza_id', allPolizaIds)

  await supabase.from('polizas_eliminadas').insert({
    poliza_id: id,
    numero_poliza: (poliza as any).numero_poliza,
    asegurado_id: (poliza as any).asegurado_id,
    asegurado_nombre: aseguradoNombre,
    compania_id: (poliza as any).compania_id,
    compania_nombre: (poliza as any).compania?.nombre ?? null,
    ramo_id: (poliza as any).ramo_id,
    ramo_nombre: (poliza as any).ramo?.nombre ?? null,
    estado: (poliza as any).estado,
    fecha_inicio: (poliza as any).fecha_inicio,
    fecha_fin: (poliza as any).fecha_fin,
    poliza_origen_id: (poliza as any).poliza_origen_id,
    cant_polizas_hijas: hijas.length,
    cant_riesgos: cantRiesgos ?? 0,
    cant_siniestros: (siniestros ?? []).length,
    cant_endosos: cantEndosos ?? 0,
    cant_archivos: cantArchivos ?? 0,
    eliminada_por_usuario_id: usuario.id,
    eliminada_por_email: usuario.email,
    motivo,
  })

  // 6. Borrar póliza (CASCADE se lleva hijas, riesgos, endosos, siniestros, etc.)
  const { error: delError } = await supabase.from('polizas').delete().eq('id', id)
  if (delError) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
      detalle: delError.message,
      contexto: { tabla: 'polizas', operacion: 'delete', id },
    })
  }

  return respuestaExito({
    eliminado: {
      polizas_total: allPolizaIds.length,
      siniestros: (siniestros ?? []).length,
      polizas_hijas: hijas.length,
      carpetas_eliminadas: carpetas,
    },
  })
}, { modulo: 'polizas' })

// ============================================================
// PATCH — Editar póliza + (opcional) un riesgo asociado.
// El frontend (editar/page.tsx) hace UPDATE directo a Supabase, lo cual
// permite a un usuario PROPIA editar pólizas ajenas si conoce el id.
// Este endpoint encapsula la edición con check de ownership server-side.
// ============================================================

const CAMPOS_EDITABLES_POLIZA = [
  'asegurado_id', 'compania_id', 'ramo_id', 'cobertura_id',
  'numero_poliza', 'fecha_inicio', 'fecha_fin',
  'refacturacion', 'medio_pago',
  'suma_asegurada', 'moneda', 'mostrar_suma_asegurada_portal',
  'observaciones', 'notas',
] as const

export const PATCH = manejarErrores(async (
  request: NextRequest,
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

  // Cargar póliza con datos de ownership + valores actuales (para diff de bitácora)
  const { data: poliza } = await supabase
    .from('polizas')
    .select('id, asegurado_id, compania_id, ramo_id, cobertura_id, numero_poliza, fecha_inicio, fecha_fin, refacturacion, observaciones, notas, estado, poliza_origen_id, origen_creacion, updated_at, asegurado:personas!asegurado_id (usuario_id)')
    .eq('id', id)
    .maybeSingle()

  if (!poliza) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)

  const owns = requireOwnership(usuario, {
    usuario_id: (poliza as any).asegurado?.usuario_id ?? null,
  })
  if (owns) return owns

  // Optimistic concurrency check (#81): si el cliente envía if_match_updated_at
  // y no coincide con el actual, devolver 409 con el registro actual.
  if (
    body.if_match_updated_at &&
    !body.force_overwrite &&
    (poliza as any).updated_at &&
    body.if_match_updated_at !== (poliza as any).updated_at
  ) {
    return respuestaError(ERRORES.NEG_CONFLICTO_CONCURRENCIA, {
      registro_actual: poliza,
    })
  }

  // Construir patch solo con campos permitidos presentes en el body
  const patchPoliza: Record<string, any> = {}
  const camposCambiados: string[] = []
  // Mapeo del campo del body al campo de la DB (el frontend usa "persona_id" para "asegurado_id")
  for (const campo of CAMPOS_EDITABLES_POLIZA) {
    if (campo in body) {
      const valorNuevo = body[campo] ?? null
      const valorActual = (poliza as any)[campo] ?? null
      patchPoliza[campo] = valorNuevo
      // Comparación simple (suficiente para strings/UUIDs/fechas)
      if (String(valorActual ?? '') !== String(valorNuevo ?? '')) {
        camposCambiados.push(campo)
      }
    }
  }

  // Validar fechas si vienen ambas en el patch
  const fechaInicioFinal = patchPoliza.fecha_inicio ?? (poliza as any).fecha_inicio
  const fechaFinFinal = patchPoliza.fecha_fin ?? (poliza as any).fecha_fin
  if (fechaInicioFinal && fechaFinFinal && fechaFinFinal <= fechaInicioFinal) {
    return respuestaError(ERRORES.VALID_FORMATO_INVALIDO, {
      campos: { fecha_fin: 'La fecha de fin debe ser posterior a la fecha de inicio' },
    })
  }

  // Validar no-solapamiento con la póliza origen (si esta póliza es renovación)
  if ('fecha_inicio' in patchPoliza && (poliza as any).poliza_origen_id) {
    const { data: origen } = await supabase
      .from('polizas')
      .select('numero_poliza, fecha_fin')
      .eq('id', (poliza as any).poliza_origen_id)
      .maybeSingle()
    if (origen && fechaInicioFinal && fechaInicioFinal < (origen as any).fecha_fin) {
      return respuestaError(ERRORES.VALID_FORMATO_INVALIDO, {
        campos: {
          fecha_inicio: `La fecha de inicio (${fechaInicioFinal}) no puede ser anterior al fin de la póliza original ${(origen as any).numero_poliza} (${(origen as any).fecha_fin})`,
        },
      })
    }
  }

  // Validar no-solapamiento con renovaciones HIJAS (si esta póliza es origen)
  if ('fecha_fin' in patchPoliza) {
    const { data: hijas } = await supabase
      .from('polizas')
      .select('numero_poliza, fecha_inicio, estado')
      .eq('poliza_origen_id', id)
      .in('estado', ['RENOVADA', 'VIGENTE'])
    if (hijas && hijas.length > 0) {
      const violacion = (hijas as any[]).find(h => fechaFinFinal && h.fecha_inicio < fechaFinFinal)
      if (violacion) {
        return respuestaError(ERRORES.VALID_FORMATO_INVALIDO, {
          campos: {
            fecha_fin: `La fecha de fin (${fechaFinFinal}) se solapa con la renovación ${violacion.numero_poliza} que arranca el ${violacion.fecha_inicio}`,
          },
        })
      }
    }
  }

  let updatedAtFresco: string | null = null
  if (Object.keys(patchPoliza).length > 0) {
    const { data: polizaActualizada, error } = await supabase
      .from('polizas')
      .update(patchPoliza)
      .eq('id', id)
      .select('updated_at')
      .single()
    if (error) {
      throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
        detalle: error.message,
        contexto: { tabla: 'polizas', operacion: 'update', id },
      })
    }
    updatedAtFresco = (polizaActualizada as any)?.updated_at ?? null

    // Bitácora EDICION solo si efectivamente hubo cambios
    if (camposCambiados.length > 0) {
      // Si cambió el asegurado, resolver nombres para que la bitácora sea legible
      // (no UUIDs). Es un evento delicado: cambiar el asegurado equivale a
      // transferir la póliza a otra persona.
      let observaciones: string | null = null
      if (camposCambiados.includes('asegurado_id')) {
        const idAnterior = (poliza as any).asegurado_id
        const idNuevo = patchPoliza.asegurado_id
        const [{ data: pAnt }, { data: pNue }] = await Promise.all([
          supabase.from('personas').select('apellido, nombre, razon_social, dni_cuil').eq('id', idAnterior).maybeSingle(),
          idNuevo ? supabase.from('personas').select('apellido, nombre, razon_social, dni_cuil').eq('id', idNuevo).maybeSingle() : Promise.resolve({ data: null }),
        ])
        const fmt = (p: any) => p ? `${p.razon_social || [p.apellido, p.nombre].filter(Boolean).join(', ')}${p.dni_cuil ? ` (${p.dni_cuil})` : ''}` : '—'
        observaciones = `Asegurado anterior: ${fmt(pAnt)}. Nuevo: ${fmt(pNue)}.`
      }

      await registrarEventoBitacora(supabase, {
        poliza_id: id,
        tipo_evento: 'EDICION',
        motivo: `Edición manual: ${camposCambiados.join(', ')}`,
        observaciones,
        usuario_id: usuario.id,
      })
    }
  }

  // Riesgos (opcional): el frontend puede mandar
  //   - body.riesgos: Array<{ id?, tipo_riesgo, detalle_tecnico, _eliminado? }>
  //   - body.riesgo: objeto único (compatibilidad con flujos viejos)
  // En el array, los items con _eliminado=true se borran si tienen id.
  const riesgosArray: Array<{ id?: string; tipo_riesgo?: string; detalle_tecnico?: Record<string, any>; _eliminado?: boolean }> =
    Array.isArray(body.riesgos)
      ? body.riesgos
      : (body.riesgo && typeof body.riesgo === 'object' ? [body.riesgo] : [])

  // Calcular el próximo numero_item libre antes de procesar inserts, para
  // respetar UNIQUE(poliza_id, numero_item). Si dos riesgos nuevos entran
  // en el mismo PATCH, los numeramos consecutivamente.
  let proximoItem: number | null = null
  const calcularProximoItem = async () => {
    if (proximoItem !== null) return proximoItem
    const { data: maxRow } = await supabase
      .from('riesgos')
      .select('numero_item')
      .eq('poliza_id', id)
      .order('numero_item', { ascending: false })
      .limit(1)
      .maybeSingle()
    proximoItem = ((maxRow as any)?.numero_item ?? 0) + 1
    return proximoItem
  }

  for (const r of riesgosArray) {
    if (!r || typeof r !== 'object') continue

    if (r._eliminado && r.id) {
      const { error: rErr } = await supabase
        .from('riesgos')
        .delete()
        .eq('id', r.id)
        .eq('poliza_id', id)
      if (rErr) {
        throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
          detalle: rErr.message,
          contexto: { tabla: 'riesgos', operacion: 'delete', id: r.id },
        })
      }
      continue
    }

    if (typeof r.tipo_riesgo !== 'string' || !r.detalle_tecnico || typeof r.detalle_tecnico !== 'object') continue

    if (r.id) {
      const { error: rErr } = await supabase
        .from('riesgos')
        .update({ tipo_riesgo: r.tipo_riesgo, detalle_tecnico: r.detalle_tecnico })
        .eq('id', r.id)
        .eq('poliza_id', id)
      if (rErr) {
        throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
          detalle: rErr.message,
          contexto: { tabla: 'riesgos', operacion: 'update', id: r.id },
        })
      }
    } else {
      const numeroItem = await calcularProximoItem()
      proximoItem = (proximoItem ?? 1) + 1 // reservar el siguiente para el próximo INSERT del mismo PATCH
      const { error: rErr } = await supabase
        .from('riesgos')
        .insert({ poliza_id: id, tipo_riesgo: r.tipo_riesgo, detalle_tecnico: r.detalle_tecnico, numero_item: numeroItem })
      if (rErr) {
        throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
          detalle: rErr.message,
          contexto: { tabla: 'riesgos', operacion: 'insert', poliza_id: id, numero_item: numeroItem },
        })
      }
    }
  }

  // Auto-transición tras editar fechas: si la póliza queda en condiciones de
  // cambiar de estado (renovada que llegó a su inicio, programada lista, vigente
  // que ya venció), no esperamos al cron — transicionamos ahora.
  //
  // No mandamos bienvenida/renovación si la póliza vino de una importación:
  // el cliente ya tenía esa póliza con su productor anterior, sería confuso
  // recibir un email de "bienvenida" por una póliza que conoce hace años.
  const cambiosTransicion: string[] = []
  const huboCambiosFecha = 'fecha_inicio' in patchPoliza || 'fecha_fin' in patchPoliza
  const esImportada = (poliza as any).origen_creacion === 'IMPORTACION'
  const aseguradoId = (poliza as any).asegurado_id
  if (huboCambiosFecha) {
    if ((poliza as any).estado === 'RENOVADA') {
      const t = await activarRenovadaSiCorresponde(supabase, id, usuario.id)
      cambiosTransicion.push(...t.cambios)
      if (t.cambios.length > 0 && !esImportada) {
        await encolarEmailAutomaticoPoliza(supabase, id, 'AUTOMATICO_RENOVACION')
        await encolarBienvenidaCliente(supabase, aseguradoId)
      }
    } else if ((poliza as any).estado === 'PROGRAMADA') {
      const t = await activarProgramadaSiCorresponde(supabase, id, usuario.id)
      cambiosTransicion.push(...t.cambios)
      if (t.cambios.length > 0 && !esImportada) {
        await encolarEmailAutomaticoPoliza(supabase, id, 'AUTOMATICO_BIENVENIDA')
        await encolarBienvenidaCliente(supabase, aseguradoId)
      }
    } else if ((poliza as any).estado === 'VIGENTE') {
      const t = await vencerPolizaSiCorresponde(supabase, id, usuario.id)
      cambiosTransicion.push(...t.cambios)
    }

    // Si esta póliza es origen y se acortó su fecha_fin, puede haber hijas
    // RENOVADAS listas para activarse. Las verificamos. La hija puede tener
    // un origen distinto al padre, así que chequeamos individualmente.
    const { data: hijasPendientes } = await supabase
      .from('polizas')
      .select('id, origen_creacion, asegurado_id')
      .eq('poliza_origen_id', id)
      .eq('estado', 'RENOVADA')
    for (const h of (hijasPendientes ?? []) as Array<{ id: string; origen_creacion: string | null; asegurado_id: string }>) {
      const t = await activarRenovadaSiCorresponde(supabase, h.id, usuario.id)
      cambiosTransicion.push(...t.cambios)
      if (t.cambios.length > 0 && h.origen_creacion !== 'IMPORTACION') {
        await encolarEmailAutomaticoPoliza(supabase, h.id, 'AUTOMATICO_RENOVACION')
        await encolarBienvenidaCliente(supabase, h.asegurado_id)
      }
    }
  }

  return respuestaExito({
    ok: true,
    transicion: cambiosTransicion.length > 0 ? cambiosTransicion : undefined,
    updated_at: updatedAtFresco,
  })
}, { modulo: 'polizas' })
