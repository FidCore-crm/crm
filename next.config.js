const { withSentryConfig } = require('@sentry/nextjs')
const packageJson = require('./package.json')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Single source of truth para la versión del CRM. Se lee de package.json y
  // queda inlineada en el bundle del browser (sidebar, /actualizaciones, etc).
  // Pisa cualquier NEXT_PUBLIC_APP_VERSION que venga del entorno, así no hay
  // riesgo de que el default '1.0.0' de docker-compose se cuele en un build.
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
  },
  // Standalone output: el build genera un bundle minimalista en .next/standalone
  // con solo las deps que el runtime usa, listo para correr con `node server.js`
  // dentro de un container chico (alpine + node). Reduce ~70% el tamaño del image.
  output: 'standalone',
  experimental: {
    // pdf-parse (v1.1.1) trae pdfjs.js embebido con require() dinámicos que
    // webpack no puede bundlear. Marcarlo como externo hace que se resuelva
    // desde node_modules en el standalone. La v2 (pdfjs-dist v5) necesita
    // polyfills DOM (DOMMatrix, ImageData) que no existen en Node — por eso
    // volvimos a v1 (usa pdfjs legacy que corre en Node puro).
    serverComponentsExternalPackages: ['pdf-parse'],
    // Next.js 14: instrumentation.ts requiere este flag. En Next.js 15+ es estable.
    instrumentationHook: true,
  },
  images: {
    // remotePatterns acepta cualquier hostname HTTP/HTTPS porque cada
    // instalación tiene su URL propia (Cloudflare Tunnel, IP de LAN, dominio
    // del PAS, etc.). Las imágenes de Supabase Storage llegan vía la URL
    // configurada por el PAS al instalar.
    remotePatterns: [
      { protocol: 'http', hostname: '**' },
      { protocol: 'https', hostname: '**' },
    ],
  },
  // Path-based proxy a Supabase. Permite que el browser le pegue al CRM en
  // `https://<cliente>.fidcore.com.ar/supabase/*` y Next.js lo reescribe
  // internamente al kong de Supabase via la network Docker. Evita necesitar
  // un subdominio anidado (`api.<cliente>.fidcore.com.ar`) que requeriría
  // ACM en Cloudflare para el SSL.
  //
  // Solo se usa en producción (Docker). En dev el `NEXT_PUBLIC_SUPABASE_URL`
  // apunta directo al kong por LAN/localhost y el rewrite queda dormido.
  async rewrites() {
    return [
      {
        source: '/supabase/:path*',
        destination: `${process.env.SUPABASE_INTERNAL_URL || 'http://supabase-kong:8000'}/:path*`,
      },
    ]
  },
}

// withSentryConfig agrega upload de source maps al build (si SENTRY_AUTH_TOKEN
// está presente en CI), ofuscación de stack traces, y tunneling para evadir
// ad-blockers. Si no hay DSN configurada, la inicialización runtime es no-op
// pero el wrapper se ejecuta igual sin errores.
const sentryConfig = {
  // Sentry CLI options — solo aplican si hay SENTRY_AUTH_TOKEN en build.
  // Sin token, el plugin loguea un warning y sigue sin subir source maps.
  silent: !process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Reduce el tamaño de los bundles del browser (los SDK files de Sentry son
  // grandes y la mayoría no se usan).
  widenClientFileUpload: true,

  // Tunneling — proxyea los eventos a través del propio dominio del CRM
  // para evitar que ad-blockers los corten. Útil cuando los PAS tengan
  // extensiones del browser.
  tunnelRoute: '/monitoring',

  // No subir source maps si no hay token (build local del dev).
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },

  // Capturar errores de React Server Components automáticamente.
  reactComponentAnnotation: {
    enabled: true,
  },

  // Si el upload falla, no romper el build.
  errorHandler: (err) => {
    // eslint-disable-next-line no-console
    console.warn('[sentry] Build warning:', err.message)
  },
}

module.exports = withSentryConfig(nextConfig, sentryConfig)
