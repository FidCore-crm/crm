import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { tieneAccesoTotal } from '@/lib/cartera-filter'
import { checkLicenciaActiva } from '@/lib/licencia-guard'

/**
 * POST /api/comunicaciones/historial/[id]/reintentar
 *
 * Crea un NUEVO registro en email_envios con estado ENCOLADO a partir de un
 * envío FALLIDO. No reusa el row viejo: así ambos intentos quedan en el
 * historial con sus errores específicos.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo

  const supabase = getSupabaseAdmin()

  const { data: envio, error: errEnvio } = await supabase
    .from('email_envios')
    .select(
      'id, estado, plantilla_codigo, destinatario_email, destinatario_nombre, persona_id, poliza_id, tipo_envio, archivos_adjuntos, variables_usadas',
    )
    .eq('id', params.id)
    .maybeSingle()

  if (errEnvio || !envio) {
    return NextResponse.json({ ok: false, error: 'Envío no encontrado' }, { status: 404 })
  }

  const e = envio as any

  if (e.estado !== 'FALLIDO') {
    return NextResponse.json(
      { ok: false, error: 'Solo se pueden reintentar envíos fallidos' },
      { status: 400 },
    )
  }

  // Filtro de cartera
  if (!tieneAccesoTotal(usuario)) {
    let ownerId: string | null = null
    if (e.poliza_id) {
      const { data: poli } = await supabase
        .from('polizas')
        .select('asegurado_id, personas!asegurado_id(usuario_id)')
        .eq('id', e.poliza_id)
        .maybeSingle()
      ownerId = (poli as any)?.personas?.usuario_id ?? null
    } else if (e.persona_id) {
      const { data: per } = await supabase
        .from('personas')
        .select('usuario_id')
        .eq('id', e.persona_id)
        .maybeSingle()
      ownerId = (per as any)?.usuario_id ?? null
    }
    if (ownerId !== null && ownerId !== usuario.id) {
      return NextResponse.json({ ok: false, error: 'Sin acceso' }, { status: 403 })
    }
  }

  // Verificar sistema activo
  const { data: config } = await supabase
    .from('configuracion_comunicaciones')
    .select('activo')
    .limit(1)
    .maybeSingle()

  if (!config || !(config as any).activo) {
    return NextResponse.json(
      { ok: false, error: 'El sistema de comunicaciones no está activo' },
      { status: 400 },
    )
  }

  const { data: nuevo, error: errInsert } = await supabase
    .from('email_envios')
    .insert({
      token_tracking: randomUUID(),
      plantilla_codigo: e.plantilla_codigo,
      destinatario_email: e.destinatario_email,
      destinatario_nombre: e.destinatario_nombre,
      persona_id: e.persona_id,
      poliza_id: e.poliza_id,
      asunto: '',
      tipo_envio: e.tipo_envio,
      estado: 'ENCOLADO',
      enviar_despues_de: new Date().toISOString(),
      variables_usadas: e.variables_usadas ?? {},
      archivos_adjuntos: e.archivos_adjuntos ?? null,
      enviado_por_usuario_id: usuario.id,
    })
    .select('id')
    .single()

  if (errInsert || !nuevo) {
    return NextResponse.json(
      { ok: false, error: errInsert?.message || 'No se pudo reencolar el email' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, nuevo_envio_id: (nuevo as any).id })
}
