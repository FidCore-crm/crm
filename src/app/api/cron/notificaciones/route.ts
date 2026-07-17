import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { validarCronSecret } from '@/lib/cron-auth'
import { limpiarTokensExpirados } from '@/lib/storage-tokens'
import { hoyAR } from '@/lib/utils'

// Devuelve la fecha actual en zona horaria Argentina (formato YYYY-MM-DD).
// El cron en producción corre en TZ del servidor (UTC en muchas instalaciones)
// pero las fechas de las cotizaciones (`fecha_envio`, `fecha_vencimiento`,
// `fecha_cierre`) y de las pólizas se manejan en TZ local del PAS. Sin
// `hoyAR()`, entre 21:00 y 23:59 ARG el cron compararía contra el "mañana" UTC
// y notificaría/transicionaría un día antes.
function fechaHoy(): string {
  return hoyAR()
}

function restarDias(dias: number): string {
  // Construimos la fecha base en TZ Argentina y restamos dias.
  const [y, m, d] = hoyAR().split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() - dias)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function diasEntre(fechaStr: string): number {
  const fecha = new Date(fechaStr)
  const hoy = new Date()
  return Math.floor((hoy.getTime() - fecha.getTime()) / (1000 * 60 * 60 * 24))
}

function formatFecha(fechaStr: string): string {
  const [y, m, d] = fechaStr.split('T')[0].split('-')
  return `${d}/${m}/${y}`
}

function nombreCompleto(p: { apellido: string; nombre: string | null } | null): string {
  if (!p) return 'N/N'
  return p.nombre ? `${p.apellido}, ${p.nombre}` : p.apellido
}

// Valores por defecto hardcodeados como fallback
// Criterio de "alerta ≠ listado": las notificaciones son señales para llamar
// la atención sobre algo que requiere ACCIÓN puntual. No son listados de todo
// lo que pasa en el sistema.
//
// - POLIZA_VENCIDA: sí, requiere acción inmediata (renovar tarde o marcar como perdida).
// - POLIZA_POR_VENCER: DESACTIVADA por default (v1.0.136). El PAS recibía spam
//   diario de pólizas que aún no requerían acción. El módulo /crm/renovaciones
//   cubre visualmente el "vence pronto" con sus KPIs. La detección sigue
//   viva pero solo dispara si el admin la reactiva desde configuración.
// - TAREA_VENCIDA: sí, requiere acción (fecha_vencimiento pasó).
// - TAREA_HOY: sí, aviso PROACTIVO el mismo día que vence la tarea (v1.0.136).
//   Antes solo notificaba TAREA_VENCIDA post facto.
// - SINIESTRO estancado: sí a 30/60 días.
// - COTIZACION_VENCIDA: sí — el cliente probablemente perdió interés.
// - COTIZACION_VENCIENDO_PRONTO: sí, para reactivar (3 días antes).
// - Umbrales aumentados donde había ruido: OPORTUNIDAD_ESTANCADA de 15 a 30 días.
// - Anti-spam más largo para reducir alertas repetidas.
const DEFAULTS: Record<string, { activa: boolean; umbral_dias: number | null; antispam_dias: number }> = {
  POLIZA_VENCIDA:                { activa: true,  umbral_dias: null, antispam_dias: 14 },
  POLIZA_POR_VENCER:             { activa: false, umbral_dias: 3,    antispam_dias: 3 },  // v1.0.136: OFF por default
  TAREA_HOY:                     { activa: true,  umbral_dias: 0,    antispam_dias: 1 },  // v1.0.136: aviso el mismo día
  TAREA_VENCIDA:                 { activa: true,  umbral_dias: null, antispam_dias: 7 },
  SINIESTRO_30_DIAS:             { activa: true, umbral_dias: 30,   antispam_dias: 14 },
  SINIESTRO_60_DIAS:             { activa: true, umbral_dias: 60,   antispam_dias: 14 },
  COTIZACION_SIN_RESPUESTA:      { activa: true, umbral_dias: 5,    antispam_dias: 5 },
  COTIZACION_SIN_SEGUIMIENTO:    { activa: true, umbral_dias: 5,    antispam_dias: 5 },
  OPORTUNIDAD_ESTANCADA:         { activa: true, umbral_dias: 30,   antispam_dias: 10 },  // Antes 15 días — muy ruidoso
  COTIZACION_VENCIENDO_PRONTO:   { activa: true, umbral_dias: 3,    antispam_dias: 3 },
  COTIZACION_VENCIDA:            { activa: true, umbral_dias: null, antispam_dias: 10 },
}

export async function GET(request: Request) {
  const authError = await validarCronSecret(request)
  if (authError) return authError

  const supabase = getSupabaseAdmin()
  const hoy = fechaHoy()

  // ── Leer switch general ──
  try {
    const { data: configGeneral } = await supabase
      .from('configuracion')
      .select('notificaciones_activas')
      .limit(1)
      .single()

    if (configGeneral && configGeneral.notificaciones_activas === false) {
      return NextResponse.json({
        ok: true,
        timestamp: new Date().toISOString(),
        desactivado: true,
        mensaje: 'Sistema de notificaciones desactivado',
      })
    }
  } catch {
    // Si falla, continuar con defaults (sistema activo)
  }

  // ── Leer configuración por tipo ──
  type ConfigEntry = { activa: boolean; umbral_dias: number | null; antispam_dias: number }
  const configMap = new Map<string, ConfigEntry>()

  try {
    const { data: configNotifs } = await supabase
      .from('configuracion_notificaciones')
      .select('tipo, activa, umbral_dias, antispam_dias')

    if (configNotifs && configNotifs.length > 0) {
      for (const c of configNotifs as any[]) {
        configMap.set(c.tipo, { activa: c.activa, umbral_dias: c.umbral_dias, antispam_dias: c.antispam_dias })
      }
    }
  } catch {
    // Si la tabla no existe o falla, se usarán defaults
  }

  function getConfig(tipo: string): ConfigEntry {
    return configMap.get(tipo) ?? DEFAULTS[tipo] ?? { activa: true, umbral_dias: null, antispam_dias: 3 }
  }

  const resultados = {
    polizas_vencidas: 0,
    polizas_por_vencer: 0,
    tareas_hoy: 0,
    tareas_vencidas: 0,
    siniestros_30: 0,
    siniestros_60: 0,
    cotizaciones_sin_respuesta: 0,
    cotizaciones_sin_seguimiento: 0,
    oportunidades_estancadas: 0,
    cotizaciones_venciendo_pronto: 0,
    cotizaciones_vencidas: 0,
    errores: [] as string[],
  }

  // ── Helper: cargar IDs de notificaciones recientes por tipo ──
  async function idsNotificados(tipo: string, diasAtras: number): Promise<Set<string>> {
    const desde = restarDias(diasAtras)
    const { data } = await supabase
      .from('notificaciones')
      .select('entidad_id')
      .eq('tipo', tipo)
      .gte('created_at', desde)
    return new Set((data ?? []).map((n: any) => n.entidad_id).filter(Boolean))
  }

  // ── Helper: insertar notificación ──
  async function crear(notif: {
    tipo: string; prioridad: string; titulo: string; mensaje: string;
    entidad_tipo: string; entidad_id: string; url: string;
    usuario_id?: string | null;
  }) {
    const { error } = await supabase.from('notificaciones').insert(notif)
    if (error) resultados.errores.push(`Insert ${notif.tipo} ${notif.entidad_id}: ${error.message}`)
  }

  // ══════════════════════════════════════════════════════════════
  // 1. PÓLIZAS VENCIDAS SIN RENOVACIÓN
  // ══════════════════════════════════════════════════════════════
  try {
    const cfgPolVenc = getConfig('POLIZA_VENCIDA')
    if (!cfgPolVenc.activa) throw { skip: true }
    const yaNotificadas = await idsNotificados('POLIZA_VENCIDA', cfgPolVenc.antispam_dias)

    // Pólizas efectivamente vencidas: NO_VIGENTE + VIGENTE con fecha_fin < hoy
    // (últimas son las que el cron de pólizas aún no movió a NO_VIGENTE).
    // Excluimos las cuyo asegurado está en papelera (deleted_at IS NOT NULL).
    const { data: vencidas } = await supabase
      .from('polizas')
      .select('id, numero_poliza, fecha_fin, estado, asegurado:personas!asegurado_id(apellido, nombre, usuario_id, deleted_at)')
      .or(`estado.eq.NO_VIGENTE,and(estado.eq.VIGENTE,fecha_fin.lt.${hoy})`)
      .lt('fecha_fin', hoy)

    if (vencidas && vencidas.length > 0) {
      // IDs que tienen una renovación ACTIVA (RENOVADA latente, VIGENTE o PROGRAMADA).
      // Las hijas canceladas/anuladas se eliminan en /cancelar y /anular, así que
      // no figuran. Si quedaron en NO_VIGENTE, no cuentan como "tiene renovación".
      const ids = vencidas.map((p: any) => p.id)
      const { data: conRenovacion } = await supabase
        .from('polizas')
        .select('poliza_origen_id')
        .in('poliza_origen_id', ids)
        .in('estado', ['RENOVADA', 'VIGENTE', 'PROGRAMADA'])

      const idsConRen = new Set((conRenovacion ?? []).map((r: any) => r.poliza_origen_id))

      for (const p of vencidas as any[]) {
        if (p.asegurado?.deleted_at) continue
        if (idsConRen.has(p.id)) continue
        if (yaNotificadas.has(p.id)) continue

        await crear({
          tipo: 'POLIZA_VENCIDA',
          prioridad: 'CRITICA',
          titulo: 'Póliza vencida sin renovar',
          mensaje: `La póliza #${p.numero_poliza} de ${nombreCompleto(p.asegurado)} venció el ${formatFecha(p.fecha_fin)} y no tiene renovación.`,
          entidad_tipo: 'poliza',
          entidad_id: p.id,
          url: `/crm/renovaciones/${p.id}`,
          usuario_id: p.asegurado?.usuario_id ?? null,
        })
        resultados.polizas_vencidas++
      }
    }
  } catch (e: any) {
    if (!e?.skip) resultados.errores.push(`polizas_vencidas: ${e.message}`)
  }

  // ══════════════════════════════════════════════════════════════
  // 1b. PÓLIZAS POR VENCER — SOLO CASOS URGENTES (≤3 días por default)
  //
  // Criterio: las notificaciones son ALERTAS puntuales, no un listado de
  // todo. Antes disparaba para pólizas que vencían en hasta 30 días — el
  // PAS recibía 30+ notificaciones por mes de pólizas que no requerían
  // acción inmediata. Los KPIs y filtros de /crm/renovaciones ya cubren
  // ese caso visualmente.
  //
  // Ahora solo dispara si la póliza vence en ≤ umbral_dias (default 3).
  // Siempre prioridad CRITICA — si el PAS ve esto es porque hay que
  // gestionar YA.
  // ══════════════════════════════════════════════════════════════
  try {
    const cfgPolPor = getConfig('POLIZA_POR_VENCER')
    if (!cfgPolPor.activa) throw { skip: true }
    const umbralDias = cfgPolPor.umbral_dias ?? 3
    const yaNotificadas = await idsNotificados('POLIZA_POR_VENCER', cfgPolPor.antispam_dias)

    const fechaLimite = new Date()
    fechaLimite.setDate(fechaLimite.getDate() + umbralDias)
    const fechaLimiteStr = `${fechaLimite.getFullYear()}-${String(fechaLimite.getMonth()+1).padStart(2,'0')}-${String(fechaLimite.getDate()).padStart(2,'0')}`

    const { data: proximas } = await supabase
      .from('polizas')
      .select('id, numero_poliza, fecha_fin, asegurado:personas!asegurado_id(apellido, nombre, usuario_id, deleted_at)')
      .eq('estado', 'VIGENTE')
      .gte('fecha_fin', hoy)
      .lte('fecha_fin', fechaLimiteStr)

    if (proximas && proximas.length > 0) {
      const ids = proximas.map((p: any) => p.id)
      const { data: conRenovacion } = await supabase
        .from('polizas')
        .select('poliza_origen_id')
        .in('poliza_origen_id', ids)
        .in('estado', ['RENOVADA', 'VIGENTE', 'PROGRAMADA'])
      const idsConRen = new Set((conRenovacion ?? []).map((r: any) => r.poliza_origen_id))

      const hoyDate = new Date()
      hoyDate.setHours(0, 0, 0, 0)

      for (const p of proximas as any[]) {
        if (p.asegurado?.deleted_at) continue
        if (idsConRen.has(p.id)) continue
        if (yaNotificadas.has(p.id)) continue

        const [y, m, d] = p.fecha_fin.split('-').map(Number)
        const fechaFin = new Date(y, m - 1, d)
        const diasRestantes = Math.max(0, Math.round((fechaFin.getTime() - hoyDate.getTime()) / 86400000))

        const cuantos = diasRestantes === 0 ? 'HOY' : diasRestantes === 1 ? 'mañana' : `en ${diasRestantes} días`
        await crear({
          tipo: 'POLIZA_POR_VENCER',
          prioridad: 'CRITICA',
          titulo: 'Póliza vence pronto',
          mensaje: `La póliza #${p.numero_poliza} de ${nombreCompleto(p.asegurado)} vence ${cuantos} (${formatFecha(p.fecha_fin)}). Sin renovación creada.`,
          entidad_tipo: 'poliza',
          entidad_id: p.id,
          url: `/crm/renovaciones/${p.id}`,
          usuario_id: p.asegurado?.usuario_id ?? null,
        })
        resultados.polizas_por_vencer++
      }
    }
  } catch (e: any) {
    if (!e?.skip) resultados.errores.push(`polizas_por_vencer: ${e.message}`)
  }

  // ══════════════════════════════════════════════════════════════
  // 2a. TAREAS QUE VENCEN HOY (aviso proactivo, v1.0.136)
  //
  // Dispara UNA VEZ el mismo día que la tarea vence, para que el PAS se
  // entere temprano. Antes solo llegaba la notificación POST-vencimiento.
  // Anti-spam de 1 día evita re-notificar la misma tarea en las corridas
  // subsecuentes del cron (cada 2h).
  // ══════════════════════════════════════════════════════════════
  try {
    const cfgTareaHoy = getConfig('TAREA_HOY')
    if (!cfgTareaHoy.activa) throw { skip: true }
    const yaNotificadas = await idsNotificados('TAREA_HOY', cfgTareaHoy.antispam_dias)

    const { data: tareasHoy } = await supabase
      .from('tareas')
      .select('id, titulo, fecha_vencimiento, hora_vencimiento, usuario_id, persona:personas!persona_id(deleted_at)')
      .in('estado', ['PENDIENTE', 'EN_PROCESO'])
      .eq('fecha_vencimiento', hoy)

    for (const t of (tareasHoy ?? []) as any[]) {
      if (t.persona?.deleted_at) continue
      if (yaNotificadas.has(t.id)) continue

      const detalleHora = t.hora_vencimiento ? ` a las ${String(t.hora_vencimiento).slice(0, 5)}` : ''
      await crear({
        tipo: 'TAREA_HOY',
        prioridad: 'ADVERTENCIA',
        titulo: 'Tarea para hoy',
        mensaje: `Hoy${detalleHora}: '${t.titulo}'.`,
        entidad_tipo: 'tarea',
        entidad_id: t.id,
        url: `/crm/tareas/${t.id}`,
        usuario_id: t.usuario_id ?? null,
      })
      resultados.tareas_hoy++
    }
  } catch (e: any) {
    if (!e?.skip) resultados.errores.push(`tareas_hoy: ${e.message}`)
  }

  // ══════════════════════════════════════════════════════════════
  // 2b. TAREAS VENCIDAS SIN COMPLETAR
  // ══════════════════════════════════════════════════════════════
  try {
    const cfgTareas = getConfig('TAREA_VENCIDA')
    if (!cfgTareas.activa) throw { skip: true }
    const yaNotificadas = await idsNotificados('TAREA_VENCIDA', cfgTareas.antispam_dias)

    // Traemos persona.deleted_at para descartar tareas de personas en papelera.
    const { data: tareas } = await supabase
      .from('tareas')
      .select('id, titulo, fecha_vencimiento, usuario_id, persona:personas!persona_id(deleted_at)')
      .in('estado', ['PENDIENTE', 'EN_PROCESO'])
      .lt('fecha_vencimiento', hoy)

    for (const t of (tareas ?? []) as any[]) {
      if (t.persona?.deleted_at) continue
      if (yaNotificadas.has(t.id)) continue

      await crear({
        tipo: 'TAREA_VENCIDA',
        prioridad: 'ADVERTENCIA',
        titulo: 'Tarea vencida',
        mensaje: `La tarea '${t.titulo}' venció el ${formatFecha(t.fecha_vencimiento)} y no fue completada.`,
        entidad_tipo: 'tarea',
        entidad_id: t.id,
        url: `/crm/tareas/${t.id}`,
        usuario_id: t.usuario_id ?? null,
      })
      resultados.tareas_vencidas++
    }
  } catch (e: any) {
    if (!e?.skip) resultados.errores.push(`tareas_vencidas: ${e.message}`)
  }

  // ══════════════════════════════════════════════════════════════
  // 3 + 4. SINIESTROS ABIERTOS (escalonado 30 / 60 días)
  //
  // Filtros aplicados a ambos:
  //  - estado no terminal
  //  - siniestro vivo (deleted_at IS NULL — papelera tras migración 027)
  //  - persona vivo (deleted_at IS NULL — papelera tras migración 025)
  //
  // Dedup cruzado: si en los últimos `antispam_dias` ya se notificó al PAS
  // sobre el mismo caso (de cualquiera de los dos tipos), no se envía otro
  // aviso. Evita doble alerta cuando los umbrales se solapan por
  // configuración (admin baja umbral 60 a 45, etc.) y mantiene una sola
  // notificación reciente por caso.
  // ══════════════════════════════════════════════════════════════
  let yaNotifSiniestrosAny: Set<string> | null = null
  try {
    const cfgSin30 = getConfig('SINIESTRO_30_DIAS')
    const cfgSin60 = getConfig('SINIESTRO_60_DIAS')
    const ventana = Math.max(cfgSin30.antispam_dias, cfgSin60.antispam_dias)
    const [n30, n60] = await Promise.all([
      idsNotificados('SINIESTRO_30_DIAS', ventana),
      idsNotificados('SINIESTRO_60_DIAS', ventana),
    ])
    yaNotifSiniestrosAny = new Set<string>(Array.from(n30).concat(Array.from(n60)))
  } catch {
    yaNotifSiniestrosAny = new Set()
  }

  try {
    const cfgSin30 = getConfig('SINIESTRO_30_DIAS')
    if (!cfgSin30.activa) throw { skip: true }
    const umbral30 = cfgSin30.umbral_dias ?? 30
    const umbral60 = getConfig('SINIESTRO_60_DIAS').umbral_dias ?? 60
    const hace30 = restarDias(umbral30)
    const hace60 = restarDias(umbral60)

    const { data: siniestros } = await supabase
      .from('siniestros')
      .select('id, numero_caso, fecha_denuncia, persona:personas!persona_id(apellido, nombre, usuario_id, deleted_at)')
      .not('estado', 'in', '("FINALIZADO","RECHAZADO")')
      .is('deleted_at', null)
      .lt('fecha_denuncia', hace30)
      .gte('fecha_denuncia', hace60)

    for (const s of (siniestros ?? []) as any[]) {
      if (s.persona?.deleted_at) continue
      if (yaNotifSiniestrosAny!.has(s.id)) continue
      const dias = diasEntre(s.fecha_denuncia)

      await crear({
        tipo: 'SINIESTRO_30_DIAS',
        prioridad: 'ADVERTENCIA',
        titulo: `Siniestro abierto hace más de ${umbral30} días`,
        mensaje: `El caso #${s.numero_caso ?? 'S/N'} de ${nombreCompleto(s.persona)} lleva ${dias} días abierto.`,
        entidad_tipo: 'siniestro',
        entidad_id: s.id,
        url: `/crm/siniestros/${s.id}`,
        usuario_id: s.persona?.usuario_id ?? null,
      })
      resultados.siniestros_30++
    }
  } catch (e: any) {
    if (!e?.skip) resultados.errores.push(`siniestros_30: ${e.message}`)
  }

  try {
    const cfgSin60 = getConfig('SINIESTRO_60_DIAS')
    if (!cfgSin60.activa) throw { skip: true }
    const umbral60 = cfgSin60.umbral_dias ?? 60
    const hace60 = restarDias(umbral60)

    const { data: siniestros } = await supabase
      .from('siniestros')
      .select('id, numero_caso, fecha_denuncia, persona:personas!persona_id(apellido, nombre, usuario_id, deleted_at)')
      .not('estado', 'in', '("FINALIZADO","RECHAZADO")')
      .is('deleted_at', null)
      .lt('fecha_denuncia', hace60)

    for (const s of (siniestros ?? []) as any[]) {
      if (s.persona?.deleted_at) continue
      if (yaNotifSiniestrosAny!.has(s.id)) continue
      const dias = diasEntre(s.fecha_denuncia)

      await crear({
        tipo: 'SINIESTRO_60_DIAS',
        prioridad: 'CRITICA',
        titulo: `URGENTE: Siniestro abierto hace más de ${umbral60} días`,
        mensaje: `El caso #${s.numero_caso ?? 'S/N'} de ${nombreCompleto(s.persona)} lleva ${dias} días abierto. Requiere atención inmediata.`,
        entidad_tipo: 'siniestro',
        entidad_id: s.id,
        url: `/crm/siniestros/${s.id}`,
        usuario_id: s.persona?.usuario_id ?? null,
      })
      resultados.siniestros_60++
    }
  } catch (e: any) {
    if (!e?.skip) resultados.errores.push(`siniestros_60: ${e.message}`)
  }

  // ══════════════════════════════════════════════════════════════
  // 5. COTIZACIONES ENVIADAS SIN RESPUESTA (+5 días)
  // ══════════════════════════════════════════════════════════════
  try {
    const cfgCotResp = getConfig('COTIZACION_SIN_RESPUESTA')
    if (!cfgCotResp.activa) throw { skip: true }
    const yaNotificadas = await idsNotificados('COTIZACION_SIN_RESPUESTA', cfgCotResp.antispam_dias)
    const hace5 = restarDias(cfgCotResp.umbral_dias ?? 5)

    const { data: cotizaciones } = await supabase
      .from('cotizaciones')
      .select('id, numero_cotizacion, fecha_envio, usuario_id, persona:personas!persona_id(apellido, nombre, deleted_at), lead:leads!lead_id(nombre, apellido)')
      .eq('estado', 'ENVIADA')
      .lt('fecha_envio', hace5)

    for (const c of (cotizaciones ?? []) as any[]) {
      if (c.persona?.deleted_at) continue
      if (yaNotificadas.has(c.id)) continue
      const dias = diasEntre(c.fecha_envio)
      const dest = c.persona ? nombreCompleto(c.persona) : c.lead ? nombreCompleto(c.lead) : 'N/N'

      await crear({
        tipo: 'COTIZACION_SIN_RESPUESTA',
        prioridad: 'ADVERTENCIA',
        titulo: 'Cotización sin respuesta',
        mensaje: `La cotización #${c.numero_cotizacion} para ${dest} fue enviada hace ${dias} días y no tuvo respuesta.`,
        entidad_tipo: 'cotizacion',
        entidad_id: c.id,
        url: `/crm/comercial/cotizaciones/${c.id}`,
        usuario_id: c.usuario_id ?? null,
      })
      resultados.cotizaciones_sin_respuesta++
    }
  } catch (e: any) {
    if (!e?.skip) {
      // Tabla cotizaciones puede no existir aún (módulo comercial pendiente)
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 6. COTIZACIONES EN PROCESO SIN SEGUIMIENTO (+3 días)
  // ══════════════════════════════════════════════════════════════
  try {
    const cfgCotSeg = getConfig('COTIZACION_SIN_SEGUIMIENTO')
    if (!cfgCotSeg.activa) throw { skip: true }
    const yaNotificadas = await idsNotificados('COTIZACION_SIN_SEGUIMIENTO', cfgCotSeg.antispam_dias)
    const hace3 = restarDias(cfgCotSeg.umbral_dias ?? 3)

    const { data: cotizaciones } = await supabase
      .from('cotizaciones')
      .select('id, numero_cotizacion, updated_at, usuario_id, persona:personas!persona_id(apellido, nombre, deleted_at), lead:leads!lead_id(nombre, apellido)')
      .eq('estado', 'EN_PROCESO')
      .lt('updated_at', hace3)

    for (const c of (cotizaciones ?? []) as any[]) {
      if (c.persona?.deleted_at) continue
      if (yaNotificadas.has(c.id)) continue
      const dias = diasEntre(c.updated_at)
      const dest = c.persona ? nombreCompleto(c.persona) : c.lead ? nombreCompleto(c.lead) : 'N/N'

      await crear({
        tipo: 'COTIZACION_SIN_SEGUIMIENTO',
        prioridad: 'ADVERTENCIA',
        titulo: 'Cotización sin seguimiento',
        mensaje: `La cotización #${c.numero_cotizacion} para ${dest} está en proceso hace ${dias} días sin seguimiento.`,
        entidad_tipo: 'cotizacion',
        entidad_id: c.id,
        url: `/crm/comercial/cotizaciones/${c.id}`,
        usuario_id: c.usuario_id ?? null,
      })
      resultados.cotizaciones_sin_seguimiento++
    }
  } catch (e: any) {
    if (!e?.skip) {
      // Tabla cotizaciones puede no existir aún
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 7. OPORTUNIDADES ESTANCADAS
  // ══════════════════════════════════════════════════════════════
  try {
    const cfgOport = getConfig('OPORTUNIDAD_ESTANCADA')
    if (!cfgOport.activa) throw { skip: true }
    const yaNotificadas = await idsNotificados('OPORTUNIDAD_ESTANCADA', cfgOport.antispam_dias)
    const hace15 = restarDias(cfgOport.umbral_dias ?? 15)

    // Oportunidades sin movimiento hace 15+ días
    const { data: sinMov } = await supabase
      .from('oportunidades')
      .select('id, updated_at, fecha_proximo_contacto, usuario_id, persona:personas!persona_id(apellido, nombre, deleted_at)')
      .not('estado', 'in', '("GANADA","PERDIDA")')
      .lt('updated_at', hace15)

    // Oportunidades con fecha_proximo_contacto pasada
    const { data: contactoVencido } = await supabase
      .from('oportunidades')
      .select('id, updated_at, fecha_proximo_contacto, usuario_id, persona:personas!persona_id(apellido, nombre, deleted_at)')
      .not('estado', 'in', '("GANADA","PERDIDA")')
      .not('fecha_proximo_contacto', 'is', null)
      .lt('fecha_proximo_contacto', hoy)

    // Unificar por ID (evitar duplicados si aparece en ambas queries)
    const mapa = new Map<string, any>()
    for (const o of (sinMov ?? []) as any[]) mapa.set(o.id, { ...o, razon: 'sin_movimiento' })
    for (const o of (contactoVencido ?? []) as any[]) {
      if (mapa.has(o.id)) {
        mapa.get(o.id).razon = 'contacto_vencido' // priorizar esta razón
      } else {
        mapa.set(o.id, { ...o, razon: 'contacto_vencido' })
      }
    }

    for (const o of Array.from(mapa.values())) {
      if (o.persona?.deleted_at) continue
      if (yaNotificadas.has(o.id)) continue
      const nombre = nombreCompleto(o.persona)

      let mensaje: string
      if (o.razon === 'contacto_vencido' && o.fecha_proximo_contacto) {
        mensaje = `La oportunidad con ${nombre} tenía contacto programado para el ${formatFecha(o.fecha_proximo_contacto)} y no se realizó.`
      } else {
        const dias = diasEntre(o.updated_at)
        mensaje = `La oportunidad con ${nombre} lleva ${dias} días sin movimiento.`
      }

      await crear({
        tipo: 'OPORTUNIDAD_ESTANCADA',
        prioridad: 'ADVERTENCIA',
        titulo: 'Oportunidad estancada',
        mensaje,
        entidad_tipo: 'oportunidad',
        entidad_id: o.id,
        url: `/crm/comercial/oportunidades/${o.id}`,
        usuario_id: o.usuario_id ?? null,
      })
      resultados.oportunidades_estancadas++
    }
  } catch (e: any) {
    if (!e?.skip) {
      // Tabla oportunidades puede no existir aún
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 8. COTIZACIONES VENCIENDO PRONTO (entre hoy y hoy+3 días)
  // ══════════════════════════════════════════════════════════════
  try {
    const cfgCotVP = getConfig('COTIZACION_VENCIENDO_PRONTO')
    if (!cfgCotVP.activa) throw { skip: true }
    const yaNotificadas = await idsNotificados('COTIZACION_VENCIENDO_PRONTO', cfgCotVP.antispam_dias)
    const ventana = cfgCotVP.umbral_dias ?? 3
    const futuro = new Date()
    futuro.setDate(futuro.getDate() + ventana)
    const futuroStr = futuro.toISOString().split('T')[0]

    const { data: cotizaciones } = await supabase
      .from('cotizaciones')
      .select('id, numero_cotizacion, fecha_vencimiento, usuario_id, persona:personas!persona_id(apellido, nombre, deleted_at), lead:leads!lead_id(nombre, apellido)')
      .in('estado', ['ENVIADA', 'EN_PROCESO'])
      .gte('fecha_vencimiento', hoy)
      .lte('fecha_vencimiento', futuroStr)

    for (const c of (cotizaciones ?? []) as any[]) {
      if (c.persona?.deleted_at) continue
      if (yaNotificadas.has(c.id)) continue
      const dest = c.persona ? nombreCompleto(c.persona) : c.lead ? nombreCompleto(c.lead) : 'N/N'
      const fv = new Date(c.fecha_vencimiento + 'T00:00:00')
      const hh = new Date(hoy + 'T00:00:00')
      const diasR = Math.max(0, Math.round((fv.getTime() - hh.getTime()) / (1000 * 60 * 60 * 24)))

      await crear({
        tipo: 'COTIZACION_VENCIENDO_PRONTO',
        prioridad: 'ADVERTENCIA',
        titulo: 'Cotización por vencer',
        mensaje: `La cotización #${c.numero_cotizacion} de ${dest} vence en ${diasR} día${diasR === 1 ? '' : 's'}.`,
        entidad_tipo: 'cotizacion',
        entidad_id: c.id,
        url: `/crm/comercial/cotizaciones/${c.id}`,
        usuario_id: c.usuario_id ?? null,
      })
      resultados.cotizaciones_venciendo_pronto++
    }
  } catch (e: any) {
    if (!e?.skip) {
      // Tabla o columna puede no existir
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 9. COTIZACIONES VENCIDAS
  // ══════════════════════════════════════════════════════════════
  try {
    const cfgCotV = getConfig('COTIZACION_VENCIDA')
    if (!cfgCotV.activa) throw { skip: true }
    const yaNotificadas = await idsNotificados('COTIZACION_VENCIDA', cfgCotV.antispam_dias)

    const { data: cotizaciones } = await supabase
      .from('cotizaciones')
      .select('id, numero_cotizacion, fecha_vencimiento, usuario_id, persona:personas!persona_id(apellido, nombre, deleted_at), lead:leads!lead_id(nombre, apellido)')
      .in('estado', ['ENVIADA', 'EN_PROCESO'])
      .lt('fecha_vencimiento', hoy)

    for (const c of (cotizaciones ?? []) as any[]) {
      if (c.persona?.deleted_at) continue
      if (yaNotificadas.has(c.id)) continue
      const dest = c.persona ? nombreCompleto(c.persona) : c.lead ? nombreCompleto(c.lead) : 'N/N'

      await crear({
        tipo: 'COTIZACION_VENCIDA',
        prioridad: 'ADVERTENCIA',
        titulo: 'Cotización vencida',
        mensaje: `La cotización #${c.numero_cotizacion} de ${dest} venció. Considerá renovarla o cerrarla.`,
        entidad_tipo: 'cotizacion',
        entidad_id: c.id,
        url: `/crm/comercial/cotizaciones/${c.id}`,
        usuario_id: c.usuario_id ?? null,
      })
      resultados.cotizaciones_vencidas++
    }
  } catch (e: any) {
    if (!e?.skip) {
      // Tabla o columna puede no existir
    }
  }

  // ══════════════════════════════════════════════════════════════
  // LIMPIEZA: Eliminar notificaciones leídas con +30 días
  // ══════════════════════════════════════════════════════════════
  let limpieza = { eliminadas: 0 }
  try {
    const hace30 = restarDias(30)
    const { data, error } = await supabase
      .from('notificaciones')
      .delete()
      .eq('leida', true)
      .lt('created_at', hace30)
      .select('id')

    if (error) {
      resultados.errores.push(`limpieza: ${error.message}`)
    } else {
      limpieza.eliminadas = data?.length ?? 0
    }
  } catch (e: any) {
    resultados.errores.push(`limpieza: ${e.message}`)
  }

  // Limpieza: tokens de storage expirados
  let tokens_expirados = 0
  try {
    tokens_expirados = await limpiarTokensExpirados()
  } catch (e: any) {
    resultados.errores.push(`limpieza_tokens: ${e?.message || 'error'}`)
  }

  // Limpieza: rate-limit buckets viejos (>1h expirados)
  let rate_limit_buckets_eliminados = 0
  try {
    const corte = new Date(Date.now() - 3600_000).toISOString()
    const { data, error } = await supabase
      .from('rate_limit_buckets')
      .delete()
      .lt('reset_at', corte)
      .select('id')
    if (error) {
      resultados.errores.push(`limpieza_rate_limit: ${error.message}`)
    } else {
      rate_limit_buckets_eliminados = data?.length ?? 0
    }
  } catch (e: any) {
    resultados.errores.push(`limpieza_rate_limit: ${e?.message || 'error'}`)
  }

  return NextResponse.json({
    ok: resultados.errores.length === 0,
    timestamp: new Date().toISOString(),
    notificaciones_creadas: resultados,
    limpieza,
    tokens_expirados_eliminados: tokens_expirados,
    rate_limit_buckets_eliminados,
  })
}
