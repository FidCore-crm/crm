-- ============================================================
-- 034_facturacion_constraints.sql
--
-- Endurecimiento de constraints sobre `facturacion`:
--
--  1. UNIQUE INDEX parcial `(anio, mes, compania_id) WHERE ramo_id IS NULL`
--     El UNIQUE existente `(anio, mes, compania_id, ramo_id)` no protege
--     contra duplicados cuando `ramo_id` es NULL (PostgreSQL trata cada
--     NULL como distinto). El módulo de facturación actual siempre deja
--     `ramo_id` NULL → este índice parcial cierra esa puerta.
--
--  2. CHECK `monto >= 0`. El front ya valida pero la DB debe respaldar.
--
--  3. CHECK `anio BETWEEN 2000 AND 2100`. Evita inserts con años
--     accidentalmente fuera de rango (ej: typo del PAS).
--
-- Idempotente: usa `IF NOT EXISTS` y borra-y-recrea checks por nombre.
-- ============================================================

BEGIN;

-- 1. UNIQUE parcial para evitar duplicados con ramo_id NULL
CREATE UNIQUE INDEX IF NOT EXISTS uq_facturacion_periodo_compania_sin_ramo
  ON facturacion (anio, mes, compania_id)
  WHERE ramo_id IS NULL;

-- 2. CHECK monto >= 0
ALTER TABLE facturacion
  DROP CONSTRAINT IF EXISTS facturacion_monto_check;
ALTER TABLE facturacion
  ADD CONSTRAINT facturacion_monto_check CHECK (monto >= 0);

-- 3. CHECK anio razonable
ALTER TABLE facturacion
  DROP CONSTRAINT IF EXISTS facturacion_anio_check;
ALTER TABLE facturacion
  ADD CONSTRAINT facturacion_anio_check CHECK (anio BETWEEN 2000 AND 2100);

COMMIT;

NOTIFY pgrst, 'reload schema';
