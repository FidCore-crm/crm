-- ============================================================
-- Migración 021 — tipo_riesgo dinámico
-- ============================================================
--
-- Contexto:
--   El CHECK constraint en riesgos.tipo_riesgo limitaba el valor
--   a una lista fija de 14 tipos hardcodeados. Esto contradice el
--   diseño del CRM: los catálogos (RAMO con metadata.tipo_riesgo)
--   son la única fuente de verdad y el PAS los modifica desde la
--   UI sin tocar SQL.
--
--   Si un PAS agrega un ramo "MASCOTAS" con metadata.tipo_riesgo
--   custom, el sistema tiene que aceptarlo sin migraciones.
--
-- Cambio:
--   1. Drop del CHECK constraint en riesgos.tipo_riesgo.
--   2. La columna sigue existiendo como VARCHAR(50) NOT NULL —
--      acepta cualquier identificador alfanumérico.
--   3. El formulario de detalle_tecnico se sigue renderizando en
--      base a ramo.metadata.tipo_riesgo (con fallback a "generico"),
--      así un tipo custom sin form específico cae al genérico.
-- ============================================================

ALTER TABLE riesgos DROP CONSTRAINT IF EXISTS riesgos_tipo_riesgo_check;

-- Comentario a nivel de columna para que quede documentado en DB
COMMENT ON COLUMN riesgos.tipo_riesgo IS
  'Tipo de riesgo dictado por el catálogo RAMO del PAS (ramo.metadata.tipo_riesgo). Sin CHECK constraint: acepta cualquier valor para soportar ramos custom agregados por el PAS desde la UI (ej: MASCOTAS, DRONES). Los índices parciales con valores clásicos (AUTOMOTOR, MOTO, HOGAR, COMERCIO) siguen funcionando pero no cubren tipos custom.';
