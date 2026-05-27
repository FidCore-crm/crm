'use client'

/**
 * Global error boundary del App Router — última red de seguridad.
 *
 * Next.js renderiza este componente cuando un error escapa de todos los
 * `error.tsx` y `ErrorBoundary` de la aplicación. Lo aprovechamos para
 * reportar a Sentry y mostrar una pantalla de recuperación mínima.
 *
 * El `ErrorBoundary` global del CRM (en `src/components/ErrorBoundary.tsx`)
 * captura la mayoría de los errores de renderizado dentro del layout del
 * CRM. Este `global-error.tsx` cubre el caso más extremo: que el layout
 * mismo falle.
 */

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html>
      <body>
        <div
          style={{
            display: 'flex',
            minHeight: '100vh',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <div style={{ maxWidth: '480px', textAlign: 'center' }}>
            <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>
              Algo salió mal
            </h1>
            <p style={{ color: '#666', marginBottom: '1.5rem' }}>
              Ocurrió un error inesperado. Lo registramos automáticamente para
              poder revisarlo.
            </p>
            <button
              onClick={() => reset()}
              style={{
                padding: '0.5rem 1.25rem',
                backgroundColor: '#0A1628',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Reintentar
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
