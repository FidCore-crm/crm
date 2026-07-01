import { NextResponse } from 'next/server'
import { obtenerUsuarioYRotacion } from '@/lib/auth'
import { setearCookiesSesion } from '@/lib/auth/cookie-options'
import { obtenerEstadoServicio } from '@/lib/estado-servicio'

export async function GET(request: Request) {
  const { usuario, tokens_rotados } = await obtenerUsuarioYRotacion(request)

  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }

  // Estado del servicio (solo relevante en modo VPS — en APPLIANCE siempre ACTIVO).
  // El frontend usa este dato para redirigir a /suspendido si detecta que el
  // panel de administración cambió el estado mientras el PAS estaba logueado.
  const estadoServicio = await obtenerEstadoServicio()

  const response = NextResponse.json({
    ok: true,
    usuario: {
      id: usuario.id,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      email: usuario.email,
      rol: usuario.rol,
      acceso_cartera: usuario.acceso_cartera,
      activo: usuario.activo,
      mostrar_ayuda_contextual: usuario.mostrar_ayuda_contextual,
    },
    servicio: estadoServicio,
  })

  // Si hubo refresh de token (el access_token vencía), actualizar las cookies
  if (tokens_rotados) {
    setearCookiesSesion(response, request, {
      access_token: tokens_rotados.access_token,
      refresh_token: tokens_rotados.refresh_token,
    })
  }

  return response
}
