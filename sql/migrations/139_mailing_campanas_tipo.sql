-- Migración 139: distinguir campañas guardadas vs envíos masivos técnicos.
--
-- La solapa "Campañas" del CRM (`/crm/comunicaciones` tab Campañas) muestra
-- filas de `mailing_campanas`. Diseñada para las campañas guardadas y
-- reutilizables del wizard (con audiencia + plantilla mailing + schedule).
--
-- Pero desde v1.0.178 los envíos masivos simples también crean fila padre en
-- `mailing_campanas` (como agrupador técnico para el historial). Sin
-- distinción, esos envíos aparecen en la solapa "Campañas" mezclados con las
-- diseñadas — semánticamente incorrecto y confuso.
--
-- Fix: agregar columna `tipo` con enum estricto. La solapa Campañas filtra por
-- `tipo='CAMPANA'`. Los envíos masivos (`tipo='ENVIO_MASIVO'`) solo aparecen
-- en el historial de "Envíos", nunca en la solapa Campañas.
--
-- Backfill:
--   - Las filas del backfill de la migración 138 (con `descripcion LIKE '%migración 138%'`)
--     → `tipo='ENVIO_MASIVO'`.
--   - Las filas creadas por `/enviar-masivo` (con `nombre` empezando con "Envío masivo —")
--     → `tipo='ENVIO_MASIVO'`.
--   - Las filas creadas por `wizard-enviar` en modo masivo (con `nombre` empezando
--     con "Envío desde wizard —") → `tipo='ENVIO_MASIVO'`.
--   - Todo lo demás (creadas explícitamente desde el wizard como campaña reutilizable)
--     → `tipo='CAMPANA'`.

BEGIN;

ALTER TABLE public.mailing_campanas
  ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NOT NULL DEFAULT 'CAMPANA'
  CHECK (tipo IN ('CAMPANA', 'ENVIO_MASIVO'));

-- Índice para acelerar el filtro de la solapa Campañas.
CREATE INDEX IF NOT EXISTS idx_mailing_campanas_tipo
  ON public.mailing_campanas (tipo, created_at DESC);

COMMENT ON COLUMN public.mailing_campanas.tipo IS
  'CAMPANA = campaña guardada reutilizable del wizard. ENVIO_MASIVO = agrupador técnico de un envío masivo simple (no aparece en la solapa Campañas).';

-- Backfill: solo aplica a filas que aún tienen el default (nunca las tocamos).
UPDATE public.mailing_campanas
SET tipo = 'ENVIO_MASIVO'
WHERE tipo = 'CAMPANA'
  AND (
    descripcion LIKE '%migración 138%'
    OR descripcion LIKE '%Reconstruido desde envíos históricos%'
    OR descripcion LIKE '%Envío masivo iniciado desde%'
    OR descripcion LIKE '%Envío iniciado desde el wizard%'
    OR nombre LIKE 'Envío masivo —%'
    OR nombre LIKE 'Envío desde wizard —%'
  );

COMMIT;
