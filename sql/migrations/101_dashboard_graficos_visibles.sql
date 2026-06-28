-- ============================================================================
-- Migración 101: agregar dashboard_graficos_visibles a configuracion
-- ============================================================================
-- Persiste qué gráficos del panel "Análisis de cartera" están habilitados.
--
-- Semántica del valor:
--   NULL  → todos los gráficos visibles (default, preserva look previo)
--   []    → ningún gráfico visible
--   [...] → solo los IDs listados son visibles
--
-- Los IDs estables viven en `src/lib/dashboard-graficos.ts`. No se hace FK
-- contra ninguna tabla porque el catálogo es estático/código.
-- ============================================================================

ALTER TABLE configuracion
  ADD COLUMN IF NOT EXISTS dashboard_graficos_visibles JSONB;
