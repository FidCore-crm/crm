'use client'

/**
 * Wizard de onboarding del PAS.
 *
 * Aparece solo la primera vez que el admin entra al CRM (controlado por
 * OnboardingGuard en el layout). Persiste el paso actual entre sesiones para
 * que si el PAS cierra el browser, vuelva y retome donde estaba.
 *
 * Pasos:
 *   0. Bienvenida (no skippeable, solo informativo)
 *   1. Perfil (obligatorio)
 *   2. Licencia (skippeable; muestra "ya cargada" si el instalador la cargó)
 *   3. Correos / SMTP (skippeable con warning)
 *   4. Agente IA (opcional)
 *   5. Portal del Cliente (opcional)
 *   6. Final (CTA a Catálogos)
 *
 * Total: 7 pantallas. La barra de progreso usa este número total.
 */

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useOnboarding } from '@/contexts/OnboardingContext'
import { esModoVps } from '@/lib/modo-instalacion'
import { PasoBienvenida } from './pasos/PasoBienvenida'
import { PasoPerfil } from './pasos/PasoPerfil'
import { PasoLicencia } from './pasos/PasoLicencia'
import { PasoCorreos } from './pasos/PasoCorreos'
import { PasoAgenteIA } from './pasos/PasoAgenteIA'
import { PasoPortal } from './pasos/PasoPortal'
import { PasoFinal } from './pasos/PasoFinal'

const TOTAL_PASOS = 7

export default function OnboardingPage() {
  const { usuario } = useAuth()
  const { estado, loading, guardarPaso, marcarCompletado } = useOnboarding()
  const [pasoActual, setPasoActual] = useState(0)
  const [completando, setCompletando] = useState(false)

  // Inicializar desde el estado persistido
  useEffect(() => {
    if (estado && !loading) {
      // Si ya está completado, OnboardingGuard nos redirige fuera —
      // mientras tanto no hacemos nada raro
      if (estado.onboarding_completado) return
      let inicial = Math.min(estado.onboarding_paso_actual ?? 0, TOTAL_PASOS - 1)
      // En modo VPS el paso de licencia (2) no aplica — lo saltamos.
      if (inicial === 2 && esModoVps()) inicial = 3
      setPasoActual(inicial)
    }
  }, [estado, loading])

  // Auto-avanzar el paso de licencia en modo VPS. Ocurre si el usuario llega
  // al 2 con "atrás" desde correos, o si el estado persistido apuntaba a 2.
  useEffect(() => {
    if (pasoActual === 2 && esModoVps()) {
      setPasoActual(3)
      guardarPaso(3).catch(() => {})
    }
  }, [pasoActual, guardarPaso])

  // Cada vez que el usuario avanza/retrocede, persistir el paso.
  // Hacemos await + try/catch para no perder feedback si la API falla.
  const cambiarPaso = async (nuevo: number) => {
    if (nuevo < 0 || nuevo >= TOTAL_PASOS) return
    setPasoActual(nuevo)
    try {
      await guardarPaso(nuevo)
    } catch (err) {
      // Si falla el guardado del progreso, el usuario sigue en el wizard pero
      // la próxima vez que vuelva podría retomar en el paso anterior. Lo
      // notificamos para que no quede como bug silencioso.
      const { toast } = await import('@/lib/toast')
      toast.error('No se pudo guardar el progreso del wizard. Probá recargar.')
    }
  }

  const avanzar = () => cambiarPaso(pasoActual + 1)
  const retroceder = () => cambiarPaso(pasoActual - 1)
  const skip = () => cambiarPaso(pasoActual + 1)

  const completar = async (): Promise<boolean> => {
    setCompletando(true)
    try {
      await marcarCompletado()
      return true
    } catch (err) {
      const { toast } = await import('@/lib/toast')
      toast.error(err instanceof Error ? err.message : 'No se pudo completar el wizard')
      return false
    } finally {
      setCompletando(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando wizard...
        </div>
      </div>
    )
  }

  const nombreUsuario = usuario?.nombre || ''

  // Render del paso actual
  switch (pasoActual) {
    case 0:
      return (
        <PasoBienvenida
          pasoActual={0}
          totalPasos={TOTAL_PASOS}
          onContinuar={avanzar}
          nombreUsuario={nombreUsuario}
        />
      )
    case 1:
      return (
        <PasoPerfil
          pasoActual={1}
          totalPasos={TOTAL_PASOS}
          onAtras={retroceder}
          onContinuar={avanzar}
        />
      )
    case 2:
      return (
        <PasoLicencia
          pasoActual={2}
          totalPasos={TOTAL_PASOS}
          onAtras={retroceder}
          onContinuar={avanzar}
          onSkip={skip}
        />
      )
    case 3:
      return (
        <PasoCorreos
          pasoActual={3}
          totalPasos={TOTAL_PASOS}
          onAtras={retroceder}
          onContinuar={avanzar}
          onSkip={skip}
        />
      )
    case 4:
      return (
        <PasoAgenteIA
          pasoActual={4}
          totalPasos={TOTAL_PASOS}
          onAtras={retroceder}
          onContinuar={avanzar}
          onSkip={skip}
        />
      )
    case 5:
      return (
        <PasoPortal
          pasoActual={5}
          totalPasos={TOTAL_PASOS}
          onAtras={retroceder}
          onContinuar={avanzar}
          onSkip={skip}
        />
      )
    case 6:
      return (
        <PasoFinal
          pasoActual={6}
          totalPasos={TOTAL_PASOS}
          onAtras={retroceder}
          onCompletar={completar}
          completando={completando}
        />
      )
    default:
      return null
  }
}
