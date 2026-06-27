-- ============================================================================
-- Migración 100: agregar medio_pago a polizas
-- ============================================================================
-- Campo opcional con enum hardcoded (sin catálogo configurable).
-- Valores: EFECTIVO / DEBITO_CUENTA / TARJETA_CREDITO.
--
-- La migración 017 había eliminado la columna anterior `medio_pago_id` (FK a
-- catálogos). Reintroducimos el dato como enum textual siguiendo el patrón de
-- `refacturacion` (post-migración 095): más simple, sin catálogo a configurar.
-- ============================================================================

ALTER TABLE polizas
  ADD COLUMN IF NOT EXISTS medio_pago VARCHAR(30);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conrelid = 'polizas'::regclass
    AND    conname  = 'polizas_medio_pago_check'
  ) THEN
    ALTER TABLE polizas
      ADD CONSTRAINT polizas_medio_pago_check
      CHECK (
        medio_pago IS NULL
        OR medio_pago IN ('EFECTIVO', 'DEBITO_CUENTA', 'TARJETA_CREDITO')
      );
  END IF;
END $$;
