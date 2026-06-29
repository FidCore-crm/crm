/**
 * Endpoint público de recepción de leads desde formularios web externos.
 *
 *   POST /api/publico/leads/[token]
 *
 * Acepta body como:
 *   - application/x-www-form-urlencoded (el caso típico de un <form HTML>)
 *   - multipart/form-data
 *   - application/json
 *
 * Campos reconocidos:
 *   - nombre        (required)
 *   - email         (required, formato email)
 *   - apellido      (opcional)
 *   - telefono      (opcional)
 *   - seguro        (opcional, dropdown)
 *   - mensaje       (opcional, texto libre)
 *   - website_honeypot (debe venir VACÍO — si tiene contenido es bot)
 *   - redirect_to   (opcional, URL a donde redirigir después del envío)
 *
 * Cualquier campo extra se preserva en `leads.web_meta.campos_extra`.
 *
 * Defensas (en orden):
 *   1. Tamaño máximo (10 KB).
 *   2. Rate-limit por IP (5/min con failMode=closed).
 *   3. Token válido contra `configuracion_leads_web.token`.
 *   4. Sistema activo.
 *   5. Honeypot vacío.
 *   6. Referer/Origin pertenece a un dominio permitido.
 *   7. nombre + email válidos.
 */

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { logger } from '@/lib/errores'
import { encolarEmailSistema } from '@/lib/comunicaciones-sender'
import {
  obtenerConfiguracion,
  resolverUsuarioAsignado,
  dominioPermitido,
  corsHeadersParaOrigen,
  registrarIntento,
  incrementarContadores,
  type MotivoRechazoLeadsWeb,
} from '@/lib/leads-web'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_BODY_SIZE = 10 * 1024 // 10 KB — leads son texto cortito
const MAX_CAMPO_LARGO = 2000

function sanitizeText(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .trim()
}

function ok(payload: Record<string, unknown>, corsHeaders: Record<string, string> = {}) {
  return NextResponse.json({ ok: true, ...payload }, { status: 200, headers: corsHeaders })
}

function fail(
  status: number,
  motivo: MotivoRechazoLeadsWeb,
  mensaje: string,
  corsHeaders: Record<string, string> = {},
) {
  return NextResponse.json(
    { ok: false, error: mensaje, motivo },
    { status, headers: corsHeaders },
  )
}

// ----------------------------------------------------------------------------
// OPTIONS — preflight CORS
// ----------------------------------------------------------------------------

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin')
  const cfg = await obtenerConfiguracion()
  const dominios = cfg?.dominios_permitidos ?? []
  const headers = corsHeadersParaOrigen(origin, dominios)
  return new NextResponse(null, { status: 204, headers })
}

// ----------------------------------------------------------------------------
// POST
// ----------------------------------------------------------------------------

export async function POST(
  request: Request,
  { params }: { params: { token: string } },
) {
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')
  const userAgent = request.headers.get('user-agent')
  const ip = getClientIp(request)

  // 0) Cargar configuración antes (necesaria para CORS)
  const cfg = await obtenerConfiguracion()
  const dominios = cfg?.dominios_permitidos ?? []
  const corsHeaders = corsHeadersParaOrigen(origin, dominios)

  // 1) Tamaño del body
  const contentLength = parseInt(request.headers.get('content-length') || '0', 10)
  if (contentLength > MAX_BODY_SIZE) {
    await registrarIntento({ exito: false, ip, referer, user_agent: userAgent, motivo_rechazo: 'PAYLOAD_GRANDE' })
    return fail(413, 'PAYLOAD_GRANDE', 'El formulario es demasiado grande.', corsHeaders)
  }

  // 2) Rate-limit
  const rl = await checkRateLimit({
    identifier: ip,
    endpoint: 'publico-leads',
    maxRequests: 5,
    windowSeconds: 60,
    failMode: 'closed',
  })
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))
    await registrarIntento({ exito: false, ip, referer, user_agent: userAgent, motivo_rechazo: 'RATE_LIMIT' })
    return NextResponse.json(
      { ok: false, error: 'Demasiados envíos en poco tiempo. Probá de nuevo en un momento.', motivo: 'RATE_LIMIT' as MotivoRechazoLeadsWeb },
      { status: 429, headers: { ...corsHeaders, 'Retry-After': String(retryAfter) } },
    )
  }

  // 3) Token válido + sistema activo
  if (!cfg) {
    await registrarIntento({ exito: false, ip, referer, user_agent: userAgent, motivo_rechazo: 'ERROR_INTERNO' })
    return fail(500, 'ERROR_INTERNO', 'Configuración no disponible.', corsHeaders)
  }
  if (params.token !== cfg.token) {
    await registrarIntento({ exito: false, ip, referer, user_agent: userAgent, motivo_rechazo: 'TOKEN_INVALIDO' })
    return fail(404, 'TOKEN_INVALIDO', 'Endpoint no encontrado.', corsHeaders)
  }
  if (!cfg.activo) {
    await registrarIntento({ exito: false, ip, referer, user_agent: userAgent, motivo_rechazo: 'SISTEMA_INACTIVO' })
    return fail(503, 'SISTEMA_INACTIVO', 'La recepción de leads está desactivada temporalmente.', corsHeaders)
  }

  // 4) Parsear body
  let payload: Record<string, string> = {}
  try {
    const ct = (request.headers.get('content-type') || '').toLowerCase()
    if (ct.includes('application/json')) {
      const json = await request.json()
      for (const [k, v] of Object.entries(json ?? {})) {
        if (typeof v === 'string') payload[k] = v
        else if (v != null) payload[k] = String(v)
      }
    } else {
      const fd = await request.formData()
      fd.forEach((value, key) => {
        if (typeof value === 'string') payload[key] = value
      })
    }
  } catch (e) {
    await registrarIntento({ exito: false, ip, referer, user_agent: userAgent, motivo_rechazo: 'PAYLOAD_GRANDE' })
    return fail(400, 'PAYLOAD_GRANDE', 'No se pudo procesar el formulario.', corsHeaders)
  }

  // 5) Honeypot
  const honeypot = (payload.website_honeypot || '').trim()
  if (honeypot.length > 0) {
    logger.info({ modulo: 'leads-web', mensaje: 'Honeypot disparado', contexto: { ip, referer } })
    await registrarIntento({ exito: false, ip, referer, user_agent: userAgent, motivo_rechazo: 'HONEYPOT' })
    // Devolvemos OK para no señalarle al bot que detectamos la trampa.
    return ok({ mensaje: 'Gracias por tu consulta.' }, corsHeaders)
  }

  // 6) Referer / Origin check
  //
  // Si el PAS configuró dominios, el Origin (o si está vacío, el Referer)
  // debe coincidir. Si NO configuró dominios, se rechaza por default —
  // mejor que el primer lead sea fallido a tener una puerta abierta sin
  // protección. El error guía a la pantalla de configuración.
  const origenEvaluable = origin || referer || ''
  if (dominios.length === 0) {
    await registrarIntento({ exito: false, ip, referer, user_agent: userAgent, motivo_rechazo: 'REFERER_INVALIDO' })
    return fail(
      403,
      'REFERER_INVALIDO',
      'No hay dominios autorizados. El admin del CRM debe agregar al menos uno desde Configuración > Leads desde web.',
      corsHeaders,
    )
  }
  if (!dominioPermitido(origenEvaluable, dominios)) {
    await registrarIntento({ exito: false, ip, referer, user_agent: userAgent, motivo_rechazo: 'REFERER_INVALIDO' })
    return fail(
      403,
      'REFERER_INVALIDO',
      'El dominio de origen no está autorizado.',
      corsHeaders,
    )
  }

  // 7) Validación de campos básicos
  const nombre = (payload.nombre || '').trim().slice(0, MAX_CAMPO_LARGO)
  const email = (payload.email || '').trim().toLowerCase().slice(0, 254)
  if (!nombre) {
    await registrarIntento({ exito: false, ip, referer, user_agent: userAgent, motivo_rechazo: 'CAMPOS_FALTANTES' })
    return fail(400, 'CAMPOS_FALTANTES', 'Falta el nombre.', corsHeaders)
  }
  if (!email) {
    await registrarIntento({ exito: false, ip, referer, user_agent: userAgent, motivo_rechazo: 'CAMPOS_FALTANTES' })
    return fail(400, 'CAMPOS_FALTANTES', 'Falta el email.', corsHeaders)
  }
  if (!EMAIL_REGEX.test(email)) {
    await registrarIntento({ exito: false, ip, referer, user_agent: userAgent, motivo_rechazo: 'EMAIL_INVALIDO' })
    return fail(400, 'EMAIL_INVALIDO', 'El email no tiene un formato válido.', corsHeaders)
  }

  // 8) Demás campos (todos opcionales)
  const apellido = (payload.apellido || '').trim().slice(0, MAX_CAMPO_LARGO)
  const telefono = (payload.telefono || '').trim().slice(0, 50)
  const seguroRaw = (payload.seguro || '').trim().toLowerCase().slice(0, 50)
  const mensaje = (payload.mensaje || '').trim().slice(0, MAX_CAMPO_LARGO)
  const redirectTo = (payload.redirect_to || '').trim()

  // Campos extra (los que no son los estándar) se preservan
  const CAMPOS_ESTANDAR = new Set([
    'nombre', 'apellido', 'email', 'telefono', 'seguro', 'mensaje',
    'website_honeypot', 'redirect_to',
  ])
  const camposExtra: Record<string, string> = {}
  for (const [k, v] of Object.entries(payload)) {
    if (!CAMPOS_ESTANDAR.has(k)) camposExtra[k] = String(v).slice(0, MAX_CAMPO_LARGO)
  }

  // 9) Asignar usuario
  const usuarioAsignadoId = await resolverUsuarioAsignado(cfg)

  // 10) Insertar el lead
  const supabase = getSupabaseAdmin()
  const productosInteres = seguroRaw
    ? mapearSeguroANombre(seguroRaw)
    : null

  // El campo `apellido` es NOT NULL en la tabla leads — si no vino, usamos "—"
  const apellidoFinal = apellido || '—'

  const webMeta = {
    ip,
    referer,
    user_agent: userAgent ? userAgent.slice(0, 500) : null,
    campos_extra: camposExtra,
    recibido_en: new Date().toISOString(),
    asignacion_modo: cfg.modo_asignacion,
  }

  const { data: leadCreado, error: errInsert } = await supabase
    .from('leads')
    .insert({
      nombre: nombre.slice(0, 200),
      apellido: apellidoFinal.slice(0, 200),
      email,
      telefono: telefono || null,
      fuente: 'WEB',
      canal: 'EMAIL',
      nivel_interes: 'MEDIO',
      estado: 'NUEVO',
      productos_interes: productosInteres,
      notas: mensaje || null,
      usuario_id: usuarioAsignadoId,
      web_meta: webMeta,
    })
    .select('id, nombre, apellido, email, telefono')
    .single()

  if (errInsert || !leadCreado) {
    logger.error({
      modulo: 'leads-web',
      mensaje: 'No se pudo insertar el lead',
      contexto: { error: errInsert?.message, ip, referer },
    })
    await registrarIntento({ exito: false, ip, referer, user_agent: userAgent, motivo_rechazo: 'ERROR_INTERNO' })
    return fail(500, 'ERROR_INTERNO', 'No se pudo guardar el lead.', corsHeaders)
  }

  const lead = leadCreado as { id: string; nombre: string; apellido: string; email: string; telefono: string | null }

  // 11) Contadores + log éxito
  await Promise.all([
    incrementarContadores(),
    registrarIntento({
      exito: true,
      ip,
      referer,
      user_agent: userAgent,
      lead_id: lead.id,
      payload_resumen: { nombre, email, seguro: seguroRaw, asignado_a: usuarioAsignadoId },
    }),
  ])

  // 12) Notificación in-app del tipo LEAD_WEB_NUEVO (la consume el Inbox del navbar)
  if (cfg.notificar_inapp) {
    const destinatarios = usuarioAsignadoId ? [usuarioAsignadoId] : await obtenerAdminsIds()
    for (const uid of destinatarios) {
      await supabase.from('notificaciones').insert({
        tipo: 'LEAD_WEB_NUEVO',
        prioridad: 'INFORMATIVA',
        titulo: `Nuevo lead: ${nombre}`,
        mensaje: mensaje
          ? `${nombre} (${email}) — ${mensaje.slice(0, 120)}${mensaje.length > 120 ? '...' : ''}`
          : `${nombre} dejó sus datos en el formulario web (${email}).`,
        entidad_tipo: 'lead',
        entidad_id: lead.id,
        url: `/crm/comercial/leads/${lead.id}`,
        leida: false,
        usuario_id: uid,
      })
    }
  }

  // 13) Email al admin (vía cola)
  if (cfg.notificar_email_admin) {
    encolarEmailSistema({
      tipo_evento: 'LEAD_WEB_RECIBIDO',
      variables_extra: {
        nombre_lead: nombre,
        apellido_lead: apellido || '',
        email_lead: email,
        telefono_lead: telefono || '—',
        seguro_lead: productosInteres || '—',
        mensaje_lead: mensaje || '(sin mensaje)',
        asignado_a: usuarioAsignadoId
          ? await obtenerNombreUsuario(usuarioAsignadoId)
          : 'sin asignar',
        referer_lead: referer || origin || '—',
      },
    }).catch((e) => {
      logger.warn({ modulo: 'leads-web', mensaje: 'No se pudo encolar email al admin', contexto: { error: String(e) } })
    })
  }

  // 14) Responder — redirect o JSON
  if (redirectTo && /^https?:\/\//i.test(redirectTo)) {
    // Respetamos el redirect (lo mismo que hacía FormSubmit con _next)
    return NextResponse.redirect(redirectTo, { status: 302, headers: corsHeaders })
  }

  return ok({ mensaje: '¡Gracias! Te vamos a estar contactando.', lead_id: lead.id }, corsHeaders)
}

// ----------------------------------------------------------------------------
// Helpers privados
// ----------------------------------------------------------------------------

function mapearSeguroANombre(valor: string): string {
  const mapa: Record<string, string> = {
    auto: 'Auto o moto',
    automotor: 'Auto o moto',
    moto: 'Auto o moto',
    hogar: 'Hogar',
    comercio: 'Comercio y Empresa',
    empresa: 'Comercio y Empresa',
    vida: 'Vida y AP',
    salud: 'Vida y AP',
    ap: 'Vida y AP',
    otro: 'Otro',
  }
  return mapa[valor] ?? valor.slice(0, 100)
}

async function obtenerAdminsIds(): Promise<string[]> {
  try {
    const supabase = getSupabaseAdmin()
    const { data } = await supabase
      .from('usuarios_perfil')
      .select('id')
      .eq('rol', 'ADMIN')
      .eq('activo', true)
    return ((data ?? []) as Array<{ id: string }>).map((u) => u.id)
  } catch {
    return []
  }
}

async function obtenerNombreUsuario(id: string): Promise<string> {
  try {
    const supabase = getSupabaseAdmin()
    const { data } = await supabase
      .from('usuarios_perfil')
      .select('nombre, apellido')
      .eq('id', id)
      .maybeSingle()
    const u = data as { nombre: string | null; apellido: string | null } | null
    if (!u) return 'sin asignar'
    return `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim() || 'sin asignar'
  } catch {
    return 'sin asignar'
  }
}
