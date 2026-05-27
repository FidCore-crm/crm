-- Migración 074: índices faltantes en `tareas`
--
-- La tabla tareas tiene FK a polizas y siniestros sin índice. Las consultas
-- típicas del CRM filtran tareas por póliza (ficha de póliza) y por siniestro
-- (ficha de siniestro). Sin índice → seq scan al crecer la tabla.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_tareas_poliza_id
  ON public.tareas (poliza_id)
  WHERE poliza_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tareas_siniestro_id
  ON public.tareas (siniestro_id)
  WHERE siniestro_id IS NOT NULL;

COMMIT;
