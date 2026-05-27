/**
 * Sentry — configuración del browser (client-side).
 *
 * Captura errores que ocurren en el código que corre en el navegador del PAS.
 * NOTA: hoy el sistema de errores del CRM está orientado a backend (errores de
 * API routes y libs); el client-side reportará automáticamente excepciones no
 * capturadas y errores del ErrorBoundary global cuando aplique.
 */

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_APP_VERSION,

    // 100% de errores. No usamos performance monitoring (tracesSampleRate=0)
    // para no consumir cuota gratuita en datos que no nos interesan hoy.
    sampleRate: 1.0,
    tracesSampleRate: 0,

    // No reportar PII automáticamente (mails, IPs, etc). El CRM maneja datos
    // sensibles del PAS y sus clientes — todo lo que llegue a Sentry tiene
    // que ser explícito vía `tags` o `contexts` en captureException.
    sendDefaultPii: false,

    // Ignorar errores que no son accionables (extensiones del browser,
    // ad-blockers, etc).
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
    ],
  })
}
