import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { validarTokenAcceso } from '@/lib/portal-cliente-tokens'
import { encolarEmailSistema } from '@/lib/comunicaciones-sender'
import { logger } from '@/lib/errores'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const ip = getClientIp(request)
    // Anti-spam: 5 sugerencias por hora por IP. Fail-closed para endpoint público.
    const rl = await checkRateLimit({
      identifier: ip,
      endpoint: 'publico-portal-sugerir',
      maxRequests: 5,
      windowSeconds: 3600,
      failMode: 'closed',
    })
    if (!rl.allowed) {
      const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000)
      return NextResponse.json(
        { ok: false, error: 'Demasiadas sugerencias. Esperá un rato e intentá de nuevo.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      )
    }

    const { token } = await params
    const supabase = getSupabaseAdmin()

    // Sistema activo
    const { data: config } = await supabase
      .from('configuracion_portal_cliente')
      .select('activo')
      .limit(1)
      .maybeSingle()
    if (!(config as any)?.activo) {
      return NextResponse.json({ ok: false, error: 'Portal no disponible' }, { status: 503 })
    }

    // Validar token
    const validacion = await validarTokenAcceso(token, ip)
    if (!validacion.valido || !validacion.persona_id) {
      return NextResponse.json({ ok: false, error: 'Acceso no disponible' }, { status: 403 })
    }

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 })
    }

    const telefonoNuevo = String(body.telefono ?? '').trim().slice(0, 50)
    const emailNuevo = String(body.email ?? '').trim().slice(0, 120)
    const direccionNueva = String(body.direccion ?? '').trim().slice(0, 300)
    const mensajeExtra = String(body.mensaje ?? '').trim().slice(0, 1000)

    if (!telefonoNuevo && !emailNuevo && !direccionNueva && !mensajeExtra) {
      return NextResponse.json(
        { ok: false, error: 'Indicá al menos un campo a corregir.' },
        { status: 400 }
      )
    }

    // Validación básica de formato — si el email no tiene formato válido
    // descartamos sin notificar al PAS (anti-spam pasivo).
    if (emailNuevo && !EMAIL_REGEX.test(emailNuevo)) {
      return NextResponse.json(
        { ok: false, error: 'Email con formato inválido.' },
        { status: 400 }
      )
    }

    // Datos actuales del asegurado
    const { data: persona } = await supabase
      .from('personas')
      .select('nombre, apellido, razon_social, tipo_persona, dni_cuil, email, telefono, calle, numero, localidad, provincia')
      .eq('id', validacion.persona_id)
      .maybeSingle()

    const p = (persona as any) ?? {}
    const nombreAsegurado =
      p.tipo_persona === 'JURIDICA'
        ? p.razon_social || p.apellido
        : [p.nombre, p.apellido].filter(Boolean).join(' ')
    const direccionActual = [p.calle, p.numero, p.localidad, p.provincia].filter(Boolean).join(', ')

    // Armamos las líneas del bloque "cambios sugeridos" como texto.
    const cambiosLineas: string[] = []
    if (telefonoNuevo) cambiosLineas.push(`• Teléfono: ${telefonoNuevo}`)
    if (emailNuevo) cambiosLineas.push(`• Email: ${emailNuevo}`)
    if (direccionNueva) cambiosLineas.push(`• Dirección: ${direccionNueva}`)
    const cambiosSugeridos = cambiosLineas.length > 0 ? cambiosLineas.join('\n') : '(Sin cambios estructurados)'

    // Encolar usando el sistema unificado: queda en historial, respeta toggle
    // del sistema de comunicaciones, retry automático ante fallo SMTP.
    const result = await encolarEmailSistema({
      tipo_evento: 'SUGERENCIA_CORRECCION_PORTAL',
      variables_extra: {
        nombre_asegurado: nombreAsegurado || 'Un asegurado',
        dni: p.dni_cuil || '—',
        telefono_actual: p.telefono || '—',
        email_actual: p.email || '—',
        direccion_actual: direccionActual || '—',
        cambios_sugeridos: cambiosSugeridos,
        mensaje_extra: mensajeExtra || '(Sin mensaje adicional)',
      },
    })

    if (!result.ok || result.envios_creados === 0) {
      logger.warn({
        modulo: 'portal-cliente',
        mensaje: 'No se pudo encolar la sugerencia',
        contexto: { error: result.error, persona_id: validacion.persona_id },
      })
      // Devolvemos éxito al cliente igual: la sugerencia llegó al sistema (la
      // tabla email_envios queda con el row incluso si falló el encolar).
      // El admin lo verá en el panel de comunicaciones.
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    logger.error({ modulo: 'portal-cliente', mensaje: 'Error en sugerir-correccion', contexto: { error: err?.message } })
    return NextResponse.json({ ok: false, error: 'Error interno' }, { status: 500 })
  }
}
