-- ============================================================
-- Migración 109 — es_poliza_principal en poliza_archivos
-- ============================================================
--
-- Marca el archivo PDF que representa la póliza vigente actual dentro de la
-- cadena de archivos de una póliza. Usado por el comparador IA de renovaciones
-- para saber cuál PDF de la póliza actual comparar contra la renovación nueva.
--
-- Semántica:
--   - Cuando el agente PDF crea una póliza NUEVA, marca el PDF como principal.
--   - Cuando el cron/`storage-utils.promoverStagingDeRenovacion` activa una
--     renovación (mueve documentacion_renovada → documentacion), marca el
--     archivo movido como principal (y garantiza que no haya otros marcados
--     en la misma póliza).
--   - Para pólizas legacy (cargadas a mano, sin ningún archivo marcado), el
--     modal de renovación pregunta al PAS cuál es el PDF de la póliza actual
--     y lo marca allí.
--
-- No hace backfill: las pólizas viejas quedan sin principal y se resuelven
-- una a una a medida que se renuevan.
-- ============================================================

ALTER TABLE poliza_archivos
  ADD COLUMN IF NOT EXISTS es_poliza_principal BOOLEAN NOT NULL DEFAULT false;

-- Índice parcial: solo indexa los principales (típicamente 1 por póliza).
-- Consultado desde el modal de renovación al preguntar "cuál es el PDF actual".
CREATE INDEX IF NOT EXISTS idx_poliza_archivos_principal
  ON poliza_archivos (poliza_id)
  WHERE es_poliza_principal = true;
