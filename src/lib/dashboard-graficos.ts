/**
 * Catálogo estable de gráficos disponibles en el panel "Análisis de cartera"
 * del dashboard. Cada gráfico tiene un ID único e inmutable que se persiste
 * en `configuracion.dashboard_graficos_visibles` (JSONB).
 *
 * Si agregás un gráfico nuevo al dashboard, agregalo acá con un ID estable
 * y descriptivo. Si renombrás un gráfico, NO cambies el ID — solo `nombre`
 * y `descripcion`. Cambiar IDs rompe configuraciones guardadas.
 *
 * El render condicional se hace con `graficoVisible(id, visibles)`.
 */

export type CategoriaGrafico =
  | 'cartera'
  | 'vencimientos'
  | 'clientes'
  | 'siniestros'
  | 'comercial'

export interface GraficoDashboard {
  id: string
  nombre: string
  descripcion: string
  categoria: CategoriaGrafico
}

export const CATEGORIAS_LABEL: Record<CategoriaGrafico, string> = {
  cartera: 'Cartera y composición',
  vencimientos: 'Vencimientos y renovaciones',
  clientes: 'Clientes',
  siniestros: 'Siniestros',
  comercial: 'Comercial y facturación',
}

export const GRAFICOS_DASHBOARD: GraficoDashboard[] = [
  // ─── Cartera y composición ────────────────────────────────────────────
  {
    id: 'evolucion',
    nombre: 'Evolución de cartera (12 meses)',
    descripcion: 'Saldo neto al cierre de cada mes: altas menos bajas acumuladas.',
    categoria: 'cartera',
  },
  {
    id: 'distribucion_compania',
    nombre: 'Distribución por compañía',
    descripcion: 'Cantidad de pólizas por compañía. Muestra todas las que tienen al menos una póliza.',
    categoria: 'cartera',
  },
  {
    id: 'distribucion_ramo',
    nombre: 'Distribución por ramo',
    descripcion: 'Cantidad de pólizas por ramo. Muestra todos los ramos con al menos una póliza.',
    categoria: 'cartera',
  },
  {
    id: 'distribucion_cobertura',
    nombre: 'Distribución por cobertura',
    descripcion: 'Cantidad de pólizas por cobertura.',
    categoria: 'cartera',
  },
  {
    id: 'distribucion_medio_pago',
    nombre: 'Distribución por medio de pago',
    descripcion: 'Cómo paga el cliente: efectivo, débito en cuenta o tarjeta.',
    categoria: 'cartera',
  },
  {
    id: 'distribucion_moneda',
    nombre: 'Distribución por moneda',
    descripcion: 'Pólizas en ARS vs USD.',
    categoria: 'cartera',
  },
  {
    id: 'ticket_promedio_compania',
    nombre: 'Ticket promedio por compañía',
    descripcion: 'Suma asegurada promedio por compañía (solo pólizas con suma cargada).',
    categoria: 'cartera',
  },

  // ─── Vencimientos y renovaciones ──────────────────────────────────────
  {
    id: 'vencimientos_6_meses',
    nombre: 'Calendario de vencimientos (6 meses)',
    descripcion: 'Cantidad de pólizas que vencen en cada uno de los próximos 6 meses.',
    categoria: 'vencimientos',
  },
  {
    id: 'vencimientos_compania',
    nombre: 'Vencimientos próximos por compañía',
    descripcion: 'Pólizas que vencen en los próximos 90 días agrupadas por compañía.',
    categoria: 'vencimientos',
  },
  {
    id: 'tasa_renovacion',
    nombre: 'Tasa de renovación',
    descripcion: 'Por mes: % de pólizas que vencieron y se renovaron vs las que se perdieron.',
    categoria: 'vencimientos',
  },

  // ─── Clientes ─────────────────────────────────────────────────────────
  {
    id: 'top_clientes_polizas',
    nombre: 'Top 10 clientes por cantidad de pólizas',
    descripcion: 'Clientes más fidelizados por volumen de pólizas activas.',
    categoria: 'clientes',
  },
  {
    id: 'top_clientes_suma',
    nombre: 'Top 10 clientes por suma asegurada',
    descripcion: 'Clientes que concentran más volumen de suma asegurada.',
    categoria: 'clientes',
  },
  {
    id: 'antiguedad_cartera',
    nombre: 'Antigüedad de la cartera',
    descripcion: 'Distribución de cuánto tiempo lleva cada cliente activo.',
    categoria: 'clientes',
  },

  // ─── Siniestros ───────────────────────────────────────────────────────
  {
    id: 'siniestralidad_compania',
    nombre: 'Siniestralidad por compañía (12 meses)',
    descripcion: 'Siniestros abiertos vs cerrados en los últimos 12 meses por compañía.',
    categoria: 'siniestros',
  },
  {
    id: 'tasa_siniestralidad_compania',
    nombre: 'Tasa de siniestralidad por compañía',
    descripcion: '% de pólizas con al menos un siniestro en los últimos 12 meses, por compañía.',
    categoria: 'siniestros',
  },
  {
    id: 'tiempo_resolucion_siniestros',
    nombre: 'Tiempo promedio de resolución',
    descripcion: 'Días promedio entre denuncia y cierre por compañía (siniestros finalizados).',
    categoria: 'siniestros',
  },

  // ─── Comercial y facturación ──────────────────────────────────────────
  {
    id: 'facturacion_anual',
    nombre: 'Facturación anual comparativa',
    descripcion: 'Facturación del año actual vs año anterior, mes a mes.',
    categoria: 'comercial',
  },
]

/**
 * Devuelve true si un gráfico debe mostrarse según la config del PAS.
 *
 * - `visibles === null | undefined` → todos visibles (default — instalaciones
 *   previas y configs no guardadas).
 * - `visibles === []` → ninguno visible (el PAS deshabilitó todo a propósito).
 * - `visibles === [...ids]` → solo esos IDs son visibles.
 */
export function graficoVisible(
  id: string,
  visibles: string[] | null | undefined,
): boolean {
  if (visibles === null || visibles === undefined) return true
  return visibles.includes(id)
}

/** IDs de todos los gráficos disponibles (útil para "habilitar todos"). */
export function todosLosIds(): string[] {
  return GRAFICOS_DASHBOARD.map((g) => g.id)
}

/** Agrupa el catálogo por categoría preservando el orden de aparición. */
export function agruparPorCategoria(): Array<{
  categoria: CategoriaGrafico
  label: string
  graficos: GraficoDashboard[]
}> {
  const orden: CategoriaGrafico[] = [
    'cartera',
    'vencimientos',
    'clientes',
    'siniestros',
    'comercial',
  ]
  return orden
    .map((cat) => ({
      categoria: cat,
      label: CATEGORIAS_LABEL[cat],
      graficos: GRAFICOS_DASHBOARD.filter((g) => g.categoria === cat),
    }))
    .filter((g) => g.graficos.length > 0)
}
