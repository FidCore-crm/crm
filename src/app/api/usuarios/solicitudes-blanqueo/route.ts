// ============================================================================
// GET /api/usuarios/solicitudes-blanqueo
//
// Lista las solicitudes activas (PENDIENTES) para mostrarlas en la UI de
// gestión de usuarios. Solo admin.
//
// Devuelve también un map { usuario_id → solicitud } para que la UI marque
// fácilmente las filas afectadas.
// ============================================================================

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'

export async function GET(request: Request) {
  const admin = await obtenerUsuarioDesdeRequest(request)
  if (!admin) return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  if (admin.rol !== 'ADMIN') return NextResponse.json({ ok: false, error: 'Sin permisos' }, { status: 403 })

  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('solicitudes_blanqueo_password')
    .select(`
      id, usuario_id, estado, ip_origen, user_agent, created_at,
      fecha_habilitacion, habilitada_por_admin_id
    `)
    .in('estado', ['PENDIENTE', 'HABILITADA'])
    .order('created_at', { ascending: false })

  const solicitudes = (data as Array<Record<string, any>> | null) ?? []

  return NextResponse.json({
    ok: true,
    solicitudes,
    cantidad_pendientes: solicitudes.filter((s) => s.estado === 'PENDIENTE').length,
    cantidad_habilitadas: solicitudes.filter((s) => s.estado === 'HABILITADA').length,
  })
}
