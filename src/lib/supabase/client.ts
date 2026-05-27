import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { resolverUrlSupabaseBrowser } from './url-resolver'

// NOTA: NO se pasa `<Database>` como generic porque rompe varias queries
// con `.update()` / `.insert()` (bug histórico documentado en CLAUDE.md).
// Los tipos del schema viven en `@/types/database.generated` y se importan
// explícitamente cuando se necesitan.

/**
 * Cliente Supabase para uso en el browser.
 *
 * Comportamiento de auth:
 *  - El cliente NO maneja sus propias sesiones (`persistSession: false`,
 *    `autoRefreshToken: false`).
 *  - En cada query, lee el JWT desde la cookie `pulzar_jwt` (no-HttpOnly,
 *    seteada por el backend en login/refresh) y lo agrega como header
 *    `Authorization: Bearer <jwt>`.
 *  - Si la query devuelve 401 (JWT vencido), pide al backend que refresque
 *    (`/api/auth/refrescar-token`) y reintenta UNA vez con el nuevo JWT.
 *
 * Esto permite que RLS use `auth.uid()` y los custom claims del JWT
 * (rol, acceso_cartera) inyectados por el hook de la migración 055.
 *
 * El URL se resuelve en runtime (`resolverUrlSupabaseBrowser`) para soportar
 * LAN sin internet vs CF Tunnel público.
 */

function leerCookie(nombre: string): string | null {
  if (typeof document === 'undefined') return null
  const partes = document.cookie.split(';')
  for (const seg of partes) {
    const trimmed = seg.trim()
    if (trimmed.startsWith(`${nombre}=`)) {
      return decodeURIComponent(trimmed.slice(nombre.length + 1))
    }
  }
  return null
}

/** Llama al endpoint del CRM que refresca el JWT usando el refresh_token de
 *  la cookie HttpOnly. Devuelve true si el refresh fue exitoso (la cookie
 *  `pulzar_jwt` queda actualizada) o false si no se pudo renovar. */
async function refrescarJwt(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/refrescar-token', {
      method: 'POST',
      credentials: 'include',
    })
    return res.ok
  } catch {
    return false
  }
}

export function createClient() {
  return createSupabaseClient(
    resolverUrlSupabaseBrowser(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: async (input, init) => {
          const jwt = leerCookie('pulzar_jwt')
          const headers = new Headers(init?.headers)
          if (jwt) headers.set('Authorization', `Bearer ${jwt}`)

          let response = await fetch(input, { ...init, headers })

          // Si 401 y teníamos JWT, intentar refresh + retry UNA vez
          if (response.status === 401 && jwt) {
            const refreshed = await refrescarJwt()
            if (refreshed) {
              const nuevoJwt = leerCookie('pulzar_jwt')
              if (nuevoJwt && nuevoJwt !== jwt) {
                headers.set('Authorization', `Bearer ${nuevoJwt}`)
                response = await fetch(input, { ...init, headers })
              }
            }
          }

          return response
        },
      },
    },
  )
}

// Singleton para componentes cliente
let client: ReturnType<typeof createClient> | null = null

export function getSupabaseClient() {
  if (!client) {
    client = createClient()
  }
  return client
}
