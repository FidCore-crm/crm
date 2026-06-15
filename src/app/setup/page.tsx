'use client'

import { useState, useEffect, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

export default function SetupPage() {
  const router = useRouter()
  const [nombre, setNombre] = useState('')
  const [apellido, setApellido] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const [verificando, setVerificando] = useState(true)

  useEffect(() => {
    async function verificar() {
      try {
        const res = await fetch('/api/auth/check-setup')
        const json = await res.json()
        if (!json.needsSetup) {
          router.replace('/login')
          return
        }
      } catch { /* silencioso */ }
      setVerificando(false)
    }
    verificar()
  }, [router])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres')
      return
    }
    if (password !== password2) {
      setError('Las contraseñas no coinciden')
      return
    }

    setCargando(true)
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: nombre.trim(), apellido: apellido.trim(), email: email.trim(), password }),
      })
      const json = await res.json()

      if (json.ok) {
        router.push('/crm/dashboard')
      } else {
        if (json.error === 'El sistema ya fue configurado.') {
          router.replace('/login')
        } else {
          setError(json.error || 'Error al crear el administrador')
        }
      }
    } catch {
      setError('Error de conexión')
    }
    setCargando(false)
  }

  if (verificando) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'linear-gradient(135deg, #0A1628 0%, #1E3A5F 60%, #2A4A7A 100%)' }}
      >
        <Loader2 className="h-6 w-6 animate-spin text-white/60" />
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
            src="/branding/fidcore-logo.svg"
            alt="FidCore"
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
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-orange-50 border border-orange-200 mb-3">
              <span className="h-1.5 w-1.5 rounded-full bg-[#E85D1F]" />
              <span className="text-2xs font-medium text-[#E85D1F] uppercase tracking-wide">
                Configuración inicial
              </span>
            </div>
            <h2 className="text-2xl font-semibold text-slate-900 tracking-tight">
              Creá tu administrador
            </h2>
            <p className="text-sm text-slate-500 mt-1.5">
              Este será el primer usuario del sistema. Vas a poder invitar más colaboradores después.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Nombre</label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={nombre}
                  onChange={e => setNombre(e.target.value)}
                  placeholder="Juan"
                  className="w-full h-10 px-3 text-sm rounded-md border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Apellido</label>
                <input
                  type="text"
                  required
                  value={apellido}
                  onChange={e => setApellido(e.target.value)}
                  placeholder="Pérez"
                  className="w-full h-10 px-3 text-sm rounded-md border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="tu@email.com"
                className="w-full h-10 px-3 text-sm rounded-md border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Contraseña</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="w-full h-10 px-3 text-sm rounded-md border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Repetir contraseña</label>
              <input
                type="password"
                required
                value={password2}
                onChange={e => setPassword2(e.target.value)}
                placeholder="Repetí la contraseña"
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
                  Creando…
                </>
              ) : (
                'Crear administrador y empezar'
              )}
            </button>

            {error && (
              <p className="text-xs text-red-600 text-center bg-red-50 border border-red-200 rounded px-3 py-2">
                {error}
              </p>
            )}
          </form>

          <p className="text-xs text-slate-400 text-center mt-10">
            Después de crear el administrador, vas a poder configurar tu perfil, licencia y módulos opcionales.
          </p>
        </div>
      </div>
    </div>
  )
}
