'use client'

/**
 * OnboardingGuard — redirige al admin a /crm/onboarding si todavía no terminó
 * el wizard de configuración inicial.
 *
 * Reglas:
 *   - Si está en /crm/onboarding y el wizard ya está completado → redirige a dashboard
 *   - Si NO está en /crm/onboarding y el wizard NO está completado → redirige a onboarding
 *   - Si es usuario PROPIA (no admin), nunca se redirige (el endpoint reporta completado=true)
 *   - Si está cargando, no renderiza nada (evita flash)
 */

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useOnboarding } from '@/contexts/OnboardingContext'

export function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { estado, loading } = useOnboarding()
  const pathname = usePathname()
  const router = useRouter()

  const enOnboarding = pathname?.startsWith('/crm/onboarding') ?? false

  useEffect(() => {
    if (loading || !estado) return

    if (!estado.onboarding_completado && !enOnboarding) {
      router.replace('/crm/onboarding')
    } else if (estado.onboarding_completado && enOnboarding) {
      router.replace('/crm/dashboard')
    }
  }, [loading, estado, enOnboarding, router])

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando configuración...
        </div>
      </div>
    )
  }

  // Si el estado dice una cosa pero todavía no se ejecutó el redirect,
  // no rendericemos para evitar flash
  if (!estado) return null
  if (!estado.onboarding_completado && !enOnboarding) return null
  if (estado.onboarding_completado && enOnboarding) return null

  return <>{children}</>
}
