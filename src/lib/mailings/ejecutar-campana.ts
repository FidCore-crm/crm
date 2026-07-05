/**
 * Motor de ejecución de campañas de mailing.
 *
 * Funciona en server-side. Lo usan:
 *   - Endpoint POST /api/comunicaciones/campanas/[id]/enviar (envío inmediato)
 *   - Cron GET /api/cron/ejecutar-campanas-programadas (envío programado)
 *
 * Flujo:
 *   1. Cargar campaña + validar estado (BORRADOR/PROGRAMADA/PAUSADA → EJECUTANDO)
 *   2. Resolver destinatarios (audiencia dinámica o snapshot fijo)
 *   3. Resolver mensaje (plantilla guardada o textos libres)
 *   4. Loop de envíos secuencial con delay, actualizando métricas + tracking
 *      incremental (`personas_procesadas_ids`) para permitir reanudar.
 *   5. Marcar COMPLETADA al finalizar.
 *
 * Defensas:
 *   - Marca atómica BORRADOR→EJECUTANDO (UPDATE WHERE estado IN (...) RETURNING).
 *   - Chequea estado != PAUSADA/CANCELADA antes de cada envío.
 *   - Si crash, los procesados ya están en `personas_procesadas_ids`. La próxima
 *     ejecución salta los ya hechos.
 *   - Nunca tira: errores capturados y guardados en `ultimo_error`.
 */

import { getSupabaseAdmin } from '@/lib/supabase/server'
import { enviarComunicacion } from '@/lib/comunicaciones-sender'
import { aplicarFiltroAudiencia } from './audiencia-filtros'
import { logger } from '@/lib/errores'

const SALUDO_DEFAULT = 'Hola {{nombre}}!'
const CIERRE_DEFAULT = 'Saludos,\n{{organizacion_nombre}}'

export interface ResultadoEjecucion {
  ok: boolean
  enviados: number
  fallidos: number
  excluidos: number
  total: number
  error?: string
}

/**
 * Ejecuta una campaña. Reentrante: si la campaña ya está EJECUTANDO desde otro
 * proceso, NO la duplica (UPDATE atómico).
 */
export async function ejecutarCampana(campana_id: string): Promise<ResultadoEjecucion> {
  const supabase = getSupabaseAdmin()

  // 1) Marcar EJECUTANDO de forma atómica
  const { data: actualizada } = await (supabase.from('mailing_campanas') as any)
    .update({
      estado: 'EJECUTANDO',
      fecha_inicio_ejecucion: new Date().toISOString(),
      ultimo_error: null,
    })
    .eq('id', campana_id)
    .in('estado', ['BORRADOR', 'PROGRAMADA', 'PAUSADA'])
    .select('*')
    .single()

  if (!actualizada) {
    return { ok: false, enviados: 0, fallidos: 0, excluidos: 0, total: 0, error: 'La campaña no está en un estado ejecutable o ya está siendo procesada' }
  }

  const c = actualizada as any

  try {
    // 2) Resolver destinatarios (personas + leads)
    let persona_ids: string[] = []
    let lead_ids: string[] = []

    if (c.audiencia_id) {
      const { data: aud } = await supabase
        .from('mailing_audiencias').select('*').eq('id', c.audiencia_id).maybeSingle()
      if (!aud) {
        await marcarFallida(supabase, c.id, 'La audiencia configurada ya no existe')
        return { ok: false, enviados: 0, fallidos: 0, excluidos: 0, total: 0, error: 'Audiencia no encontrada' }
      }
      const a = aud as any
      if (a.tipo === 'MANUAL') {
        persona_ids = (a.ids_personas ?? []) as string[]
        lead_ids = (a.ids_leads ?? []) as string[]
      } else {
        const res = await aplicarFiltroAudiencia(supabase, a.filtro_jsonb ?? {}, { tamano_muestra: 0 })
        persona_ids = res.ids
        lead_ids = res.leads_ids ?? []
      }
    } else {
      persona_ids = (c.personas_ids ?? []) as string[]
      // Campañas ad-hoc sin audiencia solo tienen personas por ahora
    }

    const totalDestinatarios = persona_ids.length + lead_ids.length
    if (totalDestinatarios === 0) {
      await marcarCompletada(supabase, c.id, 0, 0, 0)
      return { ok: true, enviados: 0, fallidos: 0, excluidos: 0, total: 0 }
    }

    // 3) Filtrar los ya procesados (si es reanudación).
    // El tracking usa `personas_procesadas_ids` con un prefijo para distinguir:
    //   "p:<uuid>" para personas
    //   "l:<uuid>" para leads
    // Los IDs guardados sin prefijo (de versiones viejas) se asumen personas.
    const yaProcesadosRaw = (c.personas_procesadas_ids ?? []) as string[]
    const yaProcesadosPersonas = new Set<string>()
    const yaProcesadosLeads = new Set<string>()
    for (const raw of yaProcesadosRaw) {
      if (raw.startsWith('l:')) yaProcesadosLeads.add(raw.slice(2))
      else if (raw.startsWith('p:')) yaProcesadosPersonas.add(raw.slice(2))
      else yaProcesadosPersonas.add(raw) // legacy
    }
    const pendientes = persona_ids.filter(id => !yaProcesadosPersonas.has(id))
    const pendientesLeads = lead_ids.filter(id => !yaProcesadosLeads.has(id))

    // Actualizar total_destinatarios si era 0
    if (!c.total_destinatarios || c.total_destinatarios === 0) {
      await (supabase.from('mailing_campanas') as any)
        .update({ total_destinatarios: totalDestinatarios })
        .eq('id', c.id)
    }

    // 4) Resolver mensaje
    let asunto: string = ''
    let cuerpoFinal: string = ''
    let cta_texto: string | undefined = undefined
    let cta_url: string | undefined = undefined

    if (c.mailing_plantilla_id) {
      const { data: mp } = await supabase
        .from('mailing_plantillas').select('*').eq('id', c.mailing_plantilla_id).maybeSingle()
      if (!mp) {
        await marcarFallida(supabase, c.id, 'La plantilla configurada ya no existe')
        return { ok: false, enviados: 0, fallidos: 0, excluidos: 0, total: persona_ids.length, error: 'Plantilla no encontrada' }
      }
      const p = mp as any
      asunto = (c.asunto_override?.trim() || p.asunto || '').trim()
      cuerpoFinal = p.cuerpo
      if (p.saludo && p.saludo.trim() !== SALUDO_DEFAULT) {
        cuerpoFinal = `${p.saludo}\n\n${cuerpoFinal}`
      }
      if (p.cierre && p.cierre.trim() !== CIERRE_DEFAULT) {
        cuerpoFinal = `${cuerpoFinal}\n\n${p.cierre}`
      }
      cta_texto = p.cta_texto ?? undefined
      cta_url = p.cta_url ?? undefined
    } else {
      asunto = (c.asunto_libre ?? '').trim()
      cuerpoFinal = (c.cuerpo_libre ?? '').trim()
    }

    const campos_editables: Record<string, any> = {
      titulo: asunto,
      cuerpo: cuerpoFinal,
    }
    if (cta_texto && cta_url) {
      campos_editables.cta_texto = cta_texto
      campos_editables.cta_url = cta_url
    }

    // 5) Config de límite + delay
    const { data: comConfig } = await supabase
      .from('configuracion_comunicaciones')
      .select('activo, limite_diario, delay_entre_envios_ms')
      .limit(1).maybeSingle()
    const config = comConfig as any
    if (!config?.activo) {
      await marcarFallida(supabase, c.id, 'El sistema de comunicaciones está desactivado')
      return { ok: false, enviados: 0, fallidos: 0, excluidos: 0, total: persona_ids.length, error: 'Sistema desactivado' }
    }
    const limiteDiario = config.limite_diario ?? 500
    const delay = config.delay_entre_envios_ms ?? 2000

    const hoyInicio = new Date()
    hoyInicio.setHours(0, 0, 0, 0)
    const { count: enviosHoy } = await supabase
      .from('email_envios')
      .select('id', { count: 'exact', head: true })
      .gte('fecha_creacion', hoyInicio.toISOString())
      .in('estado', ['ENVIADO', 'ENVIANDO'])
    let enviadosHoy = enviosHoy ?? 0

    // 6) Cargar personas y leads pendientes + bajas
    const { data: personasData } = pendientes.length > 0
      ? await supabase
          .from('personas')
          .select('id, nombre, apellido, razon_social, email, acepta_marketing')
          .in('id', pendientes)
          .is('deleted_at', null)
      : { data: [] }
    const personas = (personasData ?? []) as any[]

    const { data: leadsData } = pendientesLeads.length > 0
      ? await supabase
          .from('leads')
          .select('id, nombre, apellido, email')
          .in('id', pendientesLeads)
      : { data: [] }
    const leads = (leadsData ?? []) as any[]

    const emails = [
      ...personas.filter(p => p.email).map(p => p.email.toLowerCase()),
      ...leads.filter(l => l.email).map(l => l.email.toLowerCase()),
    ]
    const { data: bajasData } = emails.length > 0
      ? await supabase.from('email_bajas').select('email').in('email', emails)
      : { data: [] }
    const emailsBaja = new Set((bajasData ?? []).map((b: any) => b.email))

    // 7) Loop de envío con tracking incremental (personas + leads unificados)
    let enviados = c.enviados ?? 0
    let fallidos = c.fallidos ?? 0
    let excluidos = c.excluidos ?? 0
    const procesadosTracking = new Set<string>(yaProcesadosRaw)

    // Cola unificada — primero personas (más cercanas), después leads
    type Destinatario =
      | { tipo: 'persona'; id: string; email: string | null; nombre: string; acepta_marketing: boolean }
      | { tipo: 'lead'; id: string; email: string | null; nombre: string }
    const cola: Destinatario[] = [
      ...personas.map(p => ({
        tipo: 'persona' as const,
        id: p.id,
        email: p.email,
        nombre: p.razon_social || [p.apellido, p.nombre].filter(Boolean).join(', '),
        acepta_marketing: p.acepta_marketing !== false,
      })),
      ...leads.map(l => ({
        tipo: 'lead' as const,
        id: l.id,
        email: l.email,
        nombre: [l.apellido, l.nombre].filter(Boolean).join(', '),
      })),
    ]

    for (const dst of cola) {
      // Antes de cada envío, verificar que la campaña no fue pausada/cancelada
      const { data: estadoActual } = await supabase
        .from('mailing_campanas').select('estado').eq('id', c.id).maybeSingle()
      const eAct = (estadoActual as any)?.estado
      if (eAct === 'PAUSADA' || eAct === 'CANCELADA') {
        await (supabase.from('mailing_campanas') as any)
          .update({
            personas_procesadas_ids: Array.from(procesadosTracking),
            enviados, fallidos, excluidos,
          })
          .eq('id', c.id)
        return { ok: true, enviados, fallidos, excluidos, total: totalDestinatarios }
      }

      const trackingId = `${dst.tipo === 'persona' ? 'p' : 'l'}:${dst.id}`

      if (!dst.email) {
        excluidos++
      } else if (dst.tipo === 'persona' && !dst.acepta_marketing) {
        excluidos++
      } else if (emailsBaja.has(dst.email.toLowerCase())) {
        excluidos++
      } else if (enviadosHoy >= limiteDiario) {
        excluidos++
      } else {
        const resultado = await enviarComunicacion({
          plantilla_codigo: 'notificacion_general',
          destinatario: {
            email: dst.email,
            nombre: dst.nombre,
            persona_id: dst.tipo === 'persona' ? dst.id : undefined,
            lead_id: dst.tipo === 'lead' ? dst.id : undefined,
          },
          campos_editables,
          tipo_envio: 'MASIVO',
          enviado_por_usuario_id: c.usuario_creador_id ?? undefined,
        })
        if (resultado.ok) {
          enviados++
          enviadosHoy++
        } else {
          fallidos++
        }
      }

      procesadosTracking.add(trackingId)

      // Persistir métricas cada 3 envíos
      if (procesadosTracking.size % 3 === 0) {
        await (supabase.from('mailing_campanas') as any)
          .update({
            personas_procesadas_ids: Array.from(procesadosTracking),
            enviados, fallidos, excluidos,
          })
          .eq('id', c.id)
      }

      if (delay > 0) await new Promise(r => setTimeout(r, delay))
    }

    // 8) Marcar COMPLETADA con métricas finales
    await marcarCompletada(supabase, c.id, enviados, fallidos, excluidos, Array.from(procesadosTracking))
    return { ok: true, enviados, fallidos, excluidos, total: totalDestinatarios }
  } catch (err: any) {
    logger.error({
      modulo: 'mailings',
      mensaje: 'Error ejecutando campaña',
      contexto: { campana_id, error: String(err) },
    })
    await marcarFallida(supabase, campana_id, err?.message ?? String(err))
    return { ok: false, enviados: 0, fallidos: 0, excluidos: 0, total: 0, error: err?.message ?? 'Error inesperado' }
  }
}

async function marcarCompletada(
  supabase: any,
  id: string,
  enviados: number,
  fallidos: number,
  excluidos: number,
  procesados?: string[],
) {
  const update: any = {
    estado: 'COMPLETADA',
    enviados,
    fallidos,
    excluidos,
    fecha_fin_ejecucion: new Date().toISOString(),
  }
  if (procesados) update.personas_procesadas_ids = procesados
  await (supabase.from('mailing_campanas') as any).update(update).eq('id', id)
}

async function marcarFallida(supabase: any, id: string, error: string) {
  await (supabase.from('mailing_campanas') as any)
    .update({
      estado: 'PAUSADA',
      ultimo_error: error,
      fecha_fin_ejecucion: new Date().toISOString(),
    })
    .eq('id', id)
}
