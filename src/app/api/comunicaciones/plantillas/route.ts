import { NextRequest, NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }

  const supabase = getSupabaseAdmin()
  const contexto = request.nextUrl.searchParams.get('contexto')

  // Excluye plantillas internas que el PAS NO debe poder elegir como
  // envío manual a un cliente:
  //  - `sistema_*` → notificaciones técnicas al admin (backup, PDF, errores,
  //                  rollback, restauración, etc.).
  //  - `auth_*`    → emails de autenticación (recuperar password, invitación,
  //                  confirmación de cambio de email).
  // Estas plantillas usan variables específicas que no se completan en el
  // contexto de un envío manual a cliente: si el PAS las eligiera por error,
  // el email saldría sin contenido real y con datos irrelevantes para el
  // destinatario.
  let query = supabase
    .from('plantillas_email')
    .select('codigo, nombre, descripcion, asunto_default, contexto, variables_disponibles')
    .eq('activa', true)
    .not('codigo', 'like', 'sistema_%')
    .not('codigo', 'like', 'auth_%')
    .order('created_at', { ascending: true })

  if (contexto) {
    query = query.or(`contexto.eq.${contexto},contexto.eq.GENERAL`)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ ok: false, error: 'Error al obtener los datos' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, plantillas: data })
}
