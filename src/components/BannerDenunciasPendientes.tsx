'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getSupabaseClient } from '@/lib/supabase/client'
import { apiCall } from '@/lib/api-client'

/**
 * Banner sticky que aparece arriba del contenido (debajo del navbar fijo)
 * cuando hay siniestros denunciados desde el portal del cliente que el PAS
 * todavía no marcó como revisados.
 *
 * Se actualiza:
 *   - Al montar
 *   - Al recibir cambios via Realtime en la tabla siniestros
 *   - Al volver el foco a la ventana (red de seguridad ante reconexión)
 *
 * Click → navega al listado de siniestros con el filtro de "denuncias
 * pendientes" activo.
 */
export function BannerDenunciasPendientes() {
  const router = useRouter()
  const supabase = getSupabaseClient()
  const { usuario } = useAuth()
  const [pendientes, setPendientes] = useState(0)
  const refetchTimerRef = useRef<NodeJS.Timeout | null>(null)

  const cargar = useCallback(async () => {
    const res = await apiCall<{ pendientes: number }>(
      '/api/siniestros/denuncias-pendientes',
      undefined,
      { mostrar_toast_en_error: false },
    )
    if (res.ok && res.data) setPendientes(res.data.pendientes ?? 0)
  }, [])

  useEffect(() => {
    if (!usuario) return
    cargar()

    // Realtime: cualquier cambio en siniestros refresca el contador (con
    // debounce de 300ms para no martillar cuando entran cambios en cadena).
    const canal = supabase
      .channel('denuncias-pendientes-banner')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'siniestros' },
        () => {
          if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current)
          refetchTimerRef.current = setTimeout(cargar, 300)
        },
      )
      .subscribe()

    const onFocus = () => cargar()
    window.addEventListener('focus', onFocus)

    return () => {
      supabase.removeChannel(canal)
      window.removeEventListener('focus', onFocus)
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current)
    }
  }, [usuario, supabase, cargar])

  if (pendientes <= 0) return null

  return (
    <div
      onClick={() => router.push('/crm/siniestros?denuncias_pendientes=1')}
      className="bg-red-600 text-white border-b border-red-700 px-4 py-2 cursor-pointer hover:brightness-95 transition-all"
    >
      <div className="flex items-center justify-center gap-2 text-xs font-medium">
        <AlertTriangle className="h-4 w-4 shrink-0 animate-pulse" />
        <span>
          {pendientes === 1
            ? 'Tenés 1 denuncia del portal sin revisar.'
            : `Tenés ${pendientes} denuncias del portal sin revisar.`}
        </span>
        <span className="text-2xs opacity-90 ml-1 flex items-center gap-0.5">
          Ver ahora <ChevronRight className="h-3 w-3" />
        </span>
      </div>
    </div>
  )
}
