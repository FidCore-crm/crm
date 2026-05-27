/**
 * Hook de instrumentación de Next.js — punto de entrada de Sentry server-side.
 *
 * Next.js llama a `register()` una vez al arrancar el server. Acá decidimos
 * qué config cargar según el runtime (Node.js vs Edge).
 *
 * Requiere `experimental.instrumentationHook: true` en next.config.js (Next 14).
 * En Next 15+ ya es estable y no requiere flag.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config')
  }
}

// Re-exportar el helper de Sentry para que Next.js capture errores async
// del request lifecycle (Next 15+; en 14 es no-op pero no rompe).
export { captureRequestError as onRequestError } from '@sentry/nextjs'
