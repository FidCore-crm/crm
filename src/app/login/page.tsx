'use client'

import { useState, useEffect, FormEvent, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Mail, X, Hourglass, ShieldCheck, MailCheck } from 'lucide-react'

type ModalEstado =
  | { tipo: 'NINGUNO' }
  | { tipo: 'RECUPERAR' } // flow nuevo: pedir email para recibir link
  | { tipo: 'RECUPERAR_OK' } // confirmación post-envío
  | { tipo: 'PENDIENTE' } // legacy: solicitud de blanqueo en cola admin
  | { tipo: 'HABILITADA' } // legacy: admin habilitó, usuario define nueva pass

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const motivo = searchParams.get('motivo')
  const volver = searchParams.get('volver')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const [iniciando, setIniciando] = useState(true)
  const [modal, setModal] = useState<ModalEstado>({ tipo: 'NINGUNO' })
  const [bannerExito, setBannerExito] = useState('')

  useEffect(() => {
    async function init() {
      try {
        const setupRes = await fetch('/api/auth/check-setup')
        const setupJson = await setupRes.json()
        if (setupJson.needsSetup) {
          router.replace('/setup')
          return
        }
      } catch { /* silencioso */ }
      setIniciando(false)
    }
    init()
  }, [router])

  // Mensajes de retorno desde el endpoint de confirmación admin (legacy).
  useEffect(() => {
    if (motivo === 'blanqueo_admin_confirmado') {
      setBannerExito(
        'Confirmaste el blanqueo. Definí tu nueva contraseña iniciando sesión con tu email.',
      )
    } else if (motivo === 'blanqueo_token_invalido') {
      setError('El link de confirmación es inválido o ya expiró.')
    } else if (motivo === 'password_actualizada') {
      setBannerExito('Tu contraseña se actualizó correctamente. Ya podés iniciar sesión.')
    }
  }, [motivo])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBannerExito('')
    setCargando(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const json = await res.json()

      if (json.ok) {
        const destino = volver ? decodeURIComponent(volver) : '/crm/dashboard'
        const destinoSeguro = destino.startsWith('/crm') ? destino : '/crm/dashboard'
        router.push(destinoSeguro)
      } else if (json.estado === 'BLANQUEO_PENDIENTE') {
        setModal({ tipo: 'PENDIENTE' })
      } else if (json.estado === 'BLANQUEO_HABILITADA') {
        setModal({ tipo: 'HABILITADA' })
      } else {
        setError(json.error || 'Error al iniciar sesión')
      }
    } catch {
      setError('Error de conexión')
    }

    setCargando(false)
  }

  if (iniciando) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    )
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
        <p className="relative z-10 mt-6 lg:mt-0 lg:pb-12 text-center text-base lg:text-lg text-white/85 font-light leading-relaxed max-w-md mx-auto">
          Sistema de gestión para Productores Asesores de Seguros
        </p>
      </div>

      {/* Panel derecho (form) */}
      <div className="flex-1 flex items-center justify-center bg-white px-6 py-10 lg:py-0">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <h2 className="text-2xl font-semibold text-slate-900 tracking-tight">
              Iniciar sesión
            </h2>
            <p className="text-sm text-slate-500 mt-1.5">
              Ingresá tus credenciales para acceder
            </p>
          </div>

          {motivo === 'sesion_expirada' && (
            <div className="mb-5 p-3 bg-amber-50 border border-amber-200 rounded-md text-amber-800 text-xs">
              Tu sesión expiró. Iniciá sesión de nuevo para continuar.
            </div>
          )}

          {bannerExito && (
            <div className="mb-5 p-3 bg-emerald-50 border border-emerald-200 rounded-md text-emerald-800 text-xs">
              {bannerExito}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Email
              </label>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="tu@email.com"
                className="w-full h-10 px-3 text-sm rounded-md border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-slate-700">
                  Contraseña
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setError('')
                    setModal({ tipo: 'RECUPERAR' })
                  }}
                  className="text-xs text-blue-600 hover:text-blue-800 underline-offset-2 hover:underline"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full h-10 px-3 text-sm rounded-md border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={cargando}
              className="w-full h-10 mt-2 rounded-md text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 active:bg-slate-950 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {cargando ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Ingresando…
                </>
              ) : (
                'Ingresar'
              )}
            </button>

            {error && (
              <p className="text-xs text-red-600 text-center bg-red-50 border border-red-200 rounded px-3 py-2">
                {error}
              </p>
            )}
          </form>

          <p className="text-xs text-slate-400 text-center mt-10">
            © {new Date().getFullYear()} Pulzar
          </p>
        </div>
      </div>

      {/* Modales */}
      {modal.tipo === 'RECUPERAR' && (
        <ModalRecuperar
          emailPrellenado={email.trim()}
          onClose={() => setModal({ tipo: 'NINGUNO' })}
          onEnviado={() => setModal({ tipo: 'RECUPERAR_OK' })}
        />
      )}
      {modal.tipo === 'RECUPERAR_OK' && (
        <ModalRecuperarOk onClose={() => setModal({ tipo: 'NINGUNO' })} />
      )}
      {modal.tipo === 'PENDIENTE' && (
        <ModalPendiente onClose={() => setModal({ tipo: 'NINGUNO' })} />
      )}
      {modal.tipo === 'HABILITADA' && (
        <ModalDefinirNueva
          email={email.trim()}
          onClose={() => setModal({ tipo: 'NINGUNO' })}
          onDefinida={() => {
            const destino = volver ? decodeURIComponent(volver) : '/crm/dashboard'
            const destinoSeguro = destino.startsWith('/crm') ? destino : '/crm/dashboard'
            router.push(destinoSeguro)
          }}
        />
      )}
    </div>
  )
}

// ───────────────────────────────────────────────────────────
// MODAL: recuperar contraseña (flow nuevo Supabase Auth)
// ───────────────────────────────────────────────────────────
function ModalRecuperar({
  emailPrellenado,
  onClose,
  onEnviado,
}: {
  emailPrellenado: string
  onClose: () => void
  onEnviado: () => void
}) {
  const [emailLocal, setEmailLocal] = useState(emailPrellenado)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!emailLocal.trim()) {
      setError('Ingresá tu email')
      return
    }
    setEnviando(true)
    try {
      const res = await fetch('/api/auth/recuperar-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailLocal.trim() }),
      })
      const json = await res.json()
      if (json.ok) {
        onEnviado()
      } else {
        setError(json.error || 'No se pudo enviar el email')
      }
    } catch {
      setError('Error de conexión')
    }
    setEnviando(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md border border-slate-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-slate-700" />
            <h3 className="text-sm font-semibold text-slate-800">
              Recuperar contraseña
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 flex flex-col gap-3">
          <p className="text-sm text-slate-700">
            Te vamos a mandar un email con un link para definir una contraseña nueva.
          </p>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              required
              autoFocus
              value={emailLocal}
              onChange={(e) => setEmailLocal(e.target.value)}
              placeholder="tu@email.com"
              className="w-full h-10 px-3 text-sm rounded-md border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>
          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={enviando}
              className="h-8 px-3 text-xs font-medium text-slate-600 hover:text-slate-800 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={enviando}
              className="h-8 px-3 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50 flex items-center gap-1.5"
            >
              {enviando && <Loader2 className="h-3 w-3 animate-spin" />}
              Enviarme el link
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────
// MODAL: confirmación post-envío
// ───────────────────────────────────────────────────────────
function ModalRecuperarOk({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md border border-slate-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <MailCheck className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-slate-800">
              Revisá tu email
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4 flex flex-col gap-2.5">
          <p className="text-sm text-slate-700">
            Si la cuenta existe, te enviamos un email con un link para definir tu nueva contraseña.
          </p>
          <p className="text-xs text-slate-500">
            El link expira en 1 hora. Si no ves el email, revisá la carpeta de spam.
          </p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100 rounded-b-lg">
          <button
            onClick={onClose}
            className="h-8 px-3 text-xs font-medium text-slate-600 hover:text-slate-800"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────
// MODAL: ya solicitaste, está pendiente (LEGACY — flujo viejo de blanqueo)
// ───────────────────────────────────────────────────────────
function ModalPendiente({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md border border-slate-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Hourglass className="h-4 w-4 text-amber-600" />
            <h3 className="text-sm font-semibold text-slate-800">
              Solicitud pendiente
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-slate-700">
            Tu solicitud de blanqueo está pendiente. Aguardá la confirmación del administrador.
          </p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100 rounded-b-lg">
          <button
            onClick={onClose}
            className="h-8 px-3 text-xs font-medium text-slate-600 hover:text-slate-800"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────
// MODAL: definir nueva contraseña (LEGACY — flujo viejo de blanqueo)
// ───────────────────────────────────────────────────────────
function ModalDefinirNueva({
  email,
  onClose,
  onDefinida,
}: {
  email: string
  onClose: () => void
  onDefinida: () => void
}) {
  const [pass1, setPass1] = useState('')
  const [pass2, setPass2] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
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
      const res = await fetch('/api/auth/blanquear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password_nueva: pass1 }),
      })
      const json = await res.json()
      if (json.ok) {
        onDefinida()
      } else {
        setError(json.error || 'No se pudo definir la contraseña')
      }
    } catch {
      setError('Error de conexión')
    }
    setEnviando(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md border border-slate-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-slate-800">
              Definir nueva contraseña
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 flex flex-col gap-3">
          <p className="text-sm text-slate-700">
            Definí una nueva contraseña para{' '}
            <span className="font-medium text-slate-900">{email}</span>.
          </p>
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
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={enviando}
              className="h-8 px-3 text-xs font-medium text-slate-600 hover:text-slate-800 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={enviando}
              className="h-8 px-3 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50 flex items-center gap-1.5"
            >
              {enviando && <Loader2 className="h-3 w-3 animate-spin" />}
              Definir y entrar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  )
}
