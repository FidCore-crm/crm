'use client'

/**
 * Sincronización cross-tab del panel de denuncias recibidas por el
 * formulario público / portal del asegurado.
 * Mismo patrón que `broadcast-mensajes-web.ts` pero canal separado para no
 * mezclar refrescos del panel de denuncias con los del Inbox de leads ni con
 * los de la campana.
 */

import { useEffect } from 'react'

export type EventoBroadcastDenunciasWeb =
  | { tipo: 'marcada-leida'; id: string }
  | { tipo: 'todas-leidas' }
  | { tipo: 'eliminada'; id: string }

const NOMBRE_CANAL = 'fidcore-denuncias-web'

let canalCompartido: BroadcastChannel | null = null

function obtenerCanal(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null
  if (typeof BroadcastChannel === 'undefined') return null
  if (canalCompartido) return canalCompartido
  canalCompartido = new BroadcastChannel(NOMBRE_CANAL)
  return canalCompartido
}

export function emitirBroadcastDenunciasWeb(evento: EventoBroadcastDenunciasWeb): void {
  const canal = obtenerCanal()
  canal?.postMessage(evento)
}

export function useBroadcastDenunciasWeb(handler: (evento: EventoBroadcastDenunciasWeb) => void): void {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (typeof BroadcastChannel === 'undefined') return
    const canal = new BroadcastChannel(NOMBRE_CANAL)
    canal.onmessage = (e) => handler(e.data as EventoBroadcastDenunciasWeb)
    return () => { canal.close() }
  }, [handler])
}
