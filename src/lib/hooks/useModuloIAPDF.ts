'use client'

import { useEffect, useState } from 'react'

interface EstadoModulo {
  activo: boolean
  motivo?: string
  isLoading: boolean
}

// Cache a nivel de módulo — una sola consulta por sesión
let cachePromesa: Promise<{ activo: boolean; motivo?: string }> | null = null

async function consultarModulo(): Promise<{ activo: boolean; motivo?: string }> {
  if (cachePromesa) return cachePromesa
  cachePromesa = (async () => {
    try {
      const res = await fetch('/api/agente-pdf/modulo-activo', { cache: 'no-store' })
      if (!res.ok) return { activo: false, motivo: 'Sin acceso' }
      const json = await res.json()
      return { activo: !!json?.activo, motivo: json?.motivo }
    } catch {
      return { activo: false, motivo: 'Error de red' }
    }
  })()
  return cachePromesa
}

/**
 * Hook ligero que devuelve si el módulo IA de PDF está activo.
 * Cachea la respuesta en memoria para toda la sesión.
 */
export function useModuloIAPDF(): EstadoModulo {
  const [estado, setEstado] = useState<EstadoModulo>({ activo: false, isLoading: true })

  useEffect(() => {
    let vivo = true
    consultarModulo().then(r => {
      if (vivo) setEstado({ activo: r.activo, motivo: r.motivo, isLoading: false })
    })
    return () => { vivo = false }
  }, [])

  return estado
}

/** Forzar un re-check (útil después de togglear el módulo en configuración) */
export function resetModuloIAPDFCache(): void {
  cachePromesa = null
}
