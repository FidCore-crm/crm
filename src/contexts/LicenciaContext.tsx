'use client'

/**
 * LicenciaContext — provee el estado actual de la licencia al árbol de componentes.
 *
 * Se carga al montar el layout del CRM y se refresca:
 *   - Al focus de la ventana (por si pasó tiempo)
 *   - Cada 5 minutos en background (por si entró en gracia/bloqueo durante uso)
 *
 * Los componentes consumen via `useLicenciaEstado()`. Modos:
 *   - 'ACTIVA' — todo OK
 *   - 'GRACIA' — vencida pero dentro del período de gracia (sigue funcionando)
 *   - 'BLOQUEADA' — modo solo lectura (vencida + sin gracia)
 *   - 'SIN_LICENCIA' — modo solo lectura (nunca se cargó licencia)
 *
 * Usar `modo_solo_lectura` para condicionar botones de acción/edición.
 */

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'

export type ModoLicencia = 'ACTIVA' | 'GRACIA' | 'BLOQUEADA' | 'SIN_LICENCIA'

export interface LicenciaActiva {
  id: string
  plan: 'MENSUAL' | 'SEMESTRAL' | 'ANUAL' | 'PERMANENTE'
  cliente: string
  fecha_inicio: string
  fecha_vencimiento: string
  fecha_emision: string
  dias_restantes: number
  es_permanente: boolean
}

export interface LicenciaEncolada {
  id: string
  plan: 'MENSUAL' | 'SEMESTRAL' | 'ANUAL' | 'PERMANENTE'
  fecha_inicio: string
  fecha_vencimiento: string
  fecha_emision: string
  dias_hasta_inicio: number
}

export interface EstadoLicenciaPublico {
  modo: ModoLicencia
  modo_solo_lectura: boolean
  licencia_activa: LicenciaActiva | null
  licencias_encoladas: LicenciaEncolada[]
  dias_gracia_restantes: number | null
  instalacion_id: string
  sistema_configurado: boolean
}

interface LicenciaContextType {
  estado: EstadoLicenciaPublico | null
  loading: boolean
  refetch: () => Promise<void>
}

const LicenciaContext = createContext<LicenciaContextType>({
  estado: null,
  loading: true,
  refetch: async () => {},
})

const TTL_REFRESH_MS = 5 * 60_000

export function LicenciaProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoLicenciaPublico | null>(null)
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    try {
      const res = await fetch('/api/licencia/actual', { cache: 'no-store' })
      if (res.ok) {
        const json = await res.json()
        if (json.ok && json.data) {
          setEstado(json.data as EstadoLicenciaPublico)
        }
      }
    } catch {
      // silencio — el contexto puede quedar con el último valor bueno
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refetch()
  }, [refetch])

  useEffect(() => {
    const onFocus = () => refetch()
    window.addEventListener('focus', onFocus)
    const intervalId = setInterval(refetch, TTL_REFRESH_MS)

    // Broadcast cross-tab: cuando una pestaña carga/elimina una licencia,
    // emite 'licencia-actualizada' y las demás refetchean inmediatamente.
    let canal: BroadcastChannel | null = null
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        canal = new BroadcastChannel('fidcore-licencia')
        canal.onmessage = (ev) => {
          if (ev?.data?.tipo === 'licencia-actualizada') {
            refetch()
          }
        }
      } catch {
        // browsers viejos sin BroadcastChannel: ignorar
      }
    }

    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(intervalId)
      if (canal) canal.close()
    }
  }, [refetch])

  return (
    <LicenciaContext.Provider value={{ estado, loading, refetch }}>
      {children}
    </LicenciaContext.Provider>
  )
}

export function useLicenciaEstado() {
  return useContext(LicenciaContext)
}

/**
 * Notifica a TODAS las pestañas abiertas que el estado de licencia cambió.
 * Las que tengan LicenciaContext montado refetchean inmediatamente.
 *
 * Llamar después de cualquier mutación (cargar, eliminar, etc.).
 */
export function emitirBroadcastLicencia() {
  if (typeof BroadcastChannel === 'undefined') return
  try {
    const canal = new BroadcastChannel('fidcore-licencia')
    canal.postMessage({ tipo: 'licencia-actualizada' })
    canal.close()
  } catch {
    // ignorar
  }
}

/**
 * Helper rápido para componentes que solo quieren saber si pueden editar.
 */
export function useEsSoloLectura(): boolean {
  const { estado } = useLicenciaEstado()
  return estado?.modo_solo_lectura ?? false
}
