'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ShieldOff, Shield, ChevronRight, ArrowLeft, Copy, Check } from 'lucide-react'
import { useLicenciaEstado } from '@/contexts/LicenciaContext'
import { useAuth } from '@/contexts/AuthContext'

/**
 * Decide qué renderizar según el estado de la licencia:
 *   - Modo ACTIVA o GRACIA → renderiza children normalmente.
 *   - Modo BLOQUEADA o SIN_LICENCIA → si la ruta está en la whitelist, renderiza
 *     children (las páginas individuales se condicionan con `useEsSoloLectura()`).
 *     Si NO está en la whitelist, muestra pantalla de bloqueo.
 */

// Rutas permitidas en modo solo lectura.
// Cada una se chequea con startsWith. Lo que no matchee → pantalla de bloqueo.
const RUTAS_PERMITIDAS_SOLO_LECTURA = [
  '/crm/dashboard',
  '/crm/personas',
  '/crm/polizas',
  '/crm/siniestros',
  '/crm/configuracion',
  '/crm/notificaciones',
]

// Rutas que aún dentro de las permitidas deben bloquear (creación/edición).
const RUTAS_BLOQUEADAS_AUNQUE_PERMITIDAS = [
  '/nueva',
  '/nuevo',
  '/editar',
  '/papelera',
]

function rutaEstaPermitida(pathname: string): boolean {
  const baseOk = RUTAS_PERMITIDAS_SOLO_LECTURA.some((base) => pathname.startsWith(base))
  if (!baseOk) return false
  // Si la ruta termina o contiene alguna de las sub-rutas bloqueadas, denegar.
  for (const sub of RUTAS_BLOQUEADAS_AUNQUE_PERMITIDAS) {
    if (pathname.endsWith(sub) || pathname.includes(`${sub}/`)) return false
  }
  return true
}

export function LicenciaGuard({ children }: { children: React.ReactNode }) {
  const { estado, loading } = useLicenciaEstado()
  const { isAdmin } = useAuth()
  const pathname = usePathname()
  const router = useRouter()
  const [copiado, setCopiado] = useState(false)

  // Mientras carga, no bloqueamos
  if (loading || !estado) return <>{children}</>

  // Si no está bloqueado, render normal
  if (!estado.modo_solo_lectura) return <>{children}</>

  // Bloqueado: chequear whitelist
  if (rutaEstaPermitida(pathname)) return <>{children}</>

  const copiarInstalacionId = async () => {
    try {
      await navigator.clipboard.writeText(estado.instalacion_id)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      // Si el browser bloquea el clipboard, hacemos un fallback con prompt.
      window.prompt('Copiá el ID de instalación:', estado.instalacion_id)
    }
  }

  // Pantalla de bloqueo
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-6">
      <div className="bg-white border border-red-200 rounded-xl shadow-sm max-w-xl w-full p-8 text-center">
        <div className="flex items-center justify-center mb-3">
          <div className="h-14 w-14 rounded-full bg-red-50 flex items-center justify-center">
            <ShieldOff className="h-7 w-7 text-red-600" />
          </div>
        </div>

        <h1 className="text-xl font-bold text-slate-800 mb-1">
          Sección no disponible
        </h1>

        <p className="text-sm text-slate-600 mb-4">
          {estado.modo === 'SIN_LICENCIA'
            ? 'Es necesario activar el sistema.'
            : 'Tu licencia venció.'}{' '}
          Podés consultar tus clientes, pólizas y siniestros, pero esta sección queda
          bloqueada hasta cargar una licencia válida.
        </p>

        {/* ID de instalación: necesario para pedir/emitir una licencia nueva */}
        {isAdmin && (
          <div className="bg-slate-50 border border-slate-200 rounded p-3 text-left mt-4">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">
              ID de esta instalación
            </p>
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono bg-white px-2 py-1 rounded border border-slate-200 text-slate-700 flex-1 break-all">
                {estado.instalacion_id}
              </code>
              <button
                onClick={copiarInstalacionId}
                className="flex items-center gap-1 px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-100 shrink-0"
                title="Copiar"
              >
                {copiado ? (
                  <>
                    <Check className="h-3 w-3 text-green-600" /> Copiado
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> Copiar
                  </>
                )}
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Pasale este ID a tu contacto de FidCore para que te emita una licencia nueva.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-6">
          <button
            onClick={() => router.push('/crm/dashboard')}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium border border-slate-200 rounded hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver al inicio
          </button>
          {isAdmin && (
            <button
              onClick={() => router.push('/crm/configuracion/licencia')}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              <Shield className="h-4 w-4" />
              Cargar licencia
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>

        {!isAdmin && (
          <p className="text-xs text-slate-400 mt-4">
            Contactá al administrador del sistema para que cargue una licencia.
          </p>
        )}
      </div>
    </div>
  )
}
