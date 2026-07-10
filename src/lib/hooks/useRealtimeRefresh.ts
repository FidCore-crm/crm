'use client'

import { useEffect, useRef } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'

type Tabla = string

interface Opciones {
  /** Nombres de tablas a las que suscribirse. Cada una debe estar en la publicación
   *  `supabase_realtime` (ver migraciones 046-054). Cambios en cualquiera disparan
   *  el refetch. */
  tablas: Tabla[]
  /** Callback que refetchea el listado / KPI / ficha. */
  onCambio: () => void
  /** Debounce en ms para agrupar eventos en cadena (INSERT persona + póliza + riesgo
   *  suelen llegar juntos). Default 300ms. */
  debounceMs?: number
  /** Prefijo único para el nombre del canal. Default 'rt'. Puede ser útil para debug. */
  prefijoCanal?: string
  /** Filter Realtime opcional por tabla. Ej: 'usuario_id=eq.abc'. Si se pasa, se aplica
   *  a TODAS las tablas del array. Para filtros distintos por tabla, usar el hook varias
   *  veces. */
  filter?: string
  /** Habilita o deshabilita las suscripciones. Útil cuando el usuario aún no cargó.
   *  Default true. */
  enabled?: boolean
  /** Si true, escucha `window focus` y llama `onCambio` (fallback ante reconexión
   *  del WS). Default FALSE porque en pantallas con file pickers (upload de
   *  archivos), el picker de Windows/mobile roba el foco → al recuperarlo dispara
   *  onCambio → la ficha se re-monta → cancela el fetch del upload en curso.
   *  Activar SOLO en pantallas sin uploads donde el refresh on focus aporta
   *  (dashboards, listados con contadores dinámicos). */
  refetchOnFocus?: boolean
}

/**
 * Hook reutilizable: suscribe a cambios en tablas Realtime y llama a `onCambio`
 * con debounce cuando hay eventos. Cleanup automático al desmontar.
 *
 * Uso típico en listados:
 *
 *   const cargar = useCallback(async () => { ... }, [deps])
 *   useEffect(() => { cargar() }, [cargar])
 *   useRealtimeRefresh({ tablas: ['polizas'], onCambio: cargar })
 *
 * Uso en fichas detalle:
 *
 *   useRealtimeRefresh({
 *     tablas: ['polizas', 'riesgos', 'endosos'],
 *     onCambio: cargar,
 *     filter: `id=eq.${polizaId}`,   // ojo: se aplica a las 3 tablas
 *   })
 *
 * IMPORTANTE: el fix del cliente en `src/lib/supabase/client.ts` sincroniza el JWT
 * del usuario al WS de Realtime (`realtime.setAuth`). Sin ese fix, las policies
 * RLS con `auth.uid()` filtran todos los eventos y este hook no recibe nada.
 */
export function useRealtimeRefresh({
  tablas,
  onCambio,
  debounceMs = 300,
  prefijoCanal = 'rt',
  filter,
  enabled = true,
  refetchOnFocus = false,
}: Opciones) {
  const onCambioRef = useRef(onCambio)
  onCambioRef.current = onCambio

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled || tablas.length === 0) return

    const supabase = getSupabaseClient()

    const dispararRefetch = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        onCambioRef.current()
      }, debounceMs)
    }

    // Un canal por tabla — separados evita colisiones de filter/schema y facilita debug.
    const canales = tablas.map((tabla) => {
      const nombreCanal = `${prefijoCanal}-${tabla}-${Math.random().toString(36).slice(2, 8)}`
      const cfg: any = { event: '*', schema: 'public', table: tabla }
      if (filter) cfg.filter = filter
      return supabase
        .channel(nombreCanal)
        .on('postgres_changes', cfg, dispararRefetch)
        .subscribe()
    })

    // Fallback ante reconexión: si el WS se cae y vuelve, el foco de la ventana
    // fuerza un refetch para no quedar con datos viejos.
    const onFocus = () => onCambioRef.current()
    if (refetchOnFocus) {
      window.addEventListener('focus', onFocus)
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (refetchOnFocus) window.removeEventListener('focus', onFocus)
      canales.forEach((canal) => supabase.removeChannel(canal))
    }
    // Se re-suscribe si cambia el listado de tablas o el filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tablas.join('|'), filter, debounceMs, prefijoCanal, refetchOnFocus])
}
