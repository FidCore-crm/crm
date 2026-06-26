-- Migración 096: ampliar poliza_archivos.categoria de VARCHAR(20) a VARCHAR(40).
--
-- Contexto: el valor 'documentacion_renovada' (22 chars) supera el límite
-- VARCHAR(20) original y rompe el INSERT desde el agente IA al aplicar una
-- renovación de póliza con PDF. El CHECK constraint sobre los valores válidos
-- se mantiene.

ALTER TABLE poliza_archivos
  ALTER COLUMN categoria TYPE VARCHAR(40);
