/**
 * Aplicar filtros de una audiencia (`mailing_audiencias.filtro_jsonb`) sobre la
 * cartera de personas para obtener la lista de destinatarios real.
 *
 * Funciona en server-side (usa supabase admin para query). NO aplica filtro de
 * cartera de usuario porque el módulo de comunicaciones es admin-only.
 *
 * Estructura del filtro_jsonb (todos los campos opcionales):
 *   {
 *     "estado_persona": ["ACTIVO", "PROSPECTO"],     // OR entre estados
 *     "tipo_persona": ["FISICA"],                    // OR
 *     "acepta_marketing": true,                      // bool exact
 *     "origen": ["WEB", "REFERIDO"],                 // OR
 *     "provincia": ["Buenos Aires"],                 // OR (string match)
 *     "con_email": true,                             // solo personas con email
 *     "compania_ids": ["uuid"],                      // tiene póliza en compañía
 *     "ramo_ids": ["uuid"],                          // tiene póliza en ramo
 *     "estado_poliza": ["VIGENTE"],                  // estado de pólizas
 *     "vencimiento_proximo_dias": 30,                // pólizas que vencen en N días
 *     "vencidas_hace_dias": 7,                       // pólizas vencidas hace N días
 *     "con_polizas_vigentes": true,                  // tiene al menos 1 vigente
 *     "antiguedad_cliente_dias_min": null,           // fecha_alta >= hoy - N
 *     "antiguedad_cliente_dias_max": null            // fecha_alta <= hoy - N
 *   }
 *
 * Solo se aplican los campos presentes en el filtro.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface FiltroAudiencia {
  estado_persona?: string[]
  tipo_persona?: string[]
  acepta_marketing?: boolean
  origen?: string[]
  provincia?: string[]
  con_email?: boolean
  compania_ids?: string[]
  ramo_ids?: string[]
  estado_poliza?: string[]
  vencimiento_proximo_dias?: number | null
  vencidas_hace_dias?: number | null
  con_polizas_vigentes?: boolean
  antiguedad_cliente_dias_min?: number | null
  antiguedad_cliente_dias_max?: number | null
}

export interface ResultadoAudiencia {
  total: number
  ids: string[]
  /** Muestra de hasta N personas para preview */
  muestra: Array<{
    id: string
    nombre: string | null
    apellido: string
    razon_social: string | null
    email: string | null
    acepta_marketing: boolean
  }>
}

const HOY = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Calcula los persona_id que cumplen los filtros, devuelve el total + una
 * muestra. Internamente hace queries por separado (personas + pólizas) y
 * cruza los resultados en memoria — alcanza para volúmenes de cartera típica
 * de un PAS (hasta 10k personas).
 */
export async function aplicarFiltroAudiencia(
  supabase: SupabaseClient,
  filtro: FiltroAudiencia,
  opciones?: { tamano_muestra?: number },
): Promise<ResultadoAudiencia> {
  const tamano_muestra = opciones?.tamano_muestra ?? 10

  // ── Paso 1: query base de personas con criterios directos ──
  let qPersonas = supabase
    .from('personas')
    .select('id, nombre, apellido, razon_social, email, acepta_marketing, fecha_alta, tipo_persona, estado, origen, provincia')
    .is('deleted_at', null)

  if (filtro.estado_persona?.length) qPersonas = qPersonas.in('estado', filtro.estado_persona)
  if (filtro.tipo_persona?.length) qPersonas = qPersonas.in('tipo_persona', filtro.tipo_persona)
  if (filtro.acepta_marketing != null) qPersonas = qPersonas.eq('acepta_marketing', filtro.acepta_marketing)
  if (filtro.origen?.length) qPersonas = qPersonas.in('origen', filtro.origen)
  if (filtro.provincia?.length) qPersonas = qPersonas.in('provincia', filtro.provincia)
  if (filtro.con_email) qPersonas = qPersonas.not('email', 'is', null).neq('email', '')

  // Antigüedad
  if (filtro.antiguedad_cliente_dias_min != null) {
    const limite = new Date(HOY().getTime() - filtro.antiguedad_cliente_dias_min * 86400000)
    qPersonas = qPersonas.lte('fecha_alta', limite.toISOString().slice(0, 10))
  }
  if (filtro.antiguedad_cliente_dias_max != null) {
    const limite = new Date(HOY().getTime() - filtro.antiguedad_cliente_dias_max * 86400000)
    qPersonas = qPersonas.gte('fecha_alta', limite.toISOString().slice(0, 10))
  }

  const { data: personasBase, error: errPersonas } = await qPersonas
  if (errPersonas) throw new Error(`Error consultando personas: ${errPersonas.message}`)
  let candidatas = (personasBase ?? []) as any[]

  // ── Paso 2: filtros que dependen de pólizas ──
  const necesitaPolizas =
    !!filtro.compania_ids?.length ||
    !!filtro.ramo_ids?.length ||
    !!filtro.estado_poliza?.length ||
    filtro.vencimiento_proximo_dias != null ||
    filtro.vencidas_hace_dias != null ||
    filtro.con_polizas_vigentes != null

  if (necesitaPolizas && candidatas.length > 0) {
    const ids = candidatas.map(p => p.id)

    let qPolizas = supabase
      .from('polizas')
      .select('asegurado_id, compania_id, ramo_id, estado, fecha_fin')
      .in('asegurado_id', ids)

    if (filtro.compania_ids?.length) qPolizas = qPolizas.in('compania_id', filtro.compania_ids)
    if (filtro.ramo_ids?.length) qPolizas = qPolizas.in('ramo_id', filtro.ramo_ids)
    if (filtro.estado_poliza?.length) qPolizas = qPolizas.in('estado', filtro.estado_poliza)
    if (filtro.con_polizas_vigentes === true) qPolizas = qPolizas.eq('estado', 'VIGENTE')

    if (filtro.vencimiento_proximo_dias != null) {
      const hoyISO = HOY().toISOString().slice(0, 10)
      const limite = new Date(HOY().getTime() + filtro.vencimiento_proximo_dias * 86400000)
        .toISOString().slice(0, 10)
      qPolizas = qPolizas.eq('estado', 'VIGENTE').gte('fecha_fin', hoyISO).lte('fecha_fin', limite)
    }
    if (filtro.vencidas_hace_dias != null) {
      const hoyISO = HOY().toISOString().slice(0, 10)
      const desde = new Date(HOY().getTime() - filtro.vencidas_hace_dias * 86400000)
        .toISOString().slice(0, 10)
      qPolizas = qPolizas.gte('fecha_fin', desde).lt('fecha_fin', hoyISO)
    }

    const { data: polizas, error: errPolizas } = await qPolizas
    if (errPolizas) throw new Error(`Error consultando pólizas: ${errPolizas.message}`)

    // Filtrar candidatas: que tengan al menos 1 póliza que cumpla
    const idsConPoliza = new Set<string>()
    for (const p of (polizas ?? []) as any[]) idsConPoliza.add(p.asegurado_id)
    candidatas = candidatas.filter(p => idsConPoliza.has(p.id))
  }

  // Si pidieron explícitamente "sin pólizas vigentes", invertimos
  if (filtro.con_polizas_vigentes === false && candidatas.length > 0) {
    const ids = candidatas.map(p => p.id)
    const { data: polizasVigentes } = await supabase
      .from('polizas')
      .select('asegurado_id')
      .in('asegurado_id', ids)
      .eq('estado', 'VIGENTE')
    const idsConVigente = new Set<string>(((polizasVigentes ?? []) as any[]).map(p => p.asegurado_id))
    candidatas = candidatas.filter(p => !idsConVigente.has(p.id))
  }

  return {
    total: candidatas.length,
    ids: candidatas.map(p => p.id),
    muestra: candidatas.slice(0, tamano_muestra).map(p => ({
      id: p.id,
      nombre: p.nombre,
      apellido: p.apellido,
      razon_social: p.razon_social,
      email: p.email,
      acepta_marketing: !!p.acepta_marketing,
    })),
  }
}
