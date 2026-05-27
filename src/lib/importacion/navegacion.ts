/**
 * Resolver URL de destino para continuar una importación según su estado.
 *
 * Se usa tanto desde el importador principal (banner "hay una importación
 * pendiente") como desde el historial (botón "Continuar"). Mantiene coherencia
 * entre todas las pantallas que navegan al flujo en progreso.
 */

import type { EstadoImportacion, TipoImportacion } from '@/types/database'

const NOOP = null

export interface OpcionesContinuar {
  id: string
  estado: EstadoImportacion | string
  tipo?: TipoImportacion | string | null
}

/**
 * Devuelve la ruta del paso actual del flujo para una importación, o null si
 * el estado no es "continuable" (COMPLETADA, FALLIDA, CANCELADA).
 */
export function urlContinuarImportacion(opciones: OpcionesContinuar): string | null {
  const base = `/crm/importar/${opciones.id}`
  switch (opciones.estado) {
    case 'PENDIENTE':
    case 'ANALIZANDO':
      return `${base}/procesando`
    case 'ANALIZADO':
      return opciones.tipo === 'INCREMENTAL' ? `${base}/comparar` : `${base}/plan`
    case 'IMPORTANDO':
      // Mientras los lotes se procesan, /progreso muestra la barra; cuando
      // llega IMPORTACION_FINAL la misma página redirige a /importando.
      return `${base}/progreso`
    case 'REVISANDO':
      return `${base}/revisar`
    case 'PAUSADA':
      return `${base}/progreso`
    case 'COMPLETADA':
    case 'FALLIDA':
    case 'CANCELADA':
    default:
      return NOOP
  }
}

/**
 * Label corta del botón "Continuar" según el estado. Útil para que el usuario
 * sepa qué va a encontrar al hacer clic.
 */
export function labelContinuarImportacion(estado: string): string {
  switch (estado) {
    case 'PENDIENTE':
    case 'ANALIZANDO':
      return 'Ver análisis'
    case 'ANALIZADO':
      return 'Revisar plan'
    case 'IMPORTANDO':
      return 'Ver progreso'
    case 'REVISANDO':
      return 'Revisar dudosos'
    case 'PAUSADA':
      return 'Reanudar'
    default:
      return 'Continuar'
  }
}

/**
 * Estados en los que la importación requiere atención del usuario y debe
 * mostrarse un banner en el importador principal.
 */
export const ESTADOS_REQUIEREN_ATENCION = new Set<string>([
  'REVISANDO',
  'ANALIZADO',
  'PAUSADA',
])

/**
 * Estados "en progreso" (se resolverán solos cuando el runner procese).
 * Útil si queremos mostrarlos diferenciadamente en el banner.
 */
export const ESTADOS_EN_PROGRESO = new Set<string>([
  'PENDIENTE',
  'ANALIZANDO',
  'IMPORTANDO',
])
