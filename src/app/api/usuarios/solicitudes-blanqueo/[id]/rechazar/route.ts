// ============================================================================
// POST /api/usuarios/solicitudes-blanqueo/[id]/rechazar
//
// El admin rechaza una solicitud PENDIENTE. La marca como RECHAZADA. El user
// vuelve a poder usar su contraseña vieja (el login deja de bloquearse).
//
// Body opcional: { motivo: string }
// ============================================================================

import { NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { rechazarSolicitud } from '@/lib/blanqueo-password'
import { getSupabaseAdmin } from '@/lib/supabase/server'

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const admin = await obtenerUsuarioDesdeRequest(request)
  if (!admin) return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  if (admin.rol !== 'ADMIN') return NextResponse.json({ ok: false, error: 'Sin permisos' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const motivo = body?.motivo ? String(body.motivo).trim().slice(0, 500) : undefined

  const resultado = await rechazarSolicitud({
    solicitud_id: params.id,
    admin_id: admin.id,
    motivo,
  })
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, error: resultado.error ?? 'No se pudo rechazar' },
      { status: 400 },
    )
  }

  // Idem habilitar: marcar notificaciones como leídas.
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
