-- Migración 142: retención configurable de adjuntos de campañas.
--
-- Nueva columna en `configuracion_comunicaciones` para controlar cuántos días
-- se retienen los archivos físicos en `storage/campanas/{id}/` después de que
-- la campaña queda en estado terminal (COMPLETADA / CANCELADA).
--
-- El cron `limpiar-campanas-storage` (v1.0.180) usa este valor. Default 30.
--
-- Filosofía: los adjuntos ya cumplieron su función (se enviaron con los
-- emails). La metadata (nombres, tamaños, resultados) queda en el historial
-- indefinidamente en `email_envios.archivos_adjuntos`. Los bytes físicos solo
-- sirven para diagnóstico inmediato post-envío.

BEGIN;

ALTER TABLE public.configuracion_comunicaciones
  ADD COLUMN IF NOT EXISTS retener_adjuntos_campana_dias INTEGER NOT NULL DEFAULT 30;

COMMENT ON COLUMN public.configuracion_comunicaciones.retener_adjuntos_campana_dias IS
  'Días de retención de storage/campanas/{id}/ tras COMPLETADA/CANCELADA. Usado por cron limpiar-campanas-storage.';

COMMIT;
