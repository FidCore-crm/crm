-- ═══════════════════════════════════════════════════════════════
-- 127_siniestros_estado_en_tramite.sql
--
-- Agrega el estado EN_TRAMITE al CHECK constraint de siniestros.estado.
--
-- El estado ya estaba integrado en TODO el código (labels, colores,
-- portal del asegurado, ficha, filtros del listado, tipo TS) pero
-- nunca se agregó al CHECK de la DB. Consecuencia: cuando el PAS
-- intenta cambiar el estado a EN_TRAMITE, el UPDATE tira
-- "siniestros_estado_check violation" y el cambio no se persiste.
--
-- Idempotente: DROP + ADD con nombre estable.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE siniestros DROP CONSTRAINT IF EXISTS siniestros_estado_check;

ALTER TABLE siniestros ADD CONSTRAINT siniestros_estado_check
  CHECK (estado IN (
    'DENUNCIADO',
    'EN_TRAMITE',
    'INSPECCION',
    'LIQUIDACION',
    'REPARACION',
    'FINALIZADO',
    'RECHAZADO'
  ));

COMMENT ON CONSTRAINT siniestros_estado_check ON siniestros IS
  'Estados válidos del siniestro. Ver máquina de estados en src/lib/siniestros-estados.ts. EN_TRAMITE = en gestión administrativa con la compañía (agregado en migración 127).';
