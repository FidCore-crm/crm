import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_ROUTES = [
  '/login',
  '/setup',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/setup',
  '/api/auth/check-setup',
  // Blanqueo de contraseña (legacy): el usuario no tiene sesión todavía.
  '/api/auth/solicitar-blanqueo',
  '/api/auth/blanquear',
  // Password reset flow (Supabase Auth, #86)
  '/api/auth/recuperar-password',
  '/api/auth/setear-nueva-password',
  '/auth/nueva-password',
  // Sistema de invitaciones (#87)
  '/api/auth/aceptar-invitacion',
  '/auth/aceptar-invitacion',
  // Confirmación de cambio de email (#85)
  '/auth/email-confirmado',
  // Refresh de JWT del cliente browser (#68 — RLS)
  '/api/auth/refrescar-token',
  // Healthcheck público (usado por aplicar-actualizacion.sh + monitoreo externo).
  // No expone info sensible: solo {ok, version, checks}.
  '/api/health',
]

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.includes(pathname)) return true
  if (pathname.startsWith('/api/storage/')) return true
  if (pathname.startsWith('/api/cron/')) return true
  if (pathname.startsWith('/api/publico/')) return true
  if (pathname.startsWith('/api/track/')) return true
  if (pathname.startsWith('/api/comunicaciones/unsubscribe/')) return true
  // Confirmación de blanqueo admin: link clickeable desde el email.
  if (pathname.startsWith('/api/auth/confirmar-blanqueo-admin/')) return true
  if (pathname === '/denuncia') return true
  // Portal del Asegurado (público)
  if (pathname === '/c' || pathname.startsWith('/c/')) return true
  return false
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const token = request.cookies.get('crm_session')?.value

  if (isPublicRoute(pathname)) {
    // /login y /: si no hay usuarios, redirigir a /setup
    if (pathname === '/login' || pathname === '/') {
      try {
        const checkUrl = new URL('/api/auth/check-setup', request.url)
        const res = await fetch(checkUrl.toString())
        const json = await res.json()
        if (json.needsSetup) {
          return NextResponse.redirect(new URL('/setup', request.url))
        }
      } catch { /* continuar */ }
    }

    // /login: si ya tiene sesión, ir al dashboard
    if (pathname === '/login' && token) {
      return NextResponse.redirect(new URL('/crm/dashboard', request.url))
    }

    // /setup: si ya hay usuarios, ir al login
    if (pathname === '/setup') {
      try {
        const checkUrl = new URL('/api/auth/check-setup', request.url)
        const res = await fetch(checkUrl.toString())
        const json = await res.json()
        if (!json.needsSetup) {
          return NextResponse.redirect(new URL('/login', request.url))
        }
      } catch { /* continuar */ }
    }

    return NextResponse.next()
  }

  // Raíz: redirect a dashboard (que a su vez requiere login)
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/crm/dashboard', request.url))
  }

  // Rutas de API protegidas
  if (pathname.startsWith('/api/')) {
    if (!token) {
      return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
    }
    return NextResponse.next()
  }

  // Rutas del CRM: requieren sesión
  if (pathname.startsWith('/crm/')) {
    if (!token) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    return NextResponse.next()
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/',
    '/crm/:path*',
    '/login',
    '/setup',
    '/denuncia',
    '/c/:path*',
    '/auth/:path*',
    '/api/:path*',
  ],
}
