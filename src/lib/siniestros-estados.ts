/**
 * Máquina de estados de siniestros.
 *
 * Define las transiciones válidas entre estados y helpers para validar
 * y consultar la máquina. Usada tanto en frontend (filtrar opciones)
 * como en backend (rechazar transiciones inválidas).
 *
 * Flujo principal:
 *   DENUNCIADO → EN_TRAMITE → INSPECCION → LIQUIDACION → REPARACION → FINALIZADO
 * Pero las transiciones son flexibles: cualquier estado activo puede ir a
 * cualquier otro estado activo (el PAS puede saltar pasos según la realidad
 * operativa). Solo FINALIZADO y RECHAZADO son terminales.
 */

const ESTADOS_ACTIVOS = ['DENUNCIADO', 'EN_TRAMITE', 'INSPECCION', 'LIQUIDACION', 'REPARACION'] as const
const ESTADOS_TERMINALES = ['FINALIZADO', 'RECHAZADO'] as const

// Cada estado activo puede transicionar a cualquier otro activo distinto +
// a cualquier terminal. Los terminales no transicionan a ningún lado.
function buildTransiciones(): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const e of ESTADOS_ACTIVOS) {
    out[e] = [
      ...ESTADOS_ACTIVOS.filter(x => x !== e),
      ...ESTADOS_TERMINALES,
    ]
  }
  for (const t of ESTADOS_TERMINALES) out[t] = []
  return out
}

export const TRANSICIONES_SINIESTRO: Record<string, string[]> = buildTransiciones()

export function esTransicionValida(estadoActual: string, estadoNuevo: string): boolean {
  const permitidos = TRANSICIONES_SINIESTRO[estadoActual]
  if (!permitidos) return false
  return permitidos.includes(estadoNuevo)
}

export function obtenerEstadosSiguientes(estadoActual: string): string[] {
  return TRANSICIONES_SINIESTRO[estadoActual] ?? []
}

export function esEstadoTerminal(estado: string): boolean {
  const siguientes = TRANSICIONES_SINIESTRO[estado]
  return Array.isArray(siguientes) && siguientes.length === 0
}
