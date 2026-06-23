// ============================================================
// Aplicador — convierte los datos aprobados del PDF en entidades
// reales del CRM (persona, póliza, riesgo, endoso) y mueve el
// archivo original al storage definitivo.
// ============================================================

import path from 'path'
import { copyFile, mkdir, unlink } from 'fs/promises'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { ensureEndosoFolder } from '@/lib/storage-utils'
import { registrarEventoBitacora } from '@/lib/bitacora-poliza'
import { logger } from '@/lib/errores'
import { activarRenovadaSiCorresponde } from '@/lib/polizas-transiciones'
import { encolarEmailAutomaticoPoliza } from '@/lib/polizas-emails'
import { encolarBienvenidaCliente } from '@/lib/personas-emails'
import {
  normalizarEstadoPersona,
  normalizarTipoPersona,
  normalizarEstadoPoliza,
  normalizarMoneda,
  toTitleCase,
  normalizarEmail,
  normalizarTelefono,
  normalizarCodigoPostal,
  normalizarPatente,
  CLAVES_RIESGO_NO_TITLECASE,
} from '@/lib/importacion/normalizadores'
import { normalizarRefacturacion } from '@/lib/refacturaciones'
import type {
  DatosExtraidosPoliza,
  DatosExtraidosEndoso,
  MapeosCatalogos,
} from './types'

const STORAGE_ROOT = path.join(process.cwd(), 'storage')

function sanitizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
}

function calcularEstadoPoliza(fechaInicio: string): 'PROGRAMADA' | 'VIGENTE' {
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const fi = new Date(fechaInicio)
  fi.setHours(0, 0, 0, 0)
  return fi.getTime() > hoy.getTime() ? 'PROGRAMADA' : 'VIGENTE'
}

/**
 * Borra el archivo temporal al final del flujo sin bloquear. Si falla,
 * loggea (no es crítico: el temporal ya fue copiado al destino, y el cron
 * de limpieza lo borrará en 24h). Nunca tira.
 */
async function borrarTemporalNoCritico(rutaTemporal: string): Promise<void> {
  try {
    await unlink(rutaTemporal)
  } catch (err) {
    logger.warn({
      modulo: 'agente-pdf',
      mensaje: 'No se pudo borrar el PDF temporal después de copiar al destino',
      contexto: { ruta: rutaTemporal, error: String(err) },
    })
  }
}

/**
 * Normaliza tipo_riesgo a uppercase + trim. No valida contra whitelist porque
 * los tipos los dicta el catálogo RAMO del PAS (dinámico). Fallback a 'GENERICO'
 * si viene vacío.
 */
function normalizarTipoRiesgo(valor: string | null | undefined): string {
  const crudo = (valor || '').toString().trim().toUpperCase().replace(/[\s-]+/g, '_')
  return crudo || 'GENERICO'
}

/**
 * Resuelve tipo_riesgo usando la metadata del ramo mapeado como fuente de verdad
 * (es lo que el PAS definió desde catálogos). Si el ramo no está mapeado, usa
 * lo que devolvió la IA. Si no hay nada, 'GENERICO'.
 */
async function resolverTipoRiesgo(
  supabase: any,
  ramoId: string | null | undefined,
  tipoRiesgoDeIA: string | null | undefined
): Promise<string> {
  if (ramoId) {
    const { data: ramo } = await supabase
      .from('catalogos')
      .select('metadata')
      .eq('id', ramoId)
      .maybeSingle()
    const metaTipo = (ramo as any)?.metadata?.tipo_riesgo
    if (metaTipo) return normalizarTipoRiesgo(metaTipo)
  }
  return normalizarTipoRiesgo(tipoRiesgoDeIA)
}

/**
 * Aplica los mismos normalizadores que el importador masivo
 * (`normalizarRiesgoImportado`):
 *   - patente / motor / chasis → UPPERCASE (sin espacios/guiones en patente).
 *   - email dentro del JSONB → lowercase.
 *   - matrículas / números de serie / IMEI → UPPERCASE.
 *   - campos cuya key contenga "patente" → patente normalizada.
 *   - todo lo demás string → Title Case, excepto la blacklist
 *     (descripciones largas, beneficiarios, campos numéricos puros).
 * Idempotente.
 */
function normalizarDetalleTecnico(
  detalle: Record<string, any> | null | undefined
): Record<string, any> {
  const raw = { ...(detalle || {}) }

  // 1. Identificadores hardcoded (top-level del riesgo automotor):
  if (typeof raw.patente === 'string') {
    raw.patente = normalizarPatente(raw.patente) || null
  }
  if (typeof raw.motor === 'string') {
    raw.motor = raw.motor.trim().toUpperCase() || null
  }
  if (typeof raw.chasis === 'string') {
    raw.chasis = raw.chasis.trim().toUpperCase() || null
  }
  if (typeof raw.email === 'string') {
    raw.email = normalizarEmail(raw.email) || null
  }

  // 2. Para el resto de campos string, aplicar Title Case excepto blacklist.
  // El importador hace exactamente esto en `normalizarRiesgoImportado`.
  const YA_PROCESADAS = new Set(['patente', 'motor', 'chasis', 'email'])
  for (const [k, v] of Object.entries(raw)) {
    if (YA_PROCESADAS.has(k)) continue
    if (CLAVES_RIESGO_NO_TITLECASE.has(k)) continue
    if (typeof v !== 'string') continue
    const lower = k.toLowerCase()
    if (lower.includes('patente')) {
      raw[k] = normalizarPatente(v)
    } else if (
      lower.includes('matricula') ||
      lower.includes('numero_serie') ||
      lower === 'imei'
    ) {
      raw[k] = v.trim().toUpperCase() || null
    } else {
      raw[k] = toTitleCase(v)
    }
  }

  // 3. Filtrar keys vacías / null / undefined / strings con solo whitespace.
  // La IA a veces mete null o "" en los campos que el PDF no traía, y los
  // queremos fuera para que la ficha no muestre filas inútiles.
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || v === undefined) continue
    if (typeof v === 'string' && v.trim() === '') continue
    out[k] = v
  }
  return out
}

// ────────────────────────────────────────────────────────────
// Resolución de persona — respeta la decisión del PAS
// ────────────────────────────────────────────────────────────

export type AccionCliente = 'USAR' | 'ACTUALIZAR'
export type AccionEjecutada =
  | 'USADA_EXISTENTE'
  | 'ACTUALIZADA'
  | 'CREADA_NUEVA'

function normalizarDNI(v: string | null | undefined): string {
  return (v || '').toString().replace(/\D/g, '')
}

async function insertarPersona(
  supabase: any,
  datos: DatosExtraidosPoliza['asegurado'],
  usuarioId: string | null,
  extras: Record<string, any> = {}
): Promise<string> {
  const dni = normalizarDNI(datos.dni_cuil)
  if (!dni) throw new Error('No se puede crear persona sin DNI/CUIT')

  const apellidoRaw = datos.apellido || datos.nombre_completo || datos.razon_social || 'Sin apellido'
  // Normalizadores tolerantes igual que el importador: si la IA extrae
  // `tipo_persona='Física'` o `estado='Activo'` (capitalizado), no choca
  // contra el CHECK constraint de personas. Adicionalmente, toTitleCase /
  // normalizarEmail / normalizarTelefono / normalizarCodigoPostal limpian
  // mayúsculas crudas o formatos raros del PDF.
  const emailNorm = normalizarEmail(datos.email)
  const telNorm = normalizarTelefono(datos.telefono)
  const { data: creada, error } = await supabase
    .from('personas')
    .insert({
      tipo_persona: normalizarTipoPersona(
        (datos as unknown as Record<string, unknown>).tipo_persona as string | null | undefined,
        dni,
      ),
      dni_cuil: dni,
      apellido: toTitleCase(apellidoRaw) || apellidoRaw,
      nombre: toTitleCase(datos.nombre) || null,
      razon_social: toTitleCase(datos.razon_social) || null,
      email: emailNorm || null,
      telefono: telNorm || null,
      calle: toTitleCase(datos.domicilio?.calle) || null,
      numero: datos.domicilio?.numero || null,
      localidad: toTitleCase(datos.domicilio?.localidad) || null,
      provincia: toTitleCase(datos.domicilio?.provincia) || null,
      codigo_postal: normalizarCodigoPostal(datos.domicilio?.codigo_postal) || null,
      pais: 'Argentina',
      estado: normalizarEstadoPersona(
        (datos as unknown as Record<string, unknown>).estado as string | null | undefined,
      ),
      origen: 'AGENTE_PDF',
      // Distingue altas reales (AGENTE_PDF y MANUAL) de importadas
      // a los fines de disparar bienvenida del cliente.
      origen_creacion: 'AGENTE_PDF',
      usuario_id: usuarioId,
      ...extras,
    } as any)
    .select('id')
    .single()

  if (error || !creada) {
    throw new Error(`No se pudo crear la persona: ${error?.message || 'error desconocido'}`)
  }
  return (creada as any).id
}

/**
 * Actualiza campos de contacto/domicilio con los del PDF, solo cuando no son null.
 * NO toca campos identitarios (apellido, nombre, DNI, tipo_persona).
 */
async function actualizarPersonaConDatosPDF(
  supabase: any,
  persona_id: string,
  datos: DatosExtraidosPoliza['asegurado']
): Promise<void> {
  const patch: Record<string, any> = {}
  const emailNorm = normalizarEmail(datos.email)
  if (emailNorm) patch.email = emailNorm
  const telNorm = normalizarTelefono(datos.telefono)
  if (telNorm) patch.telefono = telNorm
  if (datos.domicilio?.calle) patch.calle = toTitleCase(datos.domicilio.calle)
  if (datos.domicilio?.numero) patch.numero = datos.domicilio.numero
  if (datos.domicilio?.localidad) patch.localidad = toTitleCase(datos.domicilio.localidad)
  if (datos.domicilio?.provincia) patch.provincia = toTitleCase(datos.domicilio.provincia)
  if (datos.domicilio?.codigo_postal) {
    patch.codigo_postal = normalizarCodigoPostal(datos.domicilio.codigo_postal)
  }

  if (Object.keys(patch).length === 0) return

  // `updated_at` se setea automáticamente por trigger tg_actualizar_updated_at
  // (migración 052). NO setearlo manualmente.
  await supabase.from('personas').update(patch).eq('id', persona_id)
}

/**
 * Resuelve el asegurado principal respetando la decisión del PAS.
 * Devuelve el persona_id y qué acción se ejecutó efectivamente.
 */
export async function resolverPersonaAsegurado(
  supabase: any,
  datos: DatosExtraidosPoliza['asegurado'],
  accion: AccionCliente,
  usuarioId: string | null
): Promise<{ persona_id: string; accion_ejecutada: AccionEjecutada }> {
  const dni = normalizarDNI(datos.dni_cuil)
  if (!dni) throw new Error('No se puede resolver persona sin DNI/CUIT')

  const { data: existente } = await supabase
    .from('personas')
    .select('id')
    .eq('dni_cuil', dni)
    .maybeSingle()

  // Si no existe, siempre creamos nueva (independiente de la acción)
  if (!existente) {
    const persona_id = await insertarPersona(supabase, datos, usuarioId)
    return { persona_id, accion_ejecutada: 'CREADA_NUEVA' }
  }

  // Existe → aplicar la decisión
  const existenteId = (existente as any).id

  if (accion === 'ACTUALIZAR') {
    await actualizarPersonaConDatosPDF(supabase, existenteId, datos)
    return { persona_id: existenteId, accion_ejecutada: 'ACTUALIZADA' }
  }

  // USAR (default) — no se permite crear duplicados por DNI.
  return { persona_id: existenteId, accion_ejecutada: 'USADA_EXISTENTE' }
}

/**
 * Fallback para tomador y otros flujos que no necesitan la decisión del PAS:
 * busca por DNI y crea si no existe.
 */
async function buscarOCrearPersona(
  supabase: any,
  datos: DatosExtraidosPoliza['asegurado'],
  usuarioId: string | null
): Promise<string> {
  const dni = normalizarDNI(datos.dni_cuil)
  if (!dni) throw new Error('No se puede crear persona sin DNI/CUIT')
  const { data: existente } = await supabase
    .from('personas')
    .select('id')
    .eq('dni_cuil', dni)
    .maybeSingle()
  if (existente) return (existente as any).id
  return insertarPersona(supabase, datos, usuarioId)
}

// ────────────────────────────────────────────────────────────
// Destinos de archivo — devuelven rutas calculadas, no mueven.
// ────────────────────────────────────────────────────────────

interface DestinoArchivo {
  carpetaAbs: string
  rutaDestinoAbs: string
  rutaRelativa: string
  nombreSaneado: string
}

function destinoDocumentacion(
  numeroPoliza: string,
  nombreArchivo: string,
): DestinoArchivo {
  const numSan = sanitizeName(numeroPoliza)
  const nombreSan = sanitizeName(nombreArchivo)
  const carpetaAbs = path.join(STORAGE_ROOT, 'polizas', numSan, 'documentacion')
  return {
    carpetaAbs,
    rutaDestinoAbs: path.join(carpetaAbs, nombreSan),
    rutaRelativa: `polizas/${numSan}/documentacion/${nombreSan}`,
    nombreSaneado: nombreSan,
  }
}

function destinoDocumentacionRenovada(
  numeroPoliza: string,
  nombreArchivo: string,
): DestinoArchivo {
  const numSan = sanitizeName(numeroPoliza)
  const nombreSan = sanitizeName(nombreArchivo)
  const carpetaAbs = path.join(STORAGE_ROOT, 'polizas', numSan, 'documentacion_renovada')
  return {
    carpetaAbs,
    rutaDestinoAbs: path.join(carpetaAbs, nombreSan),
    rutaRelativa: `polizas/${numSan}/documentacion_renovada/${nombreSan}`,
    nombreSaneado: nombreSan,
  }
}

function destinoEndoso(
  numeroPoliza: string,
  endosoId: string,
  nombreArchivo: string,
): DestinoArchivo {
  const numSan = sanitizeName(numeroPoliza)
  const idSan = sanitizeName(endosoId)
  const nombreSan = sanitizeName(nombreArchivo)
  const carpetaAbs = path.join(STORAGE_ROOT, 'polizas', numSan, 'endosos', idSan)
  return {
    carpetaAbs,
    rutaDestinoAbs: path.join(carpetaAbs, nombreSan),
    rutaRelativa: `polizas/${numSan}/endosos/${idSan}/${nombreSan}`,
    nombreSaneado: nombreSan,
  }
}

// ────────────────────────────────────────────────────────────
// Aplicadores principales
// ────────────────────────────────────────────────────────────

export interface ResultadoAplicacion {
  poliza_id?: string
  endoso_id?: string
  persona_id?: string
  accion_ejecutada?: AccionEjecutada
}

export async function aplicarPolizaNueva(params: {
  procesamiento_id: string
  datos: DatosExtraidosPoliza
  mapeos: MapeosCatalogos
  ruta_pdf: string
  nombre_archivo: string
  usuario_id: string | null
  persona_existente_accion?: AccionCliente
}): Promise<ResultadoAplicacion> {
  const supabase = getSupabaseAdmin()
  const { datos, mapeos, ruta_pdf, nombre_archivo, usuario_id, procesamiento_id } = params
  const accionCliente: AccionCliente = params.persona_existente_accion || 'USAR'

  if (!datos.poliza?.numero_poliza) throw new Error('Falta número de póliza')
  if (!datos.poliza?.fecha_inicio || !datos.poliza?.fecha_fin) {
    throw new Error('Faltan fechas de vigencia')
  }
  // Validación que el importador ya hace en `validarEntidades`: si la IA
  // extrajo fechas invertidas del PDF, abortamos antes del INSERT en vez
  // de crear una póliza con vigencia imposible.
  if (datos.poliza.fecha_inicio > datos.poliza.fecha_fin) {
    throw new Error(
      `Fecha de inicio (${datos.poliza.fecha_inicio}) posterior a fecha de fin (${datos.poliza.fecha_fin})`,
    )
  }

  const { persona_id: aseguradoId, accion_ejecutada } = await resolverPersonaAsegurado(
    supabase, datos.asegurado, accionCliente, usuario_id
  )
  let tomadorId: string | null = null
  if (datos.tomador && datos.tomador.dni_cuil) {
    tomadorId = await buscarOCrearPersona(supabase, datos.tomador, usuario_id)
  }

  const estado = calcularEstadoPoliza(datos.poliza.fecha_inicio)

  const { data: polizaCreada, error: errPol } = await supabase
    .from('polizas')
    .insert({
      numero_poliza: datos.poliza.numero_poliza,
      asegurado_id: aseguradoId,
      tomador_id: tomadorId,
      compania_id: mapeos.compania_id,
      ramo_id: mapeos.ramo_id,
      cobertura_id: mapeos.cobertura_id,
      refacturacion: normalizarRefacturacion(mapeos.refacturacion as string | null) || null,
      fecha_inicio: datos.poliza.fecha_inicio,
      fecha_fin: datos.poliza.fecha_fin,
      // Si el PDF trajo "U$S" o "Pesos" en vez de "USD"/"ARS", normalizamos
      // para que no choque contra ningún check downstream.
      moneda: normalizarMoneda(datos.poliza.moneda),
      suma_asegurada: datos.poliza.suma_asegurada || null,
      // estado ya viene calculado por `calcularEstadoPoliza`, pero pasamos
      // por el normalizador por seguridad si alguien edita la función.
      estado: normalizarEstadoPoliza(estado) || estado,
      origen_creacion: 'AGENTE_PDF',
    } as any)
    .select('id')
    .single()

  if (errPol || !polizaCreada) {
    if (errPol?.message?.includes('uq_poliza_compania_numero')) {
      throw new Error(
        `Ya existe una póliza con el número ${datos.poliza.numero_poliza} para esta compañía. No se puede crear una duplicada.`
      )
    }
    throw new Error(`No se pudo crear la póliza: ${errPol?.message}`)
  }
  const polizaId = (polizaCreada as any).id

  try {
    // 1. Insertar riesgo
    if (datos.riesgo?.tipo_riesgo || mapeos.ramo_id) {
      const tipoResuelto = await resolverTipoRiesgo(supabase, mapeos.ramo_id, datos.riesgo?.tipo_riesgo)
      const { error: errRiesgo } = await supabase.from('riesgos').insert({
        poliza_id: polizaId,
        tipo_riesgo: tipoResuelto,
        descripcion_corta: datos.riesgo?.descripcion_corta || null,
        detalle_tecnico: normalizarDetalleTecnico(datos.riesgo?.detalle_tecnico),
        suma_asegurada: datos.riesgo?.suma_asegurada || datos.poliza.suma_asegurada || null,
        numero_item: 1,
        activo: true,
      } as any)
      if (errRiesgo) throw new Error(`No se pudo crear el riesgo: ${errRiesgo.message}`)
    }

    // 2. Calcular destino del PDF y crear carpeta
    const dest = destinoDocumentacion(datos.poliza.numero_poliza, nombre_archivo)
    await mkdir(dest.carpetaAbs, { recursive: true })

    // 3. Registrar en poliza_archivos PRIMERO (con la ruta futura). Esto
    // evita archivos huérfanos si el insert de archivos falla después de
    // copiar. Si el copy falla, revertimos el archivo_id.
    const { data: archivoCreado, error: errArch } = await supabase
      .from('poliza_archivos')
      .insert({
        poliza_id: polizaId,
        categoria: 'documentacion',
        nombre: dest.nombreSaneado,
        ruta: dest.rutaRelativa,
        mime_type: 'application/pdf',
      } as any)
      .select('id')
      .single()
    if (errArch || !archivoCreado) {
      throw new Error(`No se pudo registrar el archivo: ${errArch?.message}`)
    }
    const archivoId = (archivoCreado as any).id

    // 4. Copiar el PDF. Si falla, borramos el registro recién creado.
    try {
      await copyFile(ruta_pdf, dest.rutaDestinoAbs)
    } catch (copyErr) {
      try {
        await supabase.from('poliza_archivos').delete().eq('id', archivoId)
      } catch (delErr) {
        logger.warn({
          modulo: 'agente-pdf',
          mensaje: 'No se pudo revertir poliza_archivos tras fallar copyFile',
          contexto: { archivo_id: archivoId, error: String(delErr) },
        })
      }
      throw new Error(`No se pudo copiar el PDF al storage: ${String(copyErr)}`)
    }

    // 5. Borrar temporal (no crítico)
    await borrarTemporalNoCritico(ruta_pdf)
  } catch (error) {
    // ROLLBACK: eliminar póliza creada. Preservar el error original si el
    // rollback a su vez falla.
    logger.error({
      modulo: 'agente-pdf',
      mensaje: 'Falló al crear riesgo o mover PDF en póliza nueva, revirtiendo póliza',
      contexto: { poliza_id: polizaId, error: String(error) },
    })
    try {
      await supabase.from('polizas').delete().eq('id', polizaId)
    } catch (rbErr) {
      logger.error({
        modulo: 'agente-pdf',
        mensaje: 'Falló el rollback de la póliza tras error anterior (no se propaga)',
        contexto: { poliza_id: polizaId, error_rollback: String(rbErr), error_original: String(error) },
      })
    }
    throw error instanceof Error ? error : new Error(String(error))
  }

  // Actualizar el procesamiento
  await supabase
    .from('pdf_procesamientos')
    .update({
      estado: 'APROBADO',
      poliza_creada_id: polizaId,
    } as any)
    .eq('id', procesamiento_id)

  await registrarEventoBitacora(supabase, {
    poliza_id: polizaId,
    tipo_evento: 'CREACION',
    estado_nuevo: estado,
    motivo: 'Póliza creada desde PDF por el agente IA',
    usuario_id: usuario_id,
  })

  // Si nace VIGENTE, encolar email de bienvenida (fire-and-forget + anti-spam interno)
  if (estado === 'VIGENTE') {
    try {
      const { encolarEmail } = await import('@/lib/comunicaciones-sender')
      const { data: per } = await supabase
        .from('personas')
        .select('id, nombre, apellido, razon_social, email')
        .eq('id', aseguradoId)
        .maybeSingle()
      const p = per as any
      if (p?.email) {
        const nombre = p.razon_social || [p.apellido, p.nombre].filter(Boolean).join(', ') || p.nombre || ''
        await encolarEmail({
          plantilla_codigo: 'bienvenida_poliza',
          destinatario: { email: p.email, nombre, persona_id: p.id },
          poliza_id: polizaId,
          tipo_envio: 'AUTOMATICO_BIENVENIDA',
          anti_spam: true,
        })
      }
      // Bienvenida del cliente: idempotente, se manda una sola vez por persona.
      await encolarBienvenidaCliente(supabase, aseguradoId)
    } catch (err) {
      logger.warn({
        modulo: 'agente-pdf',
        mensaje: 'No se pudo encolar email de bienvenida (no crítico)',
        contexto: { poliza_id: polizaId, error: String(err) },
      })
    }
  }

  return { poliza_id: polizaId, persona_id: aseguradoId, accion_ejecutada }
}

export async function aplicarRenovacion(params: {
  procesamiento_id: string
  poliza_origen_id: string
  datos: DatosExtraidosPoliza
  mapeos: MapeosCatalogos
  ruta_pdf: string
  nombre_archivo: string
  usuario_id: string | null
  persona_existente_accion?: AccionCliente
}): Promise<ResultadoAplicacion> {
  const supabase = getSupabaseAdmin()
  const { datos, mapeos, ruta_pdf, nombre_archivo, usuario_id, procesamiento_id, poliza_origen_id } = params

  if (!datos.poliza?.numero_poliza) throw new Error('Falta número de póliza')
  if (!datos.poliza?.fecha_inicio || !datos.poliza?.fecha_fin) throw new Error('Faltan fechas')
  if (datos.poliza.fecha_inicio > datos.poliza.fecha_fin) {
    throw new Error(
      `Fecha de inicio (${datos.poliza.fecha_inicio}) posterior a fecha de fin (${datos.poliza.fecha_fin})`,
    )
  }

  const { data: origen } = await supabase
    .from('polizas')
    .select('id, numero_poliza, fecha_fin, estado, asegurado_id, tomador_id, compania_id, ramo_id, cobertura_id, refacturacion, riesgos(id, tipo_riesgo, descripcion_corta, detalle_tecnico, suma_asegurada, numero_item)')
    .eq('id', poliza_origen_id)
    .maybeSingle()

  if (!origen) throw new Error('Póliza origen no encontrada')

  // Validar que la origen no esté en un estado que no admite renovación
  if (['CANCELADA', 'ANULADA'].includes((origen as any).estado)) {
    throw new Error(`No se puede renovar una póliza ${(origen as any).estado}. Rehabilitala primero.`)
  }

  // Validar no-solapamiento: la renovación tiene que arrancar al fin (o después)
  // de la origen. Si el PDF trae una fecha que se solapa, abortamos.
  if ((origen as any).fecha_fin && datos.poliza.fecha_inicio < (origen as any).fecha_fin) {
    throw new Error(
      `La fecha de inicio de la renovación (${datos.poliza.fecha_inicio}) no puede ser anterior al fin de la póliza original ${(origen as any).numero_poliza} (${(origen as any).fecha_fin})`,
    )
  }

  // Validar que la origen no tenga ya una renovación activa
  const { data: hijaActiva } = await supabase
    .from('polizas')
    .select('id, numero_poliza')
    .eq('poliza_origen_id', poliza_origen_id)
    .in('estado', ['RENOVADA', 'VIGENTE', 'PROGRAMADA'])
    .limit(1)
    .maybeSingle()
  if (hijaActiva) {
    throw new Error(
      `La póliza ${(origen as any).numero_poliza} ya tiene una renovación activa (${(hijaActiva as any).numero_poliza}). No se puede crear otra.`,
    )
  }

  // Si el PAS eligió ACTUALIZAR en la UI de revisar, aprovechamos para
  // refrescar los datos de contacto/domicilio del asegurado origen con
  // los del PDF. USAR no hace nada porque el asegurado viene fijado por
  // la póliza origen.
  const accionCliente: AccionCliente = params.persona_existente_accion || 'USAR'
  let accion_ejecutada: AccionEjecutada = 'USADA_EXISTENTE'
  if (accionCliente === 'ACTUALIZAR' && datos.asegurado?.dni_cuil) {
    await actualizarPersonaConDatosPDF(supabase, (origen as any).asegurado_id, datos.asegurado)
    accion_ejecutada = 'ACTUALIZADA'
  }

  const { data: polizaCreada, error: errPol } = await supabase
    .from('polizas')
    .insert({
      numero_poliza: datos.poliza.numero_poliza,
      asegurado_id: (origen as any).asegurado_id,
      tomador_id: (origen as any).tomador_id,
      compania_id: mapeos.compania_id || (origen as any).compania_id,
      ramo_id: mapeos.ramo_id || (origen as any).ramo_id,
      cobertura_id: mapeos.cobertura_id || (origen as any).cobertura_id,
      // Normalizar igual que aplicarPolizaNueva: si la IA del PDF trae
      // "Mensual"/"U$S" o el origen los guardó crudos antes de v1.0.36,
      // los pasamos por los normalizadores antes del INSERT.
      refacturacion:
        normalizarRefacturacion(
          (mapeos.refacturacion || (origen as any).refacturacion) as string | null,
        ) || (origen as any).refacturacion,
      fecha_inicio: datos.poliza.fecha_inicio,
      fecha_fin: datos.poliza.fecha_fin,
      moneda: normalizarMoneda(datos.poliza.moneda),
      suma_asegurada: datos.poliza.suma_asegurada || null,
      estado: 'RENOVADA',
      poliza_origen_id,
      origen_creacion: 'AGENTE_PDF',
    } as any)
    .select('id')
    .single()

  if (errPol || !polizaCreada) {
    if (errPol?.message?.includes('uq_poliza_compania_numero')) {
      throw new Error(
        `Ya existe una póliza con el número ${datos.poliza.numero_poliza} para esta compañía. No se puede crear una renovación duplicada.`
      )
    }
    throw new Error(`No se pudo crear la renovación: ${errPol?.message}`)
  }
  const polizaId = (polizaCreada as any).id

  try {
    // 1. Copiar riesgos del origen (usar datos nuevos si el PDF trae info distinta)
    const riesgosOrigen = (origen as any).riesgos || []
    const ramoIdEfectivo = mapeos.ramo_id || (origen as any).ramo_id || null
    if (datos.riesgo?.tipo_riesgo) {
      const tipoResuelto = await resolverTipoRiesgo(supabase, ramoIdEfectivo, datos.riesgo.tipo_riesgo)
      const { error: errRiesgo } = await supabase.from('riesgos').insert({
        poliza_id: polizaId,
        tipo_riesgo: tipoResuelto,
        descripcion_corta: datos.riesgo.descripcion_corta || null,
        detalle_tecnico: normalizarDetalleTecnico(datos.riesgo.detalle_tecnico),
        suma_asegurada: datos.riesgo.suma_asegurada || datos.poliza.suma_asegurada || null,
        numero_item: 1,
        activo: true,
      } as any)
      if (errRiesgo) throw new Error(`No se pudo crear el riesgo: ${errRiesgo.message}`)
    } else if (riesgosOrigen.length > 0) {
      for (const r of riesgosOrigen) {
        const { error: errR } = await supabase.from('riesgos').insert({
          poliza_id: polizaId,
          tipo_riesgo: r.tipo_riesgo,
          descripcion_corta: r.descripcion_corta,
          detalle_tecnico: normalizarDetalleTecnico(r.detalle_tecnico),
          suma_asegurada: r.suma_asegurada,
          numero_item: r.numero_item || 1,
          activo: true,
        } as any)
        if (errR) throw new Error(`No se pudo copiar riesgo del origen: ${errR.message}`)
      }
    }

    // 2. Calcular destino y crear carpeta
    const dest = destinoDocumentacionRenovada(datos.poliza.numero_poliza, nombre_archivo)
    await mkdir(dest.carpetaAbs, { recursive: true })

    // 3. Insertar registro de archivo ANTES de copiar
    const { data: archivoCreado, error: errArch } = await supabase
      .from('poliza_archivos')
      .insert({
        poliza_id: polizaId,
        categoria: 'documentacion_renovada',
        nombre: dest.nombreSaneado,
        ruta: dest.rutaRelativa,
        mime_type: 'application/pdf',
      } as any)
      .select('id')
      .single()
    if (errArch || !archivoCreado) {
      throw new Error(`No se pudo registrar el archivo: ${errArch?.message}`)
    }
    const archivoId = (archivoCreado as any).id

    // 4. Copiar PDF con rollback del registro si falla
    try {
      await copyFile(ruta_pdf, dest.rutaDestinoAbs)
    } catch (copyErr) {
      try {
        await supabase.from('poliza_archivos').delete().eq('id', archivoId)
      } catch (delErr) {
        logger.warn({
          modulo: 'agente-pdf',
          mensaje: 'No se pudo revertir poliza_archivos tras fallar copyFile (renovación)',
          contexto: { archivo_id: archivoId, error: String(delErr) },
        })
      }
      throw new Error(`No se pudo copiar el PDF de renovación al storage: ${String(copyErr)}`)
    }

    // 5. Borrar temporal (no crítico)
    await borrarTemporalNoCritico(ruta_pdf)
  } catch (error) {
    // ROLLBACK: eliminar póliza renovada creada. Preserva el error original.
    logger.error({
      modulo: 'agente-pdf',
      mensaje: 'Falló al crear riesgo o mover PDF en renovación, revirtiendo póliza',
      contexto: { poliza_id: polizaId, error: String(error) },
    })
    try {
      await supabase.from('riesgos').delete().eq('poliza_id', polizaId)
      await supabase.from('polizas').delete().eq('id', polizaId)
    } catch (rbErr) {
      logger.error({
        modulo: 'agente-pdf',
        mensaje: 'Falló el rollback de la renovación (no se propaga)',
        contexto: { poliza_id: polizaId, error_rollback: String(rbErr), error_original: String(error) },
      })
    }
    throw error instanceof Error ? error : new Error(String(error))
  }

  await supabase
    .from('pdf_procesamientos')
    .update({ estado: 'APROBADO', poliza_creada_id: polizaId } as any)
    .eq('id', procesamiento_id)

  // Bitácora en póliza origen (renovación creada) y en la nueva (creación)
  await registrarEventoBitacora(supabase, {
    poliza_id: poliza_origen_id,
    tipo_evento: 'RENOVACION_CREADA',
    motivo: `Renovación creada desde PDF con número ${datos.poliza.numero_poliza}`,
    observaciones: `Nueva póliza id ${polizaId}`,
    usuario_id: usuario_id,
  })
  await registrarEventoBitacora(supabase, {
    poliza_id: polizaId,
    tipo_evento: 'CREACION',
    estado_nuevo: 'RENOVADA',
    motivo: 'Renovación creada desde PDF por el agente IA',
    usuario_id: usuario_id,
  })

  // Si la fecha de inicio ya llegó (hoy en zona AR), activar inmediatamente.
  // Idempotente: si la fecha es futura, el helper no hace nada y el cron la
  // toma en su próxima corrida.
  try {
    const t = await activarRenovadaSiCorresponde(supabase, polizaId, usuario_id)
    if (t.cambios.length > 0) {
      await encolarEmailAutomaticoPoliza(supabase, polizaId, 'AUTOMATICO_RENOVACION')
      // También intentamos la bienvenida: si la persona nunca la recibió
      // (cliente preexistente sin email en su primera póliza, ahora con email
      // al renovar), este es el primer momento en que se le puede mandar.
      await encolarBienvenidaCliente(supabase, (origen as any).asegurado_id)
    }
  } catch (err) {
    logger.warn({
      modulo: 'agente-pdf',
      mensaje: 'Falló activación inmediata de renovación (la póliza queda RENOVADA esperando al cron)',
      contexto: { poliza_id: polizaId, error: String(err) },
    })
  }

  return { poliza_id: polizaId, persona_id: (origen as any).asegurado_id, accion_ejecutada }
}

export async function aplicarEndoso(params: {
  procesamiento_id: string
  poliza_id: string
  datos: DatosExtraidosEndoso
  ruta_pdf: string
  nombre_archivo: string
}): Promise<ResultadoAplicacion> {
  const supabase = getSupabaseAdmin()
  const { datos, ruta_pdf, nombre_archivo, procesamiento_id, poliza_id } = params

  const { data: poliza } = await supabase
    .from('polizas')
    .select('id, numero_poliza')
    .eq('id', poliza_id)
    .maybeSingle()
  if (!poliza) throw new Error('Póliza no encontrada')

  // Reservar el próximo numero_endoso de forma atómica (lock pesimista en la póliza).
  // Evita race conditions con creaciones manuales o concurrentes.
  const { data: numData, error: numErr } = await (supabase as any)
    .rpc('generar_numero_endoso', { p_poliza_id: poliza_id })
  if (numErr || numData === null || numData === undefined) {
    throw new Error(`No se pudo generar numero_endoso: ${numErr?.message ?? 'desconocido'}`)
  }
  const siguienteNumero = Number(numData)

  const { data: endosoCreado, error: errEnd } = await supabase
    .from('endosos')
    .insert({
      poliza_id,
      numero_endoso: siguienteNumero,
      fecha: datos.fecha_endoso || new Date().toISOString().slice(0, 10),
      motivo: datos.motivo || 'Endoso cargado desde PDF',
      observaciones: datos.observaciones || (datos.cambios_detectados || []).join('\n') || null,
    } as any)
    .select('id')
    .single()

  if (errEnd || !endosoCreado) throw new Error(`No se pudo crear el endoso: ${errEnd?.message}`)
  const endosoId = (endosoCreado as any).id

  try {
    // 1. Asegurar carpeta + calcular destino
    await ensureEndosoFolder((poliza as any).numero_poliza, endosoId)
    const dest = destinoEndoso((poliza as any).numero_poliza, endosoId, nombre_archivo)
    await mkdir(dest.carpetaAbs, { recursive: true })

    // 2. Registrar archivo ANTES de copiar
    const { data: archivoCreado, error: errArch } = await supabase
      .from('poliza_archivos')
      .insert({
        poliza_id,
        endoso_id: endosoId,
        categoria: 'endosos',
        nombre: dest.nombreSaneado,
        ruta: dest.rutaRelativa,
        mime_type: 'application/pdf',
      } as any)
      .select('id')
      .single()
    if (errArch || !archivoCreado) {
      throw new Error(`No se pudo registrar el archivo: ${errArch?.message}`)
    }
    const archivoId = (archivoCreado as any).id

    // 3. Copiar con rollback del registro si falla
    try {
      await copyFile(ruta_pdf, dest.rutaDestinoAbs)
    } catch (copyErr) {
      try {
        await supabase.from('poliza_archivos').delete().eq('id', archivoId)
      } catch (delErr) {
        logger.warn({
          modulo: 'agente-pdf',
          mensaje: 'No se pudo revertir poliza_archivos tras fallar copyFile (endoso)',
          contexto: { archivo_id: archivoId, error: String(delErr) },
        })
      }
      throw new Error(`No se pudo copiar el PDF del endoso al storage: ${String(copyErr)}`)
    }

    await borrarTemporalNoCritico(ruta_pdf)
  } catch (error) {
    logger.error({
      modulo: 'agente-pdf',
      mensaje: 'Falló al registrar/copiar PDF del endoso, revirtiendo endoso',
      contexto: { endoso_id: endosoId, error: String(error) },
    })
    try {
      await supabase.from('endosos').delete().eq('id', endosoId)
    } catch (rbErr) {
      logger.error({
        modulo: 'agente-pdf',
        mensaje: 'Falló el rollback del endoso (no se propaga)',
        contexto: { endoso_id: endosoId, error_rollback: String(rbErr), error_original: String(error) },
      })
    }
    throw error instanceof Error ? error : new Error(String(error))
  }

  await supabase
    .from('pdf_procesamientos')
    .update({ estado: 'APROBADO', endoso_creado_id: endosoId } as any)
    .eq('id', procesamiento_id)

  return { endoso_id: endosoId }
}
