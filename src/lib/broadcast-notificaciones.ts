'use client'

/**
 * Sincronización cross-tab del estado de notificaciones via `BroadcastChannel`.
 *
 * Cuando una tab marca una notificación como leída (o todas como leídas, o
 * elimina una), las otras tabs del MISMO browser reciben el evento al
 * instante y refrescan su UI sin esperar a Realtime (que también funciona,
 * pero tiene latencia 100-300ms y requiere round-trip al server).
 *
 * BroadcastChannel es sincrónico y solo cruza tabs del mismo origen. Es
 * complementario a Realtime — Realtime sigue cubriendo cross-device.
 */

import { useEffect } from 'react'

export type EventoBroadcast =
  | { tipo: 'marcada-leida'; id: string }
  | { tipo: 'todas-leidas' }
  | { tipo: 'eliminada'; id: string }
  | { tipo: 'eliminadas-antiguas' }

const NOMBRE_CANAL = 'fidcore-notificaciones'

// Sostén un canal por proceso para no abrir uno nuevo en cada `emitir`.
// Sigue siendo lazy — solo se crea cuando se invoca por primera vez del lado
// del browser.
let canalCompartido: BroadcastChannel | null = null

function obtenerCanal(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null
  if (typeof BroadcastChannel === 'undefined') return null
  if (canalCompartido) return canalCompartido
  canalCompartido = new BroadcastChannel(NOMBRE_CANAL)
  return canalCompartido
}

/**
 * Emite un evento a las otras tabs. No hace nada en SSR ni en browsers que no
 * soporten BroadcastChannel (Safari < 15.4).
 */
export function emitirBroadcastNotificaciones(evento: EventoBroadcast): void {
  const canal = obtenerCanal()
  canal?.postMessage(evento)
}

/**
 * Hook para suscribirse al canal de broadcast. El handler recibe el evento
 * cuando OTRA tab emite algo (no se dispara por los propios `emitir` de la
 * misma tab).
 */
export function useBroadcastNotificaciones(handler: (evento: EventoBroadcast) => void): void {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (typeof BroadcastChannel === 'undefined') return
    // Canal propio del listener — usar uno separado del de `emitir` evita
    // que un postMessage del propio proceso se reciba como evento entrante.
    const canal = new BroadcastChannel(NOMBRE_CANAL)
    canal.onmessage = (e) => handler(e.data as EventoBroadcast)
    return () => { canal.close() }
  }, [handler])
}
