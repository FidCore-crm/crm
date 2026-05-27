'use client'

import { useEffect, useState } from 'react'

interface EstadoEmail {
  configurado: boolean
  testExitoso: boolean
  isLoading: boolean
}

// Cache a nivel de módulo — una sola consulta por sesión.
// Esto evita martillar el endpoint cada vez que se renderiza una ficha de
// persona o póliza (cualquiera de las cuales muestra el botón "Email").
let cachePromesa: Promise<{ configurado: boolean; testExitoso: boolean }> | null = null

async function consultar(): Promise<{ configurado: boolean; testExitoso: boolean }> {
  if (cachePromesa) return cachePromesa
  cachePromesa = (async () => {
    try {
      const res = await fetch('/api/configuracion/correos/estado', { cache: 'no-store' })
      if (!res.ok) return { configurado: false, testExitoso: false }
      const json = await res.json()
      return {
        configurado: !!json?.configurado,
        testExitoso: !!json?.test_exitoso,
      }
    } catch {
      return { configurado: false, testExitoso: false }
    }
  })()
  return cachePromesa
}

/**
 * Hook ligero que devuelve si SMTP está configurado.
 * Lo usan los botones "Email" de las fichas y la pantalla central de
 * comunicaciones para mostrar tooltip cuando no se puede enviar.
 *
 * Cachea la respuesta en memoria para toda la sesión.
 */
export function useEmailConfigurado(): EstadoEmail {
  const [estado, setEstado] = useState<EstadoEmail>({
    configurado: false,
    testExitoso: false,
    isLoading: true,
  })

  useEffect(() => {
    let vivo = true
    consultar().then(r => {
      if (vivo) setEstado({ configurado: r.configurado, testExitoso: r.testExitoso, isLoading: false })
    })
    return () => { vivo = false }
  }, [])

  return estado
}

/** Forzar un re-check (útil después de modificar SMTP en configuración). */
export function resetEmailConfiguradoCache(): void {
  cachePromesa = null
}
