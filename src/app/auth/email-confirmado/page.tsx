'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

/**
 * Página de confirmación tras click en el email "Confirmá tu nueva dirección".
 * GoTrue ya aplicó el cambio (actualizó `email` y limpió `email_change` en
 * auth.users) cuando llegamos acá. Solo mostramos confirmación y redirigimos.
 *
 * Si hubo error (token expirado, link inválido), GoTrue manda el `error_description`
 * en el fragment.
 */
function EmailConfirmadoContent() {
  const router = useRouter()
  const [estado, setEstado] = useState<'cargando' | 'ok' | 'error'>('cargando')
  const [mensaje, setMensaje] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const hash = window.location.hash.replace(/^#/, '')
    const params = new URLSearchParams(hash)
    const errorDescription = params.get('error_description')

    if (errorDescription) {
      setEstado('error')
      setMensaje(decodeURIComponent(errorDescription.replace(/\+/g, ' ')))
    } else {
      setEstado('ok')
      setMensaje('Tu nuevo email quedó confirmado. La próxima vez que ingreses, usá este email.')
    }
    window.history.replaceState(null, '', window.location.pathname)
  }, [])

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      <div
        className="relative flex flex-col px-8 py-10 lg:py-0 lg:w-1/2 overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #0A1628 0%, #1E3A5F 60%, #2A4A7A 100%)',
        }}
      >
        <div
          className="absolute inset-0 opacity-[0.05] pointer-events-none"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 30%, white 1px, transparent 1px), radial-gradient(circle at 80% 70%, white 1px, transparent 1px)',
            backgroundSize: '60px 60px, 90px 90px',
          }}
          aria-hidden="true"
        />
        <div className="relative z-10 flex-1 flex items-center justify-center min-h-[160px] lg:min-h-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/branding/fidcore-logo.svg"
            alt="FidCore"
            className="h-16 lg:h-24 w-auto select-none"
            draggable={false}
          />
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center bg-white px-6 py-10 lg:py-0">
        <div className="w-full max-w-md text-center">
          {estado === 'cargando' && (
            <Loader2 className="h-8 w-8 animate-spin text-slate-400 mx-auto" />
          )}

          {estado === 'ok' && (
            <>
              <CheckCircle2 className="h-12 w-12 text-emerald-600 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-slate-900 mb-2">
                Email confirmado
              </h2>
              <p className="text-sm text-slate-600 mb-6">{mensaje}</p>
              <button
                onClick={() => router.push('/login')}
                className="h-10 px-6 rounded-md text-sm font-medium text-white bg-slate-900 hover:bg-slate-800"
              >
                Ir al login
              </button>
            </>
          )}

          {estado === 'error' && (
            <>
              <AlertCircle className="h-12 w-12 text-red-600 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-slate-900 mb-2">
                No se pudo confirmar
              </h2>
              <p className="text-sm text-slate-600 mb-6">{mensaje}</p>
              <button
                onClick={() => router.push('/login')}
                className="h-10 px-6 rounded-md text-sm font-medium text-white bg-slate-900 hover:bg-slate-800"
              >
                Ir al login
              </button>
            </>
          )}

          <p className="text-xs text-slate-400 text-center mt-10">
            © {new Date().getFullYear()} FidCore
          </p>
        </div>
      </div>
    </div>
  )
}

export default function EmailConfirmadoPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      }
    >
      <EmailConfirmadoContent />
    </Suspense>
  )
}
