'use client'

import { Component, ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Loggear al backend — fire-and-forget
    try {
      fetch('/api/errores-sistema/cliente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codigo: 'ERR_SYS_001',
          mensaje: error.message,
          stack_trace: error.stack,
          componente: errorInfo.componentStack,
          url: typeof window !== 'undefined' ? window.location.href : '',
        }),
      }).catch(() => {
        // Evitar bucle infinito si falla el logueo
      })
    } catch {
      // no-op
    }
  }

  recargar = () => {
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  irAlInicio = () => {
    if (typeof window !== 'undefined') {
      window.location.href = '/crm/dashboard'
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
          <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
            <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
              <AlertTriangle className="w-8 h-8 text-red-600" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 mb-2">
              Algo salió mal
            </h1>
            <p className="text-slate-600 mb-6 text-sm">
              Ocurrió un error inesperado en la aplicación. Podés intentar
              recargar la página o volver al inicio.
            </p>

            {process.env.NODE_ENV !== 'production' && this.state.error && (
              <details className="mb-6 text-left bg-slate-50 p-3 rounded text-xs text-slate-700 border border-slate-200">
                <summary className="cursor-pointer font-mono">
                  Detalle técnico (solo visible en desarrollo)
                </summary>
                <pre className="mt-2 whitespace-pre-wrap break-all">
                  {this.state.error.message}
                  {'\n\n'}
                  {this.state.error.stack}
                </pre>
              </details>
            )}

            <div className="flex gap-3 justify-center">
              <button
                onClick={this.recargar}
                className="btn-primary flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Recargar
              </button>
              <button onClick={this.irAlInicio} className="btn-secondary">
                Ir al inicio
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
