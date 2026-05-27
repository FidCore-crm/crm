-- ============================================================
-- Migración 040: Agregar estado EN_TRAMITE a siniestros
-- ============================================================
-- Amplía el CHECK constraint de siniestros.estado para incluir
-- el estado EN_TRAMITE, usado durante la gestión administrativa
-- antes/durante/después de la inspección.
--
-- Idempotente: si ya está aplicada no rompe nada.
-- ============================================================

BEGIN;

-- 1. Reemplazar CHECK constraint
ALTER TABLE siniestros
  DROP CONSTRAINT IF EXISTS siniestros_estado_check;

ALTER TABLE siniestros
  ADD CONSTRAINT siniestros_estado_check CHECK (
    estado::text = ANY (ARRAY[
      'DENUNCIADO'::character varying,
      'EN_TRAMITE'::character varying,
      'INSPECCION'::character varying,
      'LIQUIDACION'::character varying,
      'REPARACION'::character varying,
      'FINALIZADO'::character varying,
      'RECHAZADO'::character varying
    ]::text[])
  );

COMMIT;
