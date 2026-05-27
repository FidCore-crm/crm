// ============================================================
// Helpers centralizados de autenticación y autorización para API routes
// ============================================================
//
// Uso típico dentro de una route handler:
//
//   const auth = await requireAuth(request)
//   if (auth instanceof NextResponse) return auth
//   const usuario = auth
//
// Para endpoints admin-only:
//
//   const auth = await requireAdmin(request)
//   if (auth instanceof NextResponse) return auth
//
// Todos los helpers leen el cookie `crm_session` vía obtenerUsuarioDesdeRequest.
// ============================================================

import { NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import type { Usuario } from '@/types/database'

/**
 * Requiere que haya un usuario autenticado.
 * Retorna el Usuario o una NextResponse 401 que debe devolverse inmediatamente.
 */
export async function requireAuth(request: Request): Promise<Usuario | NextResponse> {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) {
    return NextResponse.json(
      { ok: false, error: 'No autenticado' },
      { status: 401 }
    )
  }
  return usuario
}

/**
 * Requiere que haya un usuario autenticado con rol ADMIN.
 * Retorna el Usuario o una NextResponse 401/403.
 */
export async function requireAdmin(request: Request): Promise<Usuario | NextResponse> {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) {
    return NextResponse.json(
      { ok: false, error: 'No autenticado' },
      { status: 401 }
    )
  }
  if (usuario.rol !== 'ADMIN') {
    return NextResponse.json(
      { ok: false, error: 'Acción permitida solo a administradores' },
      { status: 403 }
    )
  }
  return usuario
}

/**
 * Valida que el usuario tenga acceso al recurso.
 * Un ADMIN o usuario con acceso TOTAL ve todo.
 * Un usuario con acceso PROPIA solo accede a recursos con usuario_id === su id.
 * Los recursos con usuario_id === null (huérfanos / sin asignar) NO son
 * accesibles para PROPIA: pertenecen al pool del admin hasta que los asigne.
 *
 * Retorna null si el acceso está permitido, o NextResponse 403 si no.
 */
export function requireOwnership(
  usuario: Usuario,
  recurso: { usuario_id: string | null }
): NextResponse | null {
  if (usuario.rol === 'ADMIN') return null
  if (usuario.acceso_cartera === 'TOTAL') return null
  if (recurso.usuario_id === usuario.id) return null
  return NextResponse.json(
    { ok: false, error: 'No tenés acceso a este recurso' },
    { status: 403 }
  )
}

