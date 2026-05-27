'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'
import type {
  EstadoProcesamientoPDF,
  TipoOperacionPDF,
  DatosExtraidosPoliza,
  DatosExtraidosEndoso,
  MapeosCatalogos,
  CampoDudoso,
} from '@/lib/agente-pdf/types'

export interface EstadoPDFPoll {
  id: string
  tipo_operacion: TipoOperacionPDF
  poliza_origen_id: string | null
  poliza_creada_id: string | null
  endoso_creado_id: string | null
  estado: EstadoProcesamientoPDF
  nombre_archivo: string
  tamano_archivo: number | null
  datos_extraidos: DatosExtraidosPoliza | DatosExtraidosEndoso | null
  mapeos_catalogos: MapeosCatalogos | null
  campos_dudosos: CampoDudoso[] | null
  tokens_usados: number | null
  costo_estimado: number | null
  error_mensaje: string | null
  usuario_id: string | null
  created_at: string
  updated_at: string
}

interface Options {
  /**
   * Legacy. El hook ya no hace polling — usa Supabase Realtime suscrito a
   * `pdf_procesamientos` filtrada por `id=eq.<procesamiento_id>`. Cualquier
   * INSERT/UPDATE/DELETE dispara un refetch al endpoint /estado con debounce
   * de 300ms. Aceptado por compatibilidad con los callers, pero ignorado.
   */
  intervaloMs?: number
  /**
   * Legacy. Con Realtime los canales no consumen recursos significativos;
   * el cleanup ocurre al desmontar el componente. Aceptado pero ignorado.
   */
  detenerEnEstadosFinales?: boolean
}

interface Result {
  estado: EstadoPDFPoll | null
  isLoading: boolean
  error: string | null
  refetch: () => void
}

export function useAgentePDFPolling(
  procesamiento_id: string | null | undefined,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options?: Options
): Result {
  const [estado, setEstado] = useState<EstadoPDFPoll | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const mountedRef = useRef<boolean>(true)
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchEstado = useCallback(async () => {
    if (!procesamiento_id) return
    try {
      setIsLoading(true)
      const res = await fetch(`/api/agente-pdf/${procesamiento_id}/estado`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (!json?.ok) throw new Error(json?.error || 'Error al obtener estado')
      if (!mountedRef.current) return
      setEstado(json.procesamiento as EstadoPDFPoll)
      setError(null)
    } catch (e: any) {
      if (!mountedRef.current) return
      setError(e?.message || 'Error desconocido')
    } finally {
      if (mountedRef.current) setIsLoading(false)
    }
  }, [procesamiento_id])

  // Refetch debouncing 300ms para colapsar eventos en cascada
  const programarRefetch = useCallback(() => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current)
    refetchTimerRef.current = setTimeout(() => {
      if (mountedRef.current) fetchEstado()
    }, 300)
  }, [fetchEstado])

  useEffect(() => {
    mountedRef.current = true

    if (!procesamiento_id) {
      setEstado(null)
      return () => {
        mountedRef.current = false
        if (refetchTimerRef.current) {
          clearTimeout(refetchTimerRef.current)
          refetchTimerRef.current = null
        }
      }
    }

    // Fetch inicial inmediato (no esperar al primer evento)
    fetchEstado()

    const supabase = getSupabaseClient()

    const canal = supabase
      .channel(`pdf-${procesamiento_id}`)
      .on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'pdf_procesamientos',
          filter: `id=eq.${procesamiento_id}`,
        },
        programarRefetch
      )
      .subscribe()

    // Revalidación al focus de la ventana (red de seguridad tras reconexión)
    const onFocus = () => {
      if (mountedRef.current) fetchEstado()
    }
    window.addEventListener('focus', onFocus)

    return () => {
      mountedRef.current = false
      if (refetchTimerRef.current) {
        clearTimeout(refetchTimerRef.current)
        refetchTimerRef.current = null
      }
      window.removeEventListener('focus', onFocus)
      supabase.removeChannel(canal)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [procesamiento_id])

  return { estado, isLoading, error, refetch: fetchEstado }
}
