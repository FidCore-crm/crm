'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Toaster } from 'sonner'
import { Sidebar } from '@/components/layout/sidebar'
import { Navbar } from '@/components/layout/navbar'
import { CronPolizas } from '@/components/CronPolizas'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { BannerLicencia } from '@/components/BannerLicencia'
import { LicenciaGuard } from '@/components/LicenciaGuard'
import { OnboardingGuard } from '@/components/OnboardingGuard'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { LicenciaProvider } from '@/contexts/LicenciaContext'
import { OnboardingProvider } from '@/contexts/OnboardingContext'

function CRMContent({ children }: { children: React.ReactNode }) {
  const { usuario, loading } = useAuth()
  const pathname = usePathname()
  const router = useRouter()
  const enOnboarding = pathname?.startsWith('/crm/onboarding') ?? false

  useEffect(() => {
    if (!loading && !usuario) {
      router.replace('/login')
    }
  }, [loading, usuario, router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando...
        </div>
      </div>
    )
  }

  if (!usuario) return null

  // Modo wizard: fullscreen sin sidebar/navbar. OnboardingGuard maneja los
  // redirects (entrar acá solo si no terminó; salir de acá cuando termine).
  if (enOnboarding) {
    return (
      <div className="min-h-screen bg-slate-50">
        <ErrorBoundary>
          <OnboardingGuard>{children}</OnboardingGuard>
        </ErrorBoundary>
        <Toaster
          position="bottom-right"
          richColors
          closeButton
          duration={5000}
        />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Sidebar oculto en mobile (<md = 768px); el CRM admin está pensado
          para PC/tablet. En mobile mostramos un banner avisando. */}
      <div className="hidden md:block">
        <Sidebar />
      </div>
      <Navbar />
      <CronPolizas />
      <main
        className="flex flex-col min-h-screen crm-main"
        style={{ paddingTop: 'var(--navbar-height)' }}
      >
        <BannerLicencia />
        {/* Aviso en mobile — el CRM admin no está optimizado para teléfonos */}
        <div className="md:hidden bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-900">
          Este sistema está optimizado para PC o tablet. En el teléfono algunas pantallas pueden quedar incómodas.
        </div>
        <div className="flex-1 p-4 animate-fade-in">
          <ErrorBoundary>
            <OnboardingGuard>
              <LicenciaGuard>{children}</LicenciaGuard>
            </OnboardingGuard>
          </ErrorBoundary>
        </div>
      </main>
      <Toaster
        position="bottom-right"
        richColors
        closeButton
        duration={5000}
      />
    </div>
  )
}

export default function CRMLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthProvider>
      <OnboardingProvider>
        <LicenciaProvider>
          <CRMContent>{children}</CRMContent>
        </LicenciaProvider>
      </OnboardingProvider>
    </AuthProvider>
  )
}
