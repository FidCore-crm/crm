-- ============================================================
-- 036_cotizaciones_fixes.sql
--
-- Auditoría de cotizaciones — cierra deuda detectada:
--
-- 1) FK cotizaciones.persona_id: SET NULL → CASCADE
--    CLAUDE.md afirma "personas → cotizaciones (persona_id) = CASCADE"
--    pero la DB tenía SET NULL desde la migración 017. Al borrar una
--    persona quedaban cotizaciones huérfanas (persona_id NULL,
--    lead_id NULL) imposibles de filtrar y semánticamente inválidas.
--    Ahora al borrar la persona se borran sus cotizaciones — coherente
--    con el comportamiento de pólizas, siniestros, tareas.
--
-- 2) Índices faltantes para el cron de notificaciones:
--      - fecha_envio (filtra COTIZACION_SIN_RESPUESTA)
--      - updated_at (filtra COTIZACION_SIN_SEGUIMIENTO)
--    Solo aplicados sobre estados activos (ENVIADA / EN_PROCESO) para
--    mantener el índice chico.
--
-- 3) UNIQUE (cotizacion_id, compania_id, cobertura_id) no protege
--    duplicados con cobertura_id NULL (PostgreSQL trata NULLs como
--    distintos). Reemplazado por dos índices únicos parciales:
--      - WHERE cobertura_id IS NOT NULL → (cot_id, comp_id, cob_id)
--      - WHERE cobertura_id IS NULL     → (cot_id, comp_id)
--    Cubre todos los casos sin permitir bypass por API directa.
-- ============================================================

BEGIN;

-- ── 1) FK persona_id → CASCADE ───────────────────────────────
ALTER TABLE cotizaciones DROP CONSTRAINT IF EXISTS cotizaciones_persona_id_fkey;
ALTER TABLE cotizaciones
  ADD CONSTRAINT cotizaciones_persona_id_fkey
  FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE;

-- ── 2) Índices para queries del cron ─────────────────────────
CREATE INDEX IF NOT EXISTS idx_cotizaciones_fecha_envio
  ON cotizaciones(fecha_envio)
  WHERE fecha_envio IS NOT NULL AND estado IN ('ENVIADA', 'EN_PROCESO');

CREATE INDEX IF NOT EXISTS idx_cotizaciones_updated_at_en_proceso
  ON cotizaciones(updated_at)
  WHERE estado = 'EN_PROCESO';

-- ── 3) UNIQUE de cotizacion_companias con manejo de NULL ─────
ALTER TABLE cotizacion_companias
  DROP CONSTRAINT IF EXISTS cotizacion_companias_cotizacion_id_compania_id_cobertura_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cotizacion_companias_con_cobertura
  ON cotizacion_companias (cotizacion_id, compania_id, cobertura_id)
  WHERE cobertura_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cotizacion_companias_sin_cobertura
  ON cotizacion_companias (cotizacion_id, compania_id)
  WHERE cobertura_id IS NULL;

COMMIT;
