'use client'

import { useEffect, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'

export type ModoPresencia = 'viendo' | 'editando'

// Tipo de presencia que se trackea por usuario en un canal de ficha.
// El `modo` distingue si el usuario tiene la ficha abierta en modo lectura
// (ficha detalle) o modo edición (formulario `[id]/editar`). Sirve para
// prevenir conflictos de concurrencia antes que ocurran — la UI muestra
// visualmente si otro usuario está editando el mismo recurso.
export interface PresenciaUsuario {
  user_id: string
  nombre: string
  apellido: string
  joined_at: string
  modo: ModoPresencia
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
 * El parámetro `modo` (default 'viendo') indica en qué modo entra este cliente.
 * Los formularios de edición pasan 'editando' para que los demás usuarios vean
 * la advertencia antes de abrir el mismo form. El backend tiene optimistic
 * locking igual — esto es UX preventivo.
 *
 * Implementado sobre Supabase Realtime Presence. Cada cliente se anuncia con
 * track() al subscribe, y todos reciben eventos `sync` cuando alguien entra
 * o sale (incluso si cerró la pestaña sin signout — Realtime detecta la
 * desconexión del socket).
 */
export function usePresencia(
  tipoEntidad: TipoEntidadPresencia,
  entidadId: string | null | undefined,
  modo: ModoPresencia = 'viendo',
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
            modo,
          })
        }
      })

    return () => {
      // untrack es implícito al removeChannel — el server limpia al
      // desconectarse el socket también.
      supabase.removeChannel(canal)
    }
    // Nota: si `modo` cambia mid-vida (ej: usuario abrió modal edit sin
    // desmontar la ficha) hay que re-suscribirse. Como en el CRM los forms de
    // edición son páginas propias (`[id]/editar/page.tsx`), esto no pasa —
    // el remount natural del hook cubre el cambio.
  }, [tipoEntidad, entidadId, usuario, modo])

  return otros
}
