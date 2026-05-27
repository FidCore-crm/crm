/**
 * Sentry — configuración del server (Node.js runtime).
 *
 * Captura errores del proceso de Next.js: API routes, server components,
 * server actions, y todo lo que tire una excepción no capturada en el server.
 *
 * El CRM ya tiene un sistema de errores estructurado en `src/lib/errores/`.
 * Sentry se integra sumando reporting externo a errores críticos sin
 * reemplazar la persistencia local en `errores_sistema`.
 */

import * as Sentry from '@sentry/nextjs'
import { obtenerInstalacionId } from '@/lib/instalacion-id'

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_APP_VERSION,

    sampleRate: 1.0,
    tracesSampleRate: 0,

    sendDefaultPii: false,

    // Tag global con el ID único de esta instalación. Permite filtrar issues
    // por cliente en el dashboard de Sentry sin loguear datos personales.
    initialScope: {
      tags: {
        instalacion_id: obtenerInstalacionId(),
      },
    },
  })
}
