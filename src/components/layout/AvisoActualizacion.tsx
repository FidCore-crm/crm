'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { Sparkles } from 'lucide-react'

/**
 * Botón discreto en la navbar (al lado de la campana) que aparece SOLO
 * cuando hay una nueva versión del CRM disponible. Click navega a la
 * pantalla de actualizaciones.
 *
 * Admin-only. Si no hay update o no es admin, no renderiza nada.
 */

interface Estado {
  hay_actualizacion: boolean
  version_disponible?: string
}

export function AvisoActualizacion() {
  const { usuario } = useAuth()
  const router = useRouter()
  const [estado, setEstado] = useState<Estado>({ hay_actualizacion: false })

  useEffect(() => {
    if (usuario?.rol !== 'ADMIN') return

    let cancelado = false

    async function consultar() {
      try {
        const res = await fetch('/api/actualizaciones/disponible', { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json()
        if (cancelado) return
        const data = json?.data ?? json
        if (data?.hay_actualizacion && data?.ultimo_release?.version) {
          setEstado({
            hay_actualizacion: true,
            version_disponible: data.ultimo_release.version,
          })
        } else {
          setEstado({ hay_actualizacion: false })
        }
      } catch {
        // silencioso: si falla, no mostramos el botón
      }
    }

    consultar()
    const interval = setInterval(consultar, 30 * 60 * 1000) // cada 30 min
    const onFocus = () => consultar()
    window.addEventListener('focus', onFocus)

    return () => {
      cancelado = true
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [usuario?.rol])

  if (usuario?.rol !== 'ADMIN' || !estado.hay_actualizacion) return null

  return (
    <button
      onClick={() => router.push('/crm/configuracion/actualizaciones')}
      title={`Nueva versión disponible: v${estado.version_disponible}`}
      className="relative flex h-7 w-7 items-center justify-center rounded
                 text-blue-600 hover:text-blue-700 hover:bg-blue-50 transition-colors"
    >
      <Sparkles className="h-4 w-4" />
      <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75"></span>
        <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500"></span>
      </span>
    </button>
  )
}
