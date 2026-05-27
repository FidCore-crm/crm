-- Migración 076: Agregar tipo de backup PRE_UPDATE
--
-- El sistema de actualizaciones (migración 075) crea un backup automático
-- ANTES de aplicar cada update. Hasta ahora el CHECK constraint de
-- `backups.tipo` solo aceptaba AUTOMATICO/MANUAL/PRE_RESTORE — sin esta
-- migración, intentar crear un backup con tipo PRE_UPDATE falla.
--
-- Tipos de backup:
--   AUTOMATICO  → backup diario del cron
--   MANUAL      → backup disparado por el PAS desde la UI
--   PRE_RESTORE → backup automático antes de restaurar otro backup
--   PRE_UPDATE  → backup automático antes de aplicar un update del CRM

BEGIN;

ALTER TABLE public.backups DROP CONSTRAINT IF EXISTS backups_tipo_check;

ALTER TABLE public.backups
  ADD CONSTRAINT backups_tipo_check
  CHECK (tipo::text = ANY (ARRAY[
    'AUTOMATICO'::character varying,
    'MANUAL'::character varying,
    'PRE_RESTORE'::character varying,
    'PRE_UPDATE'::character varying
  ]::text[]));

COMMIT;
