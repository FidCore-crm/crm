// ============================================================================
// POST /api/usuarios/solicitudes-blanqueo/[id]/habilitar
//
// El admin habilita una solicitud PENDIENTE. La marca como HABILITADA. El user
// va a poder definir su nueva contraseña en su próximo intento de login.
//
// No genera token ni URL — el flujo del user es directamente desde el login.
// ============================================================================

import { NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { habilitarSolicitud } from '@/lib/blanqueo-password'
import { getSupabaseAdmin } from '@/lib/supabase/server'

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const admin = await obtenerUsuarioDesdeRequest(request)
  if (!admin) return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  if (admin.rol !== 'ADMIN') return NextResponse.json({ ok: false, error: 'Sin permisos' }, { status: 403 })

  const resultado = await habilitarSolicitud({
    solicitud_id: params.id,
    admin_id: admin.id,
  })
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, error: resultado.error ?? 'No se pudo habilitar' },
      { status: 400 },
    )
  }

  // Marcar como leídas las notificaciones in-app vinculadas a esta solicitud
  // del admin que la procesó.
  const supabase = getSupabaseAdmin()
  const { data: solicitud } = await supabase
    .from('solicitudes_blanqueo_password')
    .select('usuario_id')
    .eq('id', params.id)
    .maybeSingle()
  if (solicitud) {
    await supabase
      .from('notificaciones')
      .update({ leida: true, fecha_lectura: new Date().toISOString() })
      .eq('tipo', 'SOLICITUD_BLANQUEO_PASSWORD')
      .eq('entidad_id', (solicitud as any).usuario_id)
      .eq('usuario_id', admin.id)
      .eq('leida', false)
  }

  return NextResponse.json({ ok: true })
}
