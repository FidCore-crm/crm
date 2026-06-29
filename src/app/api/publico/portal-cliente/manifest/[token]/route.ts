/**
 * Manifest dinámico de la PWA del portal del asegurado.
 *
 *   GET /api/publico/portal-cliente/manifest/[token]
 *
 * Devuelve un Web App Manifest JSON personalizado por token:
 *   - `name` y `short_name` con el nombre de la organización del PAS.
 *   - `start_url` y `scope` apuntando a `/c/[token]` → cuando el cliente
 *     instala la PWA y la abre, va directo a SU portal (no a una ruta
 *     genérica que dé 404). Eso también mantiene la app dentro del scope,
 *     así el browser oculta la barra de URL.
 *   - `theme_color` con el color de marca de la organización (o navy default).
 *   - `icons` apuntando al logo del PAS si existe, o al ícono genérico.
 *
 * Razón por la que es por-token y no global: cada PAS tiene su logo y
 * nombre. Si el PAS no usa logo, cae al ícono genérico del producto.
 *
 * No requiere autenticación — el token ya es la credencial pública del
 * cliente, igual que el endpoint /validar/[token].
 */

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { validarTokenAcceso } from '@/lib/portal-cliente-tokens'
import { getClientIp } from '@/lib/rate-limit'
import { logger } from '@/lib/errores/logger'

interface ManifestIcon {
  src: string
  sizes: string
  type?: string
  purpose?: string
}

interface ManifestPWA {
  name: string
  short_name: string
  description: string
  start_url: string
  scope: string
  display: 'standalone' | 'fullscreen' | 'minimal-ui' | 'browser'
  orientation: 'portrait' | 'landscape' | 'any'
  background_color: string
  theme_color: string
  icons: ManifestIcon[]
}

const FALLBACK: ManifestPWA = {
  name: 'Mi Portal del Asegurado',
  short_name: 'Mi Portal',
  description: 'Portal personal del asegurado',
  start_url: '/',
  scope: '/c/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#f8fafc',
  theme_color: '#0A1628',
  icons: [
    {
      src: '/portal-asegurado/icon.svg',
      sizes: 'any',
      type: 'image/svg+xml',
      purpose: 'any maskable',
    },
  ],
}

export async function GET(
  _request: Request,
  { params }: { params: { token: string } },
) {
  const token = params.token

  // Validar token (no chequea IP — los manifests pueden requerirse muchas
  // veces por instalación de PWA). Si es inválido devolvemos un manifest
  // genérico (no 404, para no romper la instalación pre-validación).
  let nombreOrg = 'Mi Productor'
  let logoPath: string | null = null
  let colorMarca: string | null = null

  try {
    const validacion = await validarTokenAcceso(token, getClientIp(_request))
    if (validacion.valido) {
      const supabase = getSupabaseAdmin()
      const { data: organizacion } = await supabase
        .from('configuracion')
        .select('nombre, logo_path, color_marca, usar_logo')
        .limit(1)
        .maybeSingle()
      const prod = (organizacion as { nombre?: string; logo_path?: string; color_marca?: string; usar_logo?: boolean } | null) ?? {}
      if (prod.nombre) nombreOrg = prod.nombre
      if (prod.color_marca) colorMarca = prod.color_marca
      if (prod.usar_logo !== false && prod.logo_path) logoPath = prod.logo_path
    }
  } catch (e) {
    logger.warn({ modulo: 'portal-cliente-manifest', mensaje: 'Error armando manifest', contexto: { token: token.slice(0, 8), error: String(e) } })
  }

  // Si el PAS tiene logo, generamos icons apuntando a un endpoint propio
  // (`/api/publico/portal-cliente/icono/[token]`) para que viva en el mismo
  // origen que la PWA y sea proxy del archivo en disco.
  const tieneLogoPropio = !!logoPath
  const icons: ManifestIcon[] = tieneLogoPropio
    ? [
        {
          src: `/api/publico/portal-cliente/icono/${token}`,
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: `/api/publico/portal-cliente/icono/${token}`,
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any',
        },
      ]
    : FALLBACK.icons

  const manifest: ManifestPWA = {
    name: `Portal — ${nombreOrg}`,
    short_name: nombreOrg.length > 12 ? nombreOrg.slice(0, 12) : nombreOrg,
    description: `Portal personal del asegurado de ${nombreOrg}`,
    // start_url y scope apuntan a /c/[token] para que la PWA al abrirse
    // vaya directo al portal del cliente y no pida login ni dé 404.
    start_url: `/c/${token}`,
    scope: `/c/${token}`,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f8fafc',
    theme_color: colorMarca || '#0A1628',
    icons,
  }

  return NextResponse.json(manifest, {
    headers: {
      'Cache-Control': 'public, max-age=300, must-revalidate',
      'Content-Type': 'application/manifest+json',
    },
  })
}
