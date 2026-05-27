'use client'

import { useEffect, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'

// Tipo de presencia que se trackea por usuario en un canal de ficha.
// Lo mantengo chico — solo lo necesario para renderizar el avatar y el
// tooltip. Si más adelante hace falta diferenciar modo (viendo/editando),
// agregar acá y en `<PresenciaEnFicha />`.
export interface PresenciaUsuario {
  user_id: string
  nombre: string
  apellido: string
  joined_at: string
}

export type TipoEntidadPresencia =
  | 'persona'
  | 'poliza'
  | 'siniestro'
  | 'tarea'
  | 'oportunidad'
  | 'lead'
  | 'cotizacion'

/**
 * Trackea presencia en tiempo real sobre una ficha (recurso identificado por
 * tipo + id). Devuelve la lista de OTROS usuarios actualmente conectados al
 * mismo canal — excluye al usuario propio para que la UI muestre solo
 * "quiénes más están acá".
 *
 * Implementado sobre Supabase Realtime Presence. Cada cliente se anuncia con
 * track() al subscribe, y todos reciben eventos `sync` cuando alguien entra
 * o sale (incluso si cerró la pestaña sin signout — Realtime detecta la
 * desconexión del socket).
 */
export function usePresencia(
  tipoEntidad: TipoEntidadPresencia,
  entidadId: string | null | undefined
): PresenciaUsuario[] {
  const { usuario } = useAuth()
  const [otros, setOtros] = useState<PresenciaUsuario[]>([])

  useEffect(() => {
    if (!entidadId || !usuario) {
      setOtros([])
      return
    }

    const supabase = getSupabaseClient()
    const canal = supabase.channel(`presencia-${tipoEntidad}-${entidadId}`, {
      config: { presence: { key: usuario.id } },
    })

    canal
      .on('presence', { event: 'sync' }, () => {
        const state = canal.presenceState<PresenciaUsuario>()
        const lista: PresenciaUsuario[] = []
        for (const userId of Object.keys(state)) {
          if (userId === usuario.id) continue
          // presenceState devuelve un array por key (cada cliente puede tener
          // varias tabs abiertas); tomamos el primero — basta uno para mostrar.
          const meta = state[userId][0]
          if (meta) lista.push(meta)
        }
        setOtros(lista)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await canal.track({
            user_id: usuario.id,
            nombre: usuario.nombre,
            apellido: usuario.apellido,
            joined_at: new Date().toISOString(),
          })
        }
      })

    return () => {
      // untrack es implícito al removeChannel — el server limpia al
      // desconectarse el socket también.
      supabase.removeChannel(canal)
    }
  }, [tipoEntidad, entidadId, usuario])

  return otros
}
