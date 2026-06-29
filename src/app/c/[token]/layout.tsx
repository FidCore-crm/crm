import type { Metadata, Viewport } from 'next'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { validarTokenAcceso } from '@/lib/portal-cliente-tokens'

interface OrgPublica {
  nombre: string
  color_marca: string | null
}

// Resolución best-effort del nombre y color de la organización a partir del
// token. Si algo falla, fallback a valores genéricos — la pantalla del portal
// igual va a fetchear los datos completos al montar.
async function obtenerOrgPorToken(token: string): Promise<OrgPublica> {
  const fallback: OrgPublica = { nombre: 'Mi Portal', color_marca: null }
  try {
    const validacion = await validarTokenAcceso(token)
    if (!validacion.valido) return fallback

    const supabase = getSupabaseAdmin()
    const { data } = await supabase
      .from('configuracion')
      .select('nombre, color_marca')
      .limit(1)
      .maybeSingle()
    const prod = (data as { nombre?: string; color_marca?: string | null } | null) ?? {}
    return {
      nombre: prod.nombre || 'Mi Portal',
      color_marca: prod.color_marca ?? null,
    }
  } catch {
    return fallback
  }
}

export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  const org = await obtenerOrgPorToken(params.token)
  return {
    title: `Portal — ${org.nombre}`,
    description: `Portal personal del asegurado de ${org.nombre}`,
    robots: { index: false, follow: false },
    manifest: `/api/publico/portal-cliente/manifest/${params.token}`,
    appleWebApp: {
      capable: true,
      statusBarStyle: 'black-translucent',
      title: org.nombre.length > 12 ? org.nombre.slice(0, 12) : org.nombre,
    },
    icons: {
      icon: [
        { url: `/api/publico/portal-cliente/icono/${params.token}` },
      ],
      apple: [
        { url: `/api/publico/portal-cliente/icono/${params.token}` },
      ],
    },
  }
}

export async function generateViewport({ params }: { params: { token: string } }): Promise<Viewport> {
  const org = await obtenerOrgPorToken(params.token)
  return {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 5,
    // Usa el color de marca del PAS si lo configuró; sino el navy default.
    themeColor: org.color_marca || '#0A1628',
  }
}

export default function PortalAseguradoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen bg-slate-50 text-slate-900"
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif' }}
    >
      {children}
    </div>
  )
}
