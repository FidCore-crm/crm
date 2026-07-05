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
  // Destinatarios a incluir. Si ambos son false/undefined, se asume
  // incluir_personas=true por retrocompatibilidad (audiencias creadas
  // antes de la migración 114 solo tenían personas).
  incluir_personas?: boolean
  incluir_leads?: boolean

  // Criterios sobre personas
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

  // Criterios sobre leads (solo se aplican si incluir_leads=true)
  leads_estado?: string[]                      // NUEVO / CONTACTADO / CONVERTIDO / DESCARTADO
  leads_motivo_descarte_ilike?: string          // ILIKE %texto% sobre motivo_descarte
  leads_fuente?: string[]                       // WEB / REFERIDO / REDES_SOCIALES / etc.
  leads_nivel_interes?: string[]                // ALTO / MEDIO / BAJO
}

export interface DestinatarioMuestra {
  id: string
  tipo: 'persona' | 'lead'
  nombre: string | null
  apellido: string
  razon_social: string | null
  email: string | null
  acepta_marketing: boolean
  // Solo para leads
  estado_lead?: string
  motivo_descarte?: string | null
}

export interface ResultadoAudiencia {
  total: number
  /** IDs de personas (compat retro con motor viejo) */
  ids: string[]
  /** IDs de leads incluidos en la audiencia */
  leads_ids: string[]
  /** Muestra combinada de hasta N destinatarios para preview */
  muestra: DestinatarioMuestra[]
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

  // Retrocompatibilidad: si no viene ni incluir_personas ni incluir_leads,
  // asumimos incluir_personas=true (audiencias creadas antes de la migración
  // 114 solo tenían personas).
  const incluirPersonas = filtro.incluir_personas ?? !filtro.incluir_leads
  const incluirLeads = filtro.incluir_leads ?? false

  // ── Paso 1: query base de personas con criterios directos ──
  let candidatas: any[] = []
  if (incluirPersonas) {
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
    candidatas = (personasBase ?? []) as any[]
  }

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

  // ── Paso 3: leads (si se incluyen) ──
  let leadsCandidatos: any[] = []
  if (incluirLeads) {
    let qLeads = supabase
      .from('leads')
      .select('id, nombre, apellido, email, estado, fuente, nivel_interes, motivo_descarte')

    if (filtro.leads_estado?.length) qLeads = qLeads.in('estado', filtro.leads_estado)
    if (filtro.leads_fuente?.length) qLeads = qLeads.in('fuente', filtro.leads_fuente)
    if (filtro.leads_nivel_interes?.length) qLeads = qLeads.in('nivel_interes', filtro.leads_nivel_interes)
    if (filtro.leads_motivo_descarte_ilike && filtro.leads_motivo_descarte_ilike.trim() !== '') {
      qLeads = qLeads.ilike('motivo_descarte', `%${filtro.leads_motivo_descarte_ilike.trim()}%`)
    }
    // Solo enviamos a leads con email — sin él no hay a dónde
    qLeads = qLeads.not('email', 'is', null).neq('email', '')

    const { data: leadsData, error: errLeads } = await qLeads
    if (errLeads) throw new Error(`Error consultando leads: ${errLeads.message}`)
    leadsCandidatos = (leadsData ?? []) as any[]
  }

  // ── Preparar muestra combinada ──
  const muestraPersonas: DestinatarioMuestra[] = candidatas.slice(0, tamano_muestra).map(p => ({
    id: p.id,
    tipo: 'persona' as const,
    nombre: p.nombre,
    apellido: p.apellido,
    razon_social: p.razon_social,
    email: p.email,
    acepta_marketing: !!p.acepta_marketing,
  }))
  const cupoRestante = Math.max(0, tamano_muestra - muestraPersonas.length)
  const muestraLeads: DestinatarioMuestra[] = leadsCandidatos.slice(0, cupoRestante).map(l => ({
    id: l.id,
    tipo: 'lead' as const,
    nombre: l.nombre,
    apellido: l.apellido,
    razon_social: null,
    email: l.email,
    acepta_marketing: true, // Los leads no tienen ese campo; asumimos que consintieron al dejar sus datos
    estado_lead: l.estado,
    motivo_descarte: l.motivo_descarte ?? null,
  }))

  return {
    total: candidatas.length + leadsCandidatos.length,
    ids: candidatas.map(p => p.id),
    leads_ids: leadsCandidatos.map(l => l.id),
    muestra: [...muestraPersonas, ...muestraLeads],
  }
}
