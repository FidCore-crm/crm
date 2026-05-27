'use client'

import { useEffect, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import type { PresenciaUsuario } from './usePresencia'

/**
 * Trackea quién está conectado al CRM ahora mismo (cualquier ruta).
 *
 * A diferencia de `usePresencia(tipo, id)` que es por-ficha, este hook
 * comparte un único canal global `presencia-crm-global`. Cualquier cliente
 * que esté en cualquier página del CRM aparece en el set.
 *
 * Devuelve TODOS los usuarios conectados (incluye al propio) para que el
 * componente sidebar pueda mostrarlos a todos. El UI decide si los marca
 * con un highlight especial ("vos") o no.
 */
export function usePresenciaGlobal(): PresenciaUsuario[] {
  const { usuario } = useAuth()
  const [conectados, setConectados] = useState<PresenciaUsuario[]>([])

  useEffect(() => {
    if (!usuario) {
      setConectados([])
      return
    }

    const supabase = getSupabaseClient()
    const canal = supabase.channel('presencia-crm-global', {
      config: { presence: { key: usuario.id } },
    })

    canal
      .on('presence', { event: 'sync' }, () => {
        const state = canal.presenceState<PresenciaUsuario>()
        const lista: PresenciaUsuario[] = []
        for (const userId of Object.keys(state)) {
          const meta = state[userId][0]
          if (meta) lista.push(meta)
        }
        // Ordenar: usuario propio primero, después por apellido
        lista.sort((a, b) => {
          if (a.user_id === usuario.id) return -1
          if (b.user_id === usuario.id) return 1
          return (a.apellido + a.nombre).localeCompare(b.apellido + b.nombre)
        })
        setConectados(lista)
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
      supabase.removeChannel(canal)
    }
  }, [usuario])

  return conectados
}
