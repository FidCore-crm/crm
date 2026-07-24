/**
 * POST /api/comunicaciones/wizard-enviar
 *
 * Endpoint unificado del wizard de envío. Resuelve los destinatarios (lista
 * manual / audiencia guardada / filtro ad-hoc / individual), arma el mensaje
 * (plantilla de mailing o textos libres) y dispara el envío usando el motor
 * existente (`enviarComunicacion`).
 *
 * Internamente usa la plantilla base `notificacion_general` con campos
 * editables override — así reutilizamos toda la infraestructura de cola,
 * anti-spam, bajas, tracking, sin duplicar lógica.
 *
 * Body (FormData):
 *   destinatarios_tipo:    'lista' | 'audiencia' | 'filtro' | 'individual'
 *   persona_ids:           JSON string (si tipo=lista o individual)
 *   audiencia_id:          UUID (si tipo=audiencia)
 *   filtro_jsonb:          JSON string (si tipo=filtro)
 *   mensaje_tipo:          'mailing_plantilla' | 'libre'
 *   mailing_plantilla_id:  UUID (si tipo=mailing_plantilla)
 *   asunto:                string (si tipo=libre o override)
 *   cuerpo:                string (si tipo=libre)
 *   archivos:              File[] (opcional)
 *
 * Admin-only.
 */

import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { enviarComunicacion, encolarEmail } from '@/lib/comunicaciones-sender'
import { checkLicenciaActiva } from '@/lib/licencia-guard'
import { aplicarFiltroAudiencia } from '@/lib/mailings/audiencia-filtros'

const MAX_DESTINATARIOS = 1000

export async function POST(request: NextRequest) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  if (usuario.rol !== 'ADMIN') {
    return NextResponse.json({ ok: false, error: 'Solo administradores pueden hacer envíos' }, { status: 403 })
  }

  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo

  try {
    const supabase = getSupabaseAdmin()
    const formData = await request.formData()

    const destinatarios_tipo = formData.get('destinatarios_tipo') as string
    const mensaje_tipo = formData.get('mensaje_tipo') as string

    // ── 1) Resolver destinatarios (personas + leads) ──────────
    let persona_ids: string[] = []
    let lead_ids: string[] = []

    if (destinatarios_tipo === 'lista' || destinatarios_tipo === 'individual') {
      const raw = formData.get('persona_ids') as string
      persona_ids = raw ? JSON.parse(raw) : []
      const rawLeads = formData.get('lead_ids') as string
      lead_ids = rawLeads ? JSON.parse(rawLeads) : []
    } else if (destinatarios_tipo === 'audiencia') {
      const audiencia_id = formData.get('audiencia_id') as string
      if (!audiencia_id) return NextResponse.json({ ok: false, error: 'Falta audiencia_id' }, { status: 400 })
      const { data: aud } = await supabase
        .from('mailing_audiencias').select('*').eq('id', audiencia_id).maybeSingle()
      if (!aud) return NextResponse.json({ ok: false, error: 'Audiencia no encontrada' }, { status: 404 })
      const a = aud as any
      if (a.tipo === 'MANUAL') {
        persona_ids = (a.ids_personas ?? []) as string[]
        lead_ids = (a.ids_leads ?? []) as string[]
      } else {
        const res = await aplicarFiltroAudiencia(supabase, a.filtro_jsonb ?? {}, { tamano_muestra: 0 })
        persona_ids = res.ids
        lead_ids = res.leads_ids ?? []
      }
    } else if (destinatarios_tipo === 'filtro') {
      const raw = formData.get('filtro_jsonb') as string
      const filtro = raw ? JSON.parse(raw) : {}
      const res = await aplicarFiltroAudiencia(supabase, filtro, { tamano_muestra: 0 })
      persona_ids = res.ids
      lead_ids = res.leads_ids ?? []
    } else {
      return NextResponse.json({ ok: false, error: 'destinatarios_tipo inválido' }, { status: 400 })
    }

    if (persona_ids.length === 0 && lead_ids.length === 0) {
      return NextResponse.json({ ok: false, error: 'No hay destinatarios' }, { status: 400 })
    }
    if (persona_ids.length + lead_ids.length > MAX_DESTINATARIOS) {
      return NextResponse.json(
        { ok: false, error: `Máximo ${MAX_DESTINATARIOS} destinatarios por envío` },
        { status: 400 }
      )
    }

    // ── 2) Resolver textos del mensaje ────────────────────────
    // Usamos `notificacion_general` como plantilla base. Pasamos:
    //   - `titulo` (asunto del email)
    //   - `cuerpo_mensaje` (cuerpo principal)
    //   - `cta_texto` y `cta_url` (botón opcional)
    //
    // El saludo ("Hola {{nombre}}!") y el cierre ("Saludos, {{organizacion_nombre}}")
    // vienen del template base y no son override-ables hoy. Si una mailing_plantilla
    // define saludo/cierre custom, los incluimos al principio/final del cuerpo
    // (workaround). Si difieren del default los anexamos; si son iguales no hacemos nada
    // para evitar duplicación visual.
    let asunto: string = ''
    let cuerpoFinal: string = ''
    let cta_texto: string | undefined = undefined
    let cta_url: string | undefined = undefined

    const SALUDO_DEFAULT = 'Hola {{nombre}}!'
    const CIERRE_DEFAULT = 'Saludos,\n{{organizacion_nombre}}'

    if (mensaje_tipo === 'mailing_plantilla') {
      const mailing_plantilla_id = formData.get('mailing_plantilla_id') as string
      if (!mailing_plantilla_id) {
        return NextResponse.json({ ok: false, error: 'Falta mailing_plantilla_id' }, { status: 400 })
      }
      const { data: mp } = await supabase
        .from('mailing_plantillas').select('*').eq('id', mailing_plantilla_id).maybeSingle()
      if (!mp) return NextResponse.json({ ok: false, error: 'Plantilla no encontrada' }, { status: 404 })
      const p = mp as any

      asunto = ((formData.get('asunto') as string) || p.asunto || '').trim()
      cuerpoFinal = p.cuerpo

      // Si saludo/cierre custom difieren del default, anexar al cuerpo
      if (p.saludo && p.saludo.trim() !== SALUDO_DEFAULT) {
        cuerpoFinal = `${p.saludo}\n\n${cuerpoFinal}`
      }
      if (p.cierre && p.cierre.trim() !== CIERRE_DEFAULT) {
        cuerpoFinal = `${cuerpoFinal}\n\n${p.cierre}`
      }

      cta_texto = p.cta_texto ?? undefined
      cta_url = p.cta_url ?? undefined
    } else if (mensaje_tipo === 'libre') {
      asunto = (formData.get('asunto') as string)?.trim() || ''
      cuerpoFinal = (formData.get('cuerpo') as string)?.trim() || ''
      if (!asunto || !cuerpoFinal) {
        return NextResponse.json({ ok: false, error: 'Asunto y cuerpo son obligatorios en modo libre' }, { status: 400 })
      }
      // Botón CTA opcional en modo libre (v1.0.141)
      const ctaTextoLibre = (formData.get('cta_texto_libre') as string)?.trim()
      const ctaUrlLibre = (formData.get('cta_url_libre') as string)?.trim()
      if (ctaTextoLibre && ctaUrlLibre) {
        cta_texto = ctaTextoLibre
        cta_url = ctaUrlLibre
      }
    } else {
      return NextResponse.json({ ok: false, error: 'mensaje_tipo inválido' }, { status: 400 })
    }

    // ── 3) campos_editables para enviarComunicacion ───────────
    // El sender mapea: titulo → {{titulo}} y cuerpo → {{cuerpo_mensaje}}
    const campos_editables: Record<string, any> = {
      titulo: asunto,
      cuerpo: cuerpoFinal,
    }
    if (cta_texto && cta_url) {
      campos_editables.cta_texto = cta_texto
      campos_editables.cta_url = cta_url
    }

    // ── 4) Adjuntos: individual → /tmp, masivo → storage/campanas/{id} ─
    // Para individual (síncrono) usamos /tmp que es efímero. Para masivo (async)
    // los archivos tienen que sobrevivir al request hasta que el cron los procese
    // (puede tardar minutos, o días si es programado). Los movemos a storage/
    // usando el id de la campaña padre como carpeta única.
    const archivos = formData.getAll('archivos') as File[]

    // Validar programada_para (opcional). Debe ser al menos 1 min en el futuro.
    const programada_para_raw = formData.get('programada_para') as string | null
    let programadaPara: Date | null = null
    if (programada_para_raw) {
      const parsed = new Date(programada_para_raw)
      if (isNaN(parsed.getTime())) {
        return NextResponse.json({ ok: false, error: 'programada_para inválida' }, { status: 400 })
      }
      if (parsed.getTime() < Date.now() + 60_000) {
        return NextResponse.json({ ok: false, error: 'La fecha programada debe ser al menos 1 minuto en el futuro' }, { status: 400 })
      }
      programadaPara = parsed
    }

    // ── 5) Obtener personas + leads + chequeos previos ────────
    const { data: personas } = persona_ids.length > 0
      ? await supabase
          .from('personas')
          .select('id, nombre, apellido, razon_social, email, acepta_marketing')
          .in('id', persona_ids)
          .is('deleted_at', null)
      : { data: [] }
    const listaPersonas = (personas ?? []) as any[]

    const { data: leads } = lead_ids.length > 0
      ? await supabase
          .from('leads')
          .select('id, nombre, apellido, email')
          .in('id', lead_ids)
      : { data: [] }
    const listaLeads = (leads ?? []) as any[]

    if (listaPersonas.length === 0 && listaLeads.length === 0) {
      return NextResponse.json({ ok: false, error: 'No se encontraron destinatarios activos' }, { status: 400 })
    }

    const emails = [
      ...listaPersonas.filter(p => p.email).map(p => p.email.toLowerCase()),
      ...listaLeads.filter(l => l.email).map(l => l.email.toLowerCase()),
    ]
    const { data: bajasData } = emails.length > 0
      ? await supabase.from('email_bajas').select('email').in('email', emails)
      : { data: [] }
    const emailsBaja = new Set((bajasData ?? []).map((b: any) => b.email))

    // Config para límite diario + delay
    const { data: comConfig } = await supabase
      .from('configuracion_comunicaciones')
      .select('activo, limite_diario, delay_entre_envios_ms')
      .limit(1)
      .maybeSingle()
    const config = comConfig as any
    if (!config?.activo) {
      return NextResponse.json(
        { ok: false, error: 'El sistema de comunicaciones no está activo. Revisá Configuración → Comunicaciones.' },
        { status: 400 }
      )
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

    // ── 6) Loop de envío (personas + leads unificados) ────────
    const detalle: Array<{ id: string; tipo: 'persona' | 'lead'; nombre: string; estado: string; error?: string }> = []
    let enviados = 0, fallidos = 0, excluidos = 0

    type Dst =
      | { tipo: 'persona'; id: string; email: string | null; nombre: string; acepta_marketing: boolean }
      | { tipo: 'lead'; id: string; email: string | null; nombre: string }
    const cola: Dst[] = [
      ...listaPersonas.map(p => ({
        tipo: 'persona' as const,
        id: p.id,
        email: p.email,
        nombre: p.razon_social || [p.apellido, p.nombre].filter(Boolean).join(', '),
        acepta_marketing: p.acepta_marketing !== false,
      })),
      ...listaLeads.map(l => ({
        tipo: 'lead' as const,
        id: l.id,
        email: l.email,
        nombre: [l.apellido, l.nombre].filter(Boolean).join(', '),
      })),
    ]

    // ─── MODO INDIVIDUAL (síncrono — es 1-a-1, tarda poco) ─────────────
    if (destinatarios_tipo === 'individual') {
      // Guardar adjuntos en /tmp (efímeros — se procesan en el mismo request)
      const tmpDir = path.join('/tmp', 'crm-attachments', crypto.randomUUID())
      const archivos_adjuntos: Array<{ filename: string; path: string }> = []
      if (archivos.length > 0) {
        fs.mkdirSync(tmpDir, { recursive: true })
        for (const archivo of archivos) {
          if (!(archivo instanceof File) || archivo.size === 0) continue
          if (archivo.size > 10 * 1024 * 1024) continue
          const safeName = archivo.name.replace(/[^a-zA-Z0-9._-]/g, '_')
          const filePath = path.join(tmpDir, safeName)
          const buffer = Buffer.from(await archivo.arrayBuffer())
          fs.writeFileSync(filePath, buffer)
          archivos_adjuntos.push({ filename: archivo.name, path: filePath })
        }
      }

      for (const dst of cola) {
        if (!dst.email) { excluidos++; detalle.push({ id: dst.id, tipo: dst.tipo, nombre: dst.nombre, estado: 'sin_email' }); continue }
        if (dst.tipo === 'persona' && !dst.acepta_marketing) { excluidos++; detalle.push({ id: dst.id, tipo: dst.tipo, nombre: dst.nombre, estado: 'no_marketing' }); continue }
        if (emailsBaja.has(dst.email.toLowerCase())) { excluidos++; detalle.push({ id: dst.id, tipo: dst.tipo, nombre: dst.nombre, estado: 'baja' }); continue }
        if (enviadosHoy >= limiteDiario) { excluidos++; detalle.push({ id: dst.id, tipo: dst.tipo, nombre: dst.nombre, estado: 'limite_diario' }); continue }

        const resultado = await enviarComunicacion({
          plantilla_codigo: 'notificacion_general',
          destinatario: {
            email: dst.email,
            nombre: dst.nombre,
            persona_id: dst.tipo === 'persona' ? dst.id : undefined,
            lead_id: dst.tipo === 'lead' ? dst.id : undefined,
          },
          campos_editables,
          archivos_adjuntos: archivos_adjuntos.length > 0 ? archivos_adjuntos : undefined,
          tipo_envio: 'MANUAL',
          enviado_por_usuario_id: usuario.id,
        })

        if (resultado.ok) {
          enviados++
          enviadosHoy++
          detalle.push({ id: dst.id, tipo: dst.tipo, nombre: dst.nombre, estado: 'enviado' })
        } else {
          fallidos++
          detalle.push({ id: dst.id, tipo: dst.tipo, nombre: dst.nombre, estado: 'fallido', error: resultado.error })
        }
        if (delay > 0) await new Promise(r => setTimeout(r, delay))
      }

      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true })

      return NextResponse.json({
        ok: true, total: cola.length, enviados, fallidos, excluidos, detalle,
      })
    }

    // ─── MODO MASIVO (async — encolar y volver rápido) ─────────────
    // Crear campaña padre PRIMERO — necesitamos su ID para la carpeta de adjuntos.
    const nombreCampana = `Envío desde wizard — ${asunto}`.slice(0, 200)
    const estadoInicial = programadaPara ? 'PROGRAMADA' : 'EJECUTANDO'
    const { data: campanaData, error: campanaError } = await (supabase.from('mailing_campanas') as any)
      .insert({
        nombre: nombreCampana,
        descripcion: 'Envío iniciado desde el wizard de campañas.',
        personas_ids: listaPersonas.map(p => p.id),
        asunto_libre: asunto,
        cuerpo_libre: cuerpoFinal || '(sin cuerpo)',
        estado: estadoInicial,
        tipo: 'ENVIO_MASIVO',
        total_destinatarios: cola.length,
        programada_para: programadaPara?.toISOString() ?? null,
        fecha_inicio_ejecucion: programadaPara ? null : new Date().toISOString(),
        usuario_creador_id: usuario.id,
      })
      .select('id')
      .single()

    if (campanaError || !campanaData) {
      return NextResponse.json({ ok: false, error: 'No se pudo crear la campaña' }, { status: 500 })
    }

    const envio_agrupado_id = (campanaData as any).id as string

    // Guardar adjuntos en storage permanente (bind mount al host).
    const projectRoot = process.env.PROJECT_ROOT || process.cwd()
    const carpetaCampana = path.join(projectRoot, 'storage', 'campanas', envio_agrupado_id)
    const archivos_adjuntos_persistentes: Array<{ filename: string; path: string; size?: number }> = []
    if (archivos.length > 0) {
      fs.mkdirSync(carpetaCampana, { recursive: true })
      for (const archivo of archivos) {
        if (!(archivo instanceof File) || archivo.size === 0) continue
        if (archivo.size > 10 * 1024 * 1024) continue
        const safeName = archivo.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const filePath = path.join(carpetaCampana, safeName)
        const buffer = Buffer.from(await archivo.arrayBuffer())
        fs.writeFileSync(filePath, buffer)
        archivos_adjuntos_persistentes.push({ filename: archivo.name, path: filePath, size: archivo.size })
      }
    }

    // Pre-computar variables (botón CTA generado una sola vez).
    let cuerpoConBoton = cuerpoFinal
    let botonHtml: string | undefined
    if (cta_texto && cta_url) {
      const { obtenerVariablesOrganizacion } = await import('@/lib/email-variables')
      const orgVars = await obtenerVariablesOrganizacion()
      const { generarBotonHtml } = await import('@/lib/email-templates/botones')
      botonHtml = generarBotonHtml({
        texto: cta_texto,
        url: cta_url,
        color_marca: orgVars.organizacion_color_marca || undefined,
      })
      if (!cuerpoConBoton.includes('{{boton_accion}}')) {
        cuerpoConBoton = cuerpoConBoton.trim()
          ? `${cuerpoConBoton}\n\n{{boton_accion}}`
          : `{{boton_accion}}`
      }
    }
    const variablesExtra: Record<string, string> = {
      ...(asunto ? { titulo: asunto } : {}),
      ...(cuerpoConBoton ? { cuerpo_mensaje: cuerpoConBoton } : {}),
      ...(botonHtml ? { boton_accion: botonHtml } : {}),
    }

    // Encolar N emails — todos con enviar_despues_de = ahora (o programada).
    const enviar_despues_de = programadaPara ?? new Date()
    let encolados = 0

    for (const dst of cola) {
      if (!dst.email) { excluidos++; continue }
      const res = await encolarEmail({
        plantilla_codigo: 'notificacion_general',
        destinatario: {
          email: dst.email,
          nombre: dst.nombre,
          persona_id: dst.tipo === 'persona' ? dst.id : undefined,
          lead_id: dst.tipo === 'lead' ? dst.id : undefined,
        },
        tipo_envio: 'MASIVO',
        enviado_por_usuario_id: usuario.id,
        variables_extra: variablesExtra,
        archivos_adjuntos: archivos_adjuntos_persistentes.length > 0 ? archivos_adjuntos_persistentes : undefined,
        anti_spam: false,
        envio_agrupado_id,
        enviar_despues_de,
      })

      if (res.ok && res.estado === 'ENCOLADO') encolados++
      else excluidos++
    }

    await (supabase.from('mailing_campanas') as any)
      .update({ excluidos, total_destinatarios: cola.length })
      .eq('id', envio_agrupado_id)

    return NextResponse.json({
      ok: true,
      campana_id: envio_agrupado_id,
      total: cola.length,
      encolados,
      excluidos,
      programada: programadaPara?.toISOString() ?? null,
      mensaje: programadaPara
        ? `${encolados} emails programados para ${programadaPara.toLocaleString('es-AR')}.`
        : `${encolados} emails encolados. Se envían en segundo plano — vas a ver el progreso en el historial.`,
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message ?? 'Error interno' }, { status: 500 })
  }
}
