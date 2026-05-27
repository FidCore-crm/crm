/**
 * Sentry — configuración del Edge runtime.
 *
 * El CRM no usa Edge runtime hoy (todo corre en Node.js), pero Next.js carga
 * este archivo de todas formas para middleware y rutas que opten por Edge.
 * Configurarlo asegura que si en el futuro se activa, el reporting funciona.
 */

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_APP_VERSION,

    sampleRate: 1.0,
    tracesSampleRate: 0,

    sendDefaultPii: false,
  })
}
