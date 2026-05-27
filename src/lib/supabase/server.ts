import { createClient } from '@supabase/supabase-js'

// NOTA: NO se pasa `<Database>` como generic porque rompe varias queries
// con `.update()` / `.insert()` (bug histórico documentado en CLAUDE.md).
// Los tipos del schema viven en `@/types/database.generated` y se importan
// explícitamente cuando se necesitan (helpers `Tables<T>`, `InsertOf<T>`,
// `UpdateOf<T>` en `@/types/database`).

// IMPORTANTE: Next.js 14 cachea por defecto las llamadas fetch() de supabase-js,
// sirviendo respuestas stale. Forzamos `cache: 'no-store'` en el fetch global del
// cliente admin para que cada query server-side vaya a la DB fresca.
// Sin esto: queries que deberían ver el estado actual (ej: estado de importación,
// api key recién guardada) devuelven el valor que tenía el row en la primera
// llamada con esa URL en el mismo proceso Node.
const fetchSinCache: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: 'no-store' })

// El server-side prefiere `SUPABASE_INTERNAL_URL` (alias del kong dentro de la
// network Docker, ej: `http://supabase-kong:8000`) para evitar el roundtrip
// por internet cuando hay tunnel + path-based proxy. Si no está seteado, cae
// al public URL que puede ser tanto el directo (dev) como el path-based
// (producción sin la env interna seteada).
function getSupabaseUrlServer(): string {
  return (
    process.env.SUPABASE_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL!
  )
}

export function getSupabaseAdmin() {
  return createClient(
    getSupabaseUrlServer(),
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      global: { fetch: fetchSinCache },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  )
}
