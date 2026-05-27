// ============================================================
// Single source of truth para los estados de pólizas.
// Cualquier referencia a 'VIGENTE' / 'NO_VIGENTE' / etc. debe
// pasar por estas constantes para evitar typos y para tener un
// solo lugar donde modificar si en el futuro cambian los nombres.
// ============================================================

export const ESTADO_POLIZA = {
  PROGRAMADA: 'PROGRAMADA',
  RENOVADA: 'RENOVADA',
  VIGENTE: 'VIGENTE',
  NO_VIGENTE: 'NO_VIGENTE',
  CANCELADA: 'CANCELADA',
  ANULADA: 'ANULADA',
} as const

export type EstadoPoliza = typeof ESTADO_POLIZA[keyof typeof ESTADO_POLIZA]

// Estados desde los que se puede dar de baja (cancelar/anular) o renovar
export const ESTADOS_BAJA_PERMITIDA: EstadoPoliza[] = [
  ESTADO_POLIZA.VIGENTE,
  ESTADO_POLIZA.PROGRAMADA,
  ESTADO_POLIZA.RENOVADA,
]

// Estados que cuentan como "una renovación activa" para excluir el origen
// del listado de "para renovar"
export const ESTADOS_RENOVACION_ACTIVA: EstadoPoliza[] = [
  ESTADO_POLIZA.RENOVADA,
  ESTADO_POLIZA.VIGENTE,
  ESTADO_POLIZA.PROGRAMADA,
]

// Estados terminales (no admiten renovación sin rehabilitar primero)
export const ESTADOS_NO_RENOVABLES: EstadoPoliza[] = [
  ESTADO_POLIZA.CANCELADA,
  ESTADO_POLIZA.ANULADA,
]
