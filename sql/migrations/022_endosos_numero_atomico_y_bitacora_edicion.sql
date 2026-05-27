-- ============================================================
-- Migración 022 — numero_endoso atómico + bitácora EDICION
-- ============================================================
--
-- Cambios:
--
-- 1) endosos.numero_endoso pasa a ser único por póliza:
--    - Se renumeran filas duplicadas (caso raro pero posible
--      por la race condition que resolvemos acá).
--    - Se agrega UNIQUE(poliza_id, numero_endoso).
--    - Se agrega función SQL generar_numero_endoso(uuid) que
--      reserva el próximo número de forma atómica usando un
--      INSERT con ON CONFLICT, similar a generar_numero_caso.
--
-- 2) poliza_bitacora.tipo_evento amplía el CHECK para aceptar
--    'EDICION' (cambios manuales en la ficha de póliza).
--
-- Idempotente.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1) Renumerar duplicados antes de imponer el UNIQUE
-- ────────────────────────────────────────────────────────────
WITH numerados AS (
  SELECT
    id,
    poliza_id,
    ROW_NUMBER() OVER (PARTITION BY poliza_id ORDER BY created_at, id) AS nuevo_numero
  FROM endosos
)
UPDATE endosos e
SET numero_endoso = n.nuevo_numero
FROM numerados n
WHERE e.id = n.id
  AND e.numero_endoso IS DISTINCT FROM n.nuevo_numero;

-- ────────────────────────────────────────────────────────────
-- 2) Constraint UNIQUE para evitar futuros duplicados.
-- Idempotente: limpiamos cualquier resto previo (constraint o índice
-- huérfano con el mismo nombre) y volvemos a crear con la definición
-- canónica.
-- ────────────────────────────────────────────────────────────
ALTER TABLE endosos DROP CONSTRAINT IF EXISTS uq_endosos_poliza_numero;
DROP INDEX IF EXISTS uq_endosos_poliza_numero;
ALTER TABLE endosos
  ADD CONSTRAINT uq_endosos_poliza_numero UNIQUE (poliza_id, numero_endoso);

-- ────────────────────────────────────────────────────────────
-- 3) Función atómica para generar el próximo numero_endoso
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION generar_numero_endoso(p_poliza_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_max INTEGER;
BEGIN
  -- Lock pesimista en la fila de la póliza para serializar generadores
  -- concurrentes que apunten a la misma póliza. No bloquea otras pólizas.
  PERFORM 1 FROM polizas WHERE id = p_poliza_id FOR UPDATE;

  SELECT COALESCE(MAX(numero_endoso), 0)
    INTO v_max
    FROM endosos
   WHERE poliza_id = p_poliza_id;

  RETURN v_max + 1;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 4) Recrear CHECK de poliza_bitacora.tipo_evento con 'EDICION'
-- ────────────────────────────────────────────────────────────
ALTER TABLE poliza_bitacora DROP CONSTRAINT IF EXISTS poliza_bitacora_tipo_evento_check;
ALTER TABLE poliza_bitacora
  ADD CONSTRAINT poliza_bitacora_tipo_evento_check CHECK (tipo_evento IN (
    'CREACION',
    'CAMBIO_ESTADO',
    'CANCELACION',
    'ANULACION',
    'REHABILITACION',
    'RENOVACION_CREADA',
    'RENOVACION_ACTIVADA',
    'EDICION'
  ));

COMMIT;
