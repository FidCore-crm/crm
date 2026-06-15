'use client'

/**
 * Layout reusable para cada paso del wizard de onboarding.
 *
 * Provee:
 *   - Fondo navy gradient (consistente con /login y /setup)
 *   - Header con logo FidCore (sobre navy)
 *   - Barra de progreso naranja con N pasos
 *   - Card blanca centrada con título + descripción + slot del paso
 *   - Footer sticky con botones "Atrás" / "Saltear" / "Continuar"
 */

import { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface WizardLayoutProps {
  pasoActual: number       // 0-based
  totalPasos: number
  titulo: string
  descripcion?: string
  children: ReactNode
  // Acciones del footer
  onAtras?: () => void
  onSkip?: () => void
  onContinuar?: () => void
  continuarLabel?: string
  continuarHabilitado?: boolean
  continuarLoading?: boolean
  // Si true, no se muestra el footer (útil para pantallas de bienvenida/final)
  sinFooter?: boolean
}

const GRADIENT_NAVY = 'linear-gradient(135deg, #0A1628 0%, #1E3A5F 60%, #2A4A7A 100%)'

export function WizardLayout({
  pasoActual,
  totalPasos,
  titulo,
  descripcion,
  children,
  onAtras,
  onSkip,
  onContinuar,
  continuarLabel = 'Continuar',
  continuarHabilitado = true,
  continuarLoading = false,
  sinFooter = false,
}: WizardLayoutProps) {
  const porcentaje = Math.round(((pasoActual + 1) / totalPasos) * 100)

  return (
    <div
      className="min-h-screen flex flex-col relative overflow-hidden"
      style={{ background: GRADIENT_NAVY }}
    >
      {/* Patrón sutil de puntos sobre el navy (mismo que login/setup) */}
      <div
        className="absolute inset-0 opacity-[0.05] pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 30%, white 1px, transparent 1px), radial-gradient(circle at 80% 70%, white 1px, transparent 1px)',
          backgroundSize: '60px 60px, 90px 90px',
        }}
        aria-hidden="true"
      />

      {/* Header con logo FidCore */}
      <header className="relative z-10 border-b border-white/10 backdrop-blur-sm bg-[#0A1628]/40">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/branding/fidcore-logo.svg"
            alt="FidCore"
            className="h-7 w-auto select-none"
            draggable={false}
          />
          <span className="text-xs text-white/70">
            Paso {pasoActual + 1} de {totalPasos}
          </span>
        </div>
        {/* Barra de progreso */}
        <div className="h-1 bg-white/10">
          <div
            className="h-full bg-gradient-to-r from-orange-500 to-orange-600 transition-all duration-300"
            style={{ width: `${porcentaje}%` }}
          />
        </div>
      </header>

      {/* Contenido del paso */}
      <main className="flex-1 overflow-y-auto relative z-10">
        <div className="max-w-4xl mx-auto px-6 py-8 pb-24">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-white tracking-tight">{titulo}</h1>
            {descripcion && (
              <p className="mt-2 text-md text-white/80 leading-relaxed">{descripcion}</p>
            )}
          </div>
          {children}
        </div>
      </main>

      {/* Footer sticky con navegación */}
      {!sinFooter && (
        <footer className="relative z-10 border-t border-white/10 backdrop-blur-sm bg-[#0A1628]/60 sticky bottom-0">
          <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between gap-3">
            <div>
              {onAtras && (
                <button
                  type="button"
                  onClick={onAtras}
                  className="h-9 px-3 rounded-md text-sm font-medium text-white/90 bg-white/10 hover:bg-white/15 border border-white/10 hover:border-white/20 transition-colors flex items-center gap-1"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Atrás
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              {onSkip && (
                <button
                  type="button"
                  onClick={onSkip}
                  className="h-9 px-3 rounded-md text-sm font-medium text-white/90 bg-white/10 hover:bg-white/15 border border-white/20 hover:border-white/30 transition-colors"
                >
                  Saltear, lo configuro después
                </button>
              )}
              {onContinuar && (
                <button
                  type="button"
                  onClick={onContinuar}
                  disabled={!continuarHabilitado || continuarLoading}
                  className="h-9 px-4 rounded-md text-sm font-medium text-white bg-[#E85D1F] hover:bg-[#D14F12] active:bg-[#BC4710] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                >
                  {continuarLoading ? 'Guardando...' : continuarLabel}
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </footer>
      )}
    </div>
  )
}
