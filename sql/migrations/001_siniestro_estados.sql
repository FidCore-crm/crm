-- ============================================================
-- Migración 001: Reconciliar estados de siniestro
-- ============================================================
-- Objetivo: asegurar que la columna `siniestros.estado` solo acepte
-- los 6 valores canónicos definidos en src/lib/siniestros-config.ts:
--   DENUNCIADO | INSPECCION | LIQUIDACION | REPARACION | FINALIZADO | RECHAZADO
--
-- EJECUTAR MANUALMENTE (no lo ejecuta la aplicación).
-- Correr desde Supabase Studio SQL editor o psql.
-- ============================================================

-- PASO 1: inspección previa — ver qué valores hay en la tabla hoy
SELECT estado, COUNT(*) AS total
FROM siniestros
GROUP BY estado
ORDER BY total DESC;

-- PASO 2 (opcional): mapeo de estados antiguos (por si existieran datos
-- con los valores legacy). Descomentar y ejecutar SOLO si el SELECT
-- anterior mostró algún valor fuera de los 6 canónicos.
--
-- UPDATE siniestros SET estado = 'DENUNCIADO'  WHERE estado = 'ABIERTO';
-- UPDATE siniestros SET estado = 'INSPECCION'  WHERE estado = 'EN_INVESTIGACION';
-- UPDATE siniestros SET estado = 'LIQUIDACION' WHERE estado IN ('EN_LIQUIDACION', 'PENDIENTE_DOCUMENTACION');
-- UPDATE siniestros SET estado = 'FINALIZADO'  WHERE estado IN ('CERRADO_PAGADO', 'CERRADO_DESISTIDO');
-- UPDATE siniestros SET estado = 'RECHAZADO'   WHERE estado = 'CERRADO_RECHAZADO';

-- PASO 3: aplicar check constraint en la columna estado
-- (primero quitamos cualquier constraint previo que pudiera existir)
ALTER TABLE siniestros DROP CONSTRAINT IF EXISTS siniestros_estado_check;

ALTER TABLE siniestros
  ADD CONSTRAINT siniestros_estado_check
  CHECK (estado IN ('DENUNCIADO','INSPECCION','LIQUIDACION','REPARACION','FINALIZADO','RECHAZADO'));

-- PASO 4: verificación final
SELECT estado, COUNT(*) AS total
FROM siniestros
GROUP BY estado
ORDER BY total DESC;
