import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-auth'
import { tieneAccesoTotal } from '@/lib/cartera-filter'
import { enviarComunicacion } from '@/lib/comunicaciones-sender'
import { regenerarTokenAcceso, construirUrlPortal, recuperarTokenPlano } from '@/lib/portal-cliente-tokens'
import { obtenerUrlPortalCliente } from '@/lib/urls-publicas'
import { checkLicenciaActiva } from '@/lib/licencia-guard'

/**
 * Envía el link del portal del cliente por email o WhatsApp.
 *
 * Post-migración 093: si el acceso tiene `token_encrypted`, recuperamos
 * el plano y lo reusamos — el PAS puede reenviar el mismo link 100 veces
 * sin invalidar el original. Solo regeneramos (con revocación del anterior)
 * cuando el acceso no tiene encrypted (token pre-093 o ENCRYPTION_KEY
 * faltante).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ persona_id: string }> },
) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo

  const { persona_id } = await params
  const supabase = getSupabaseAdmin()

  const { data: persona } = await supabase
    .from('personas')
    .select('id, nombre, apellido, email, whatsapp, telefono, usuario_id')
    .eq('id', persona_id)
    .maybeSingle()

  if (!persona) {
    return NextResponse.json({ ok: false, error: 'Persona no encontrada' }, { status: 404 })
  }

  if (!tieneAccesoTotal(usuario)) {
    const ownerId = (persona as any).usuario_id
    if (ownerId !== null && ownerId !== usuario.id) {
      return NextResponse.json({ ok: false, error: 'No tenés acceso a esta persona' }, { status: 403 })
    }
  }

  // Verificar que existe un acceso activo previo (para no convertir este
  // endpoint en "generar"; debería pasarse por POST /acceso/[id] primero).
  const { data: accesoPrevio } = await supabase
    .from('portal_cliente_accesos')
    .select('id, token_encrypted')
    .eq('persona_id', persona_id)
    .eq('revocado', false)
    .maybeSingle()

  if (!accesoPrevio) {
    return NextResponse.json(
      { ok: false, error: 'La persona no tiene un acceso activo al portal' },
      { status: 400 },
    )
  }

  // Si el acceso tiene token encriptado, reusamos el plano y NO regeneramos.
  // Reenviar el mismo link no rompe el que ya tiene el cliente. Si no se
  // puede recuperar (encrypted vacío o key faltante), caemos al fallback de
  // regenerar — el link viejo deja de funcionar pero al menos podemos enviar
  // algo válido.
  let tokenPlano = recuperarTokenPlano(accesoPrevio)
  if (!tokenPlano) {
    const regen = await regenerarTokenAcceso(persona_id, usuario.id)
    if (!regen.ok || !regen.token) {
      return NextResponse.json(
        { ok: false, error: regen.error || 'No se pudo regenerar el token' },
        { status: 500 },
      )
    }
    tokenPlano = regen.token
  }

  const urlBasePortal = await obtenerUrlPortalCliente()
  const urlPortal = construirUrlPortal(tokenPlano, urlBasePortal)
  if (!urlPortal) {
    return NextResponse.json(
      { ok: false, error: 'La URL del portal del cliente no está configurada. Configurala en Configuración → Portal del Cliente.' },
      { status: 500 },
    )
  }

  let body: any = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const metodo: 'email' | 'whatsapp' = body?.metodo === 'whatsapp' ? 'whatsapp' : 'email'
  const personaRow = persona as any
  const nombreCompleto =
    [personaRow.apellido, personaRow.nombre].filter(Boolean).join(', ') || personaRow.nombre || ''

  if (metodo === 'whatsapp') {
    const tel = ((personaRow.whatsapp || personaRow.telefono || '') as string).replace(/[^\d]/g, '')
    if (!tel) {
      return NextResponse.json(
        { ok: false, error: 'La persona no tiene teléfono/whatsapp configurado' },
        { status: 400 },
      )
    }
    // Cargar plantilla configurable + nombre del PAS u organización en paralelo.
    const [{ data: plantilla }, { data: organizacion }] = await Promise.all([
      supabase
        .from('plantillas_whatsapp')
        .select('mensaje')
        .eq('codigo', 'portal_cliente_acceso')
        .maybeSingle(),
      supabase
        .from('configuracion')
        .select('nombre')
        .limit(1)
        .maybeSingle(),
    ])
    const organizacionNombre = (organizacion as any)?.nombre || 'tu productor de seguros'
    const plantillaMensaje = (plantilla as any)?.mensaje
      || `Hola {{nombre}}, te paso el link a tu portal personal de {{organizacion_nombre}}.\n\n{{url_portal}}\n\nGuardalo en tus favoritos, no vence.`

    // Reemplazo manual de variables (no podemos usar el helper del browser).
    const vars: Record<string, string> = {
      nombre: personaRow.nombre || '',
      apellido: personaRow.apellido || '',
      url_portal: urlPortal,
      organizacion_nombre: organizacionNombre,
    }
    const mensaje = plantillaMensaje.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => vars[k] ?? '')
    const urlWhatsapp = `https://wa.me/${tel}?text=${encodeURIComponent(mensaje)}`
    return NextResponse.json({ ok: true, metodo: 'whatsapp', url_whatsapp: urlWhatsapp })
  }

  // metodo === 'email'
  const email = personaRow.email
  if (!email) {
    return NextResponse.json(
      { ok: false, error: 'La persona no tiene email configurado' },
      { status: 400 },
    )
  }

  const resultado = await enviarComunicacion({
    plantilla_codigo: 'portal_cliente_acceso',
    destinatario: { email, nombre: nombreCompleto, persona_id },
    tipo_envio: 'AUTOMATICO_PORTAL_CLIENTE',
    enviado_por_usuario_id: usuario.id,
    variables_extra: { url_portal: urlPortal },
  })

  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, error: resultado.error || 'No se pudo enviar el email' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, metodo: 'email', envio_id: resultado.envio_id })
}
