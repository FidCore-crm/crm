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
 *  - En cada query, lee el JWT desde la cookie `fidcore_jwt` (no-HttpOnly,
 *    seteada por el backend en login/refresh) y lo agrega como header
 *    `Authorization: Bearer <jwt>`.
 *  - Si la query devuelve 401 (JWT vencido), pide al backend que refresque
 *    (`/api/auth/refrescar-token`) y reintenta UNA vez con el nuevo JWT.
 *  - Para Realtime (WebSocket), llamamos `realtime.setAuth(jwt)` al crear
 *    el cliente y cada vez que el JWT se renueva. Sin esto el WS queda
 *    autenticado con anon_key y las policies con `auth.uid()` filtran
 *    todos los eventos, cortando el flujo Realtime del sistema.
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
 *  `fidcore_jwt` queda actualizada) o false si no se pudo renovar.
 *
 *  Dedup: si ya hay un refresh en vuelo, todos los callers concurrentes
 *  esperan a la misma promise para evitar hammering al endpoint cuando
 *  vencen 10 queries a la vez. */
let refreshEnCurso: Promise<boolean> | null = null
async function refrescarJwt(): Promise<boolean> {
  if (refreshEnCurso) return refreshEnCurso
  refreshEnCurso = (async () => {
    try {
      const res = await fetch('/api/auth/refrescar-token', {
        method: 'POST',
        credentials: 'include',
      })
      return res.ok
    } catch {
      return false
    } finally {
      // Liberar el lock en el próximo tick para que callers en la misma
      // microtask reciban el mismo resultado.
      setTimeout(() => { refreshEnCurso = null }, 0)
    }
  })()
  return refreshEnCurso
}

/** Última JWT sincronizada al canal Realtime — evita llamar setAuth con el
 *  mismo token repetidamente. */
let ultimoJwtRealtime: string | null = null

/** Sincroniza el JWT del usuario al cliente Realtime.
 *  Sin esto el WS queda autenticado con anon_key y las policies RLS con
 *  `auth.uid()` no dejan pasar eventos.
 *  El tipo `any` es intencional: el cliente en runtime es el correcto pero
 *  los genéricos de v2 chocan con la firma explícita del wrapper. */
function sincronizarJwtRealtime(cliente: any): void {
  const jwt = leerCookie('fidcore_jwt')
  if (jwt && jwt !== ultimoJwtRealtime) {
    cliente.realtime.setAuth(jwt)
    ultimoJwtRealtime = jwt
  }
}

export function createClient() {
  const cliente = createSupabaseClient(
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
          let jwt = leerCookie('fidcore_jwt')

          // Fallback preventivo: si no hay JWT (cookie expiró — dura 1h con
          // maxAge) tenemos que refrescar ANTES de mandar la query. Sin JWT,
          // PostgREST trata la request como anónima y las RLS con `auth.uid()`
          // devuelven [] con HTTP 200 (no 401), por lo que el retry por 401
          // no dispara y el CRM aparece "vacío" hasta que el usuario recarga
          // la página. Este refresh preventivo evita ese síntoma.
          if (!jwt) {
            const refreshed = await refrescarJwt()
            if (refreshed) {
              jwt = leerCookie('fidcore_jwt')
              if (jwt) sincronizarJwtRealtime(cliente)
            }
          }

          const headers = new Headers(init?.headers)
          if (jwt) headers.set('Authorization', `Bearer ${jwt}`)

          let response = await fetch(input, { ...init, headers })

          // Si 401 y teníamos JWT, intentar refresh + retry UNA vez.
          // Cubre el caso raro donde el JWT existía al leer la cookie pero
          // GoTrue lo consideró expirado (drift de reloj o vencimiento
          // durante la request).
          if (response.status === 401 && jwt) {
            const refreshed = await refrescarJwt()
            if (refreshed) {
              const nuevoJwt = leerCookie('fidcore_jwt')
              if (nuevoJwt && nuevoJwt !== jwt) {
                headers.set('Authorization', `Bearer ${nuevoJwt}`)
                // Sincronizar el nuevo JWT al WS de Realtime para que los canales
                // suscritos sigan recibiendo eventos después del refresh.
                sincronizarJwtRealtime(cliente)
                response = await fetch(input, { ...init, headers })
              }
            }
          }

          return response
        },
      },
    },
  )
  return cliente
}

// Singleton para componentes cliente
let client: ReturnType<typeof createClient> | null = null

/** Refresh preventivo: cada 50 min llamamos al endpoint que renueva las 3
 *  cookies (crm_session, crm_access, fidcore_jwt) usando el refresh_token
 *  HttpOnly. Con esto la cookie fidcore_jwt nunca llega a expirar (dura 1h)
 *  y las queries siempre viajan con Authorization válido.
 *
 *  Solo arranca en el browser (no SSR) y se dispara una única vez por
 *  singleton del cliente. */
let intervaloRefreshPreventivo: ReturnType<typeof setInterval> | null = null
function iniciarRefreshPreventivo(cliente: any): void {
  if (typeof window === 'undefined') return
  if (intervaloRefreshPreventivo) return
  const INTERVALO_MS = 50 * 60 * 1000 // 50 min (JWT dura 60 min)
  intervaloRefreshPreventivo = setInterval(async () => {
    const ok = await refrescarJwt()
    if (ok) sincronizarJwtRealtime(cliente)
  }, INTERVALO_MS)
}

export function getSupabaseClient() {
  if (!client) {
    client = createClient()
    iniciarRefreshPreventivo(client)
  }
  // Cada vez que se pide el cliente, resincronizamos por si el JWT cambió
  // (login, refresh manual, cambio de sesión). Es no-op si el JWT es el mismo.
  sincronizarJwtRealtime(client)
  return client
}
