'use client'

import { useState, useEffect, FormEvent, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ShieldCheck, AlertCircle } from 'lucide-react'

/**
 * Página donde aterriza el usuario después de hacer click en el email de
 * "Recuperar contraseña". GoTrue inserta access_token y refresh_token en
 * el URL fragment (#access_token=...&refresh_token=...&type=recovery).
 *
 * Esta página:
 *   1. Parsea el fragment (solo accesible client-side)
 *   2. Si no hay tokens, muestra error
 *   3. Si los hay, muestra form para nueva contraseña
 *   4. Al enviar, llama a POST /api/auth/setear-nueva-password con los tokens
 *   5. Si OK, redirige al dashboard (las cookies ya quedaron seteadas)
 */
function NuevaPasswordContent() {
  const router = useRouter()
  const [tokens, setTokens] = useState<{ access_token: string; refresh_token: string } | null>(null)
  const [errorInicial, setErrorInicial] = useState('')
  const [pass1, setPass1] = useState('')
  const [pass2, setPass2] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    // Parsear fragment del URL
    if (typeof window === 'undefined') return
    const hash = window.location.hash.replace(/^#/, '')
    if (!hash) {
      setErrorInicial('Link inválido o expirado. Pedí uno nuevo desde la pantalla de login.')
      return
    }
    const params = new URLSearchParams(hash)
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    const errorDescription = params.get('error_description')

    if (errorDescription) {
      setErrorInicial(decodeURIComponent(errorDescription.replace(/\+/g, ' ')))
      return
    }
    if (!accessToken || !refreshToken) {
      setErrorInicial('Link inválido o expirado. Pedí uno nuevo desde la pantalla de login.')
      return
    }

    setTokens({ access_token: accessToken, refresh_token: refreshToken })

    // Limpiar el fragment del URL para que no quede en el historial
    window.history.replaceState(null, '', window.location.pathname)
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!tokens) {
      setError('Faltan datos. Pedí un link nuevo desde la pantalla de login.')
      return
    }
    if (pass1.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres')
      return
    }
    if (pass1 !== pass2) {
      setError('Las contraseñas no coinciden')
      return
    }

    setEnviando(true)
    try {
      const res = await fetch('/api/auth/setear-nueva-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          password_nueva: pass1,
        }),
      })
      const json = await res.json()
      if (json.ok) {
        router.push('/crm/dashboard')
      } else {
        setError(json.error || 'No se pudo actualizar la contraseña')
      }
    } catch {
      setError('Error de conexión')
    }
    setEnviando(false)
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Panel izquierdo (branding) */}
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
            src="/branding/pulzar-logo.svg"
            alt="Pulzar"
            className="h-16 lg:h-24 w-auto select-none"
            draggable={false}
          />
        </div>
      </div>

      {/* Panel derecho */}
      <div className="flex-1 flex items-center justify-center bg-white px-6 py-10 lg:py-0">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 text-emerald-600" />
            <div>
              <h2 className="text-xl font-semibold text-slate-900 tracking-tight">
                Definir nueva contraseña
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                Ingresá tu nueva contraseña
              </p>
            </div>
          </div>

          {errorInicial ? (
            <div className="flex flex-col gap-4">
              <div className="p-4 bg-red-50 border border-red-200 rounded-md flex items-start gap-2.5">
                <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-700">{errorInicial}</p>
              </div>
              <button
                onClick={() => router.push('/login')}
                className="h-10 rounded-md text-sm font-medium text-white bg-slate-900 hover:bg-slate-800"
              >
                Volver al login
              </button>
            </div>
          ) : !tokens ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Nueva contraseña <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  autoFocus
                  value={pass1}
                  onChange={(e) => setPass1(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  className="w-full h-10 px-3 text-sm rounded-md border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Repetir contraseña <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  required
                  value={pass2}
                  onChange={(e) => setPass2(e.target.value)}
                  className="w-full h-10 px-3 text-sm rounded-md border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
              {error && (
                <p className="text-xs text-red-600 text-center bg-red-50 border border-red-200 rounded px-3 py-2">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={enviando}
                className="w-full h-10 mt-2 rounded-md text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 active:bg-slate-950 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {enviando ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Guardando…
                  </>
                ) : (
                  'Guardar y entrar'
                )}
              </button>
            </form>
          )}

          <p className="text-xs text-slate-400 text-center mt-10">
            © {new Date().getFullYear()} Pulzar
          </p>
        </div>
      </div>
    </div>
  )
}

export default function NuevaPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      }
    >
      <NuevaPasswordContent />
    </Suspense>
  )
}
