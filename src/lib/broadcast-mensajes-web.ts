'use client'

/**
 * Sincronización cross-tab del panel "Inbox" de mensajes web (leads).
 * Mismo patrón que `broadcast-notificaciones.ts` pero canal separado para no
 * mezclar refrescos del Inbox con los de la campana.
 */

import { useEffect } from 'react'

export type EventoBroadcastMensajesWeb =
  | { tipo: 'marcada-leida'; id: string }
  | { tipo: 'todas-leidas' }
  | { tipo: 'eliminada'; id: string }

const NOMBRE_CANAL = 'fidcore-mensajes-web'

let canalCompartido: BroadcastChannel | null = null

function obtenerCanal(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null
  if (typeof BroadcastChannel === 'undefined') return null
  if (canalCompartido) return canalCompartido
  canalCompartido = new BroadcastChannel(NOMBRE_CANAL)
  return canalCompartido
}

export function emitirBroadcastMensajesWeb(evento: EventoBroadcastMensajesWeb): void {
  const canal = obtenerCanal()
  canal?.postMessage(evento)
}

export function useBroadcastMensajesWeb(handler: (evento: EventoBroadcastMensajesWeb) => void): void {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (typeof BroadcastChannel === 'undefined') return
    const canal = new BroadcastChannel(NOMBRE_CANAL)
    canal.onmessage = (e) => handler(e.data as EventoBroadcastMensajesWeb)
    return () => { canal.close() }
  }, [handler])
}
