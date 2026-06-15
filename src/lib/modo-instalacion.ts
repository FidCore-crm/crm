// Modo de instalación: APPLIANCE (mini PC físico en la oficina del PAS) o VPS
// (servidor virtual en proveedor cloud tipo Contabo/Hetzner).
//
// Lo setea el instalador UNA SOLA VEZ en .env.local durante el wizard.
// Las features que requieren acceso al host físico (apagar/reiniciar el server)
// solo deben estar disponibles en APPLIANCE.
//
// Defensa en profundidad:
//   - El frontend usa esModoAppliance() para ocultar botones.
//   - El backend rechaza endpoints sensibles si el modo no corresponde.
//
// Compatibilidad: instalaciones previas al rebrand de 2026-06-15 setean la
// env var con el nombre legacy `NEXT_PUBLIC_PULZAR_MODO`. Se lee ambas y la
// nueva (`NEXT_PUBLIC_FIDCORE_MODO`) gana si están las dos.

export type TipoModo = 'APPLIANCE' | 'VPS'

const MODO_DEFAULT: TipoModo = 'APPLIANCE'

export function obtenerModo(): TipoModo {
  const raw = process.env.NEXT_PUBLIC_FIDCORE_MODO ?? process.env.NEXT_PUBLIC_PULZAR_MODO
  if (raw === 'VPS') return 'VPS'
  if (raw === 'APPLIANCE') return 'APPLIANCE'
  return MODO_DEFAULT
}

export function esModoAppliance(): boolean {
  return obtenerModo() === 'APPLIANCE'
}

export function esModoVps(): boolean {
  return obtenerModo() === 'VPS'
}
