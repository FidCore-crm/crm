/**
 * Resolución dinámica de la URL de Supabase en el browser.
 *
 * Filosofía: este CRM se vende como appliance (mini-PC físico al cliente).
 * Cuando el PAS está en la misma LAN del servidor, tiene que poder trabajar
 * sin internet — esa es la ventaja del modelo on-premise vs SaaS.
 *
 * Decidir la URL en runtime según `window.location.hostname`:
 *
 *   • Hostname local (IP privada RFC1918, *.local, localhost)
 *     → URL local directa al Kong (http://<host>:<puerto>)
 *     → Funciona SIN internet, sin pasar por CF, baja latencia.
 *
 *   • Hostname público (dominio configurado en el instalador)
 *     → URL pública con path rewrite (https://<host>/supabase)
 *     → Pasa por CF tunnel; necesita internet (obvio: el PAS está afuera).
 *
 * NEXT_PUBLIC_SUPABASE_URL (la env bakeada al bundle) se usa SOLO como
 * fallback de último recurso durante SSR. En el browser nunca debería
 * ganarle al resolver.
 */

function esHostnameLocal(hostname: string): boolean {
  // localhost y loopback IPv4/IPv6
  if (hostname === 'localhost') return true
  if (hostname === '127.0.0.1') return true
  if (hostname === '::1') return true

  // mDNS / Bonjour — para cuando el instalador asigna nombre tipo `fidcore.local`
  if (hostname.endsWith('.local')) return true

  // RFC 1918 — redes privadas
  if (/^10\./.test(hostname)) return true
  if (/^192\.168\./.test(hostname)) return true
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname)) return true

  return false
}

/**
 * Devuelve la URL de Supabase apropiada para la conexión actual del browser.
 *
 * En entornos sin `window` (SSR) cae al valor de `NEXT_PUBLIC_SUPABASE_URL`
 * porque no hay manera de detectar el origen. Ese caso no debería pasar para
 * un cliente browser (`createBrowserClient` no se invoca en SSR), pero queda
 * como red de seguridad.
 */
export function resolverUrlSupabaseBrowser(): string {
  if (typeof window === 'undefined') {
    return process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  }

  const { hostname, protocol } = window.location

  if (esHostnameLocal(hostname)) {
    // El PAS está en LAN → ir directo a Kong por el puerto local.
    // Funciona sin internet. El puerto es configurable por instalación
    // (default 8001, que es el default de Supabase self-hosted).
    const puerto = process.env.NEXT_PUBLIC_SUPABASE_PORT_LOCAL || '8001'
    return `http://${hostname}:${puerto}`
  }

  // El PAS está afuera → usar el dominio público con path rewrite.
  // Queries HTTP atraviesan el rewrite de Next.js. WebSocket (Realtime)
  // debe rutearse via ingress rule de cloudflared porque Next.js 14
  // rewrites no propaga el `Upgrade: websocket` header.
  return `${protocol}//${hostname}/supabase`
}

// Exportado solo para tests
export const __test = { esHostnameLocal }
