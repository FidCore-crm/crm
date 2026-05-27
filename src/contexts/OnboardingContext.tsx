'use client'

/**
 * OnboardingContext — provee el estado del wizard de configuración inicial.
 *
 * Se carga al montar el layout del CRM. Si el admin todavía no terminó el
 * wizard, `onboarding_completado` es false y los guards del layout lo
 * redirigen a /crm/onboarding.
 *
 * Solo los admins ven el wizard. Para usuarios PROPIA `onboarding_completado`
 * siempre se reporta como true desde el server (no aplica).
 */

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'

export interface OnboardingEstado {
  onboarding_completado: boolean
  onboarding_completado_at: string | null
  onboarding_paso_actual: number
}

interface OnboardingContextType {
  estado: OnboardingEstado | null
  loading: boolean
  refetch: () => Promise<void>
  guardarPaso: (paso: number) => Promise<void>
  marcarCompletado: () => Promise<void>
}

const OnboardingContext = createContext<OnboardingContextType>({
  estado: null,
  loading: true,
  refetch: async () => {},
  guardarPaso: async () => {},
  marcarCompletado: async () => {},
})

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<OnboardingEstado | null>(null)
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    try {
      const res = await fetch('/api/onboarding/estado', { cache: 'no-store' })
      if (res.ok) {
        const json = await res.json()
        if (json.ok && json.data) {
          setEstado(json.data as OnboardingEstado)
        }
      } else if (res.status === 401 || res.status === 403) {
        // No autenticado o no admin: tratamos como "no aplica" → completado
        setEstado({
          onboarding_completado: true,
          onboarding_completado_at: null,
          onboarding_paso_actual: 0,
        })
      }
    } catch {
      // En error de red asumimos completado para no bloquear al usuario
      setEstado({
        onboarding_completado: true,
        onboarding_completado_at: null,
        onboarding_paso_actual: 0,
      })
    } finally {
      setLoading(false)
    }
  }, [])

  const guardarPaso = useCallback(async (paso: number) => {
    const res = await fetch('/api/onboarding/progreso', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paso_actual: paso }),
    })
    if (!res.ok) {
      // Propagamos al caller para que muestre toast de error. NO actualizamos
      // estado local — sino el usuario vería el wizard avanzar aunque el back-end
      // rechazó (queda inconsistente con la próxima recarga).
      const detalle = await res.text().catch(() => 'desconocido')
      throw new Error(`No se pudo guardar el progreso (HTTP ${res.status}): ${detalle.slice(0, 200)}`)
    }
    setEstado((prev) =>
      prev ? { ...prev, onboarding_paso_actual: paso } : prev
    )
  }, [])

  const marcarCompletado = useCallback(async () => {
    // Mandamos también paso_actual para que el endpoint pueda validar que el
    // wizard efectivamente llegó al último paso (el backend chequea pasoFinal
    // contra TOTAL_PASOS-1). Esto evita que un curl manual marque "completado"
    // saltándose pasos.
    const ULTIMO_PASO = 6
    const res = await fetch('/api/onboarding/progreso', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completado: true, paso_actual: ULTIMO_PASO }),
    })
    if (!res.ok) {
      const detalle = await res.text().catch(() => 'desconocido')
      throw new Error(`No se pudo completar el wizard (HTTP ${res.status}): ${detalle.slice(0, 200)}`)
    }
    setEstado((prev) =>
      prev
        ? {
            ...prev,
            onboarding_completado: true,
            onboarding_completado_at: new Date().toISOString(),
          }
        : prev
    )
  }, [])

  useEffect(() => {
    void refetch()
  }, [refetch])

  return (
    <OnboardingContext.Provider
      value={{ estado, loading, refetch, guardarPaso, marcarCompletado }}
    >
      {children}
    </OnboardingContext.Provider>
  )
}

export function useOnboarding(): OnboardingContextType {
  return useContext(OnboardingContext)
}
