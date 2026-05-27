-- ============================================================
-- 027_siniestros_bitacora_y_papelera.sql
--
-- 1. Amplía el CHECK de `siniestro_bitacora.tipo` para incluir los nuevos
--    eventos del ciclo de vida (CREACION, EDICION, ELIMINACION,
--    RESTAURACION, PURGA_DEFINITIVA), preservando los previos
--    (NOTA, ESTADO, ARCHIVO).
-- 2. Agrega columnas `usuario_id` y `campos_modificados` JSONB a la
--    bitácora para auditoría completa (quién + qué cambió en EDICION).
-- 3. Soft-delete en `siniestros`: columnas `deleted_at` +
--    `deleted_by_usuario_id`. Las páginas filtran por `deleted_at IS NULL`
--    y un cron purga >30 días.
-- 4. Backfill: inserta CREACION para los siniestros existentes que no
--    tienen evento de creación todavía (idempotente).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Ampliar CHECK de tipos en siniestro_bitacora
-- ────────────────────────────────────────────────────────────

ALTER TABLE siniestro_bitacora DROP CONSTRAINT IF EXISTS siniestro_bitacora_tipo_check;
ALTER TABLE siniestro_bitacora ADD CONSTRAINT siniestro_bitacora_tipo_check CHECK (
  tipo IN (
    'NOTA',
    'ESTADO',
    'ARCHIVO',
    'CREACION',
    'EDICION',
    'ELIMINACION',
    'RESTAURACION',
    'PURGA_DEFINITIVA'
  )
);

-- ────────────────────────────────────────────────────────────
-- 2. Columnas de auditoría en bitácora
-- ────────────────────────────────────────────────────────────

ALTER TABLE siniestro_bitacora
  ADD COLUMN IF NOT EXISTS usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL;

ALTER TABLE siniestro_bitacora
  ADD COLUMN IF NOT EXISTS campos_modificados JSONB;

CREATE INDEX IF NOT EXISTS idx_siniestro_bitacora_fecha
  ON siniestro_bitacora(siniestro_id, created_at DESC);

-- ────────────────────────────────────────────────────────────
-- 3. Papelera de siniestros (soft delete + retención 30 días)
-- ────────────────────────────────────────────────────────────

ALTER TABLE siniestros
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE siniestros
  ADD COLUMN IF NOT EXISTS deleted_by_usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL;

-- Índice parcial: solo cubre filas en papelera para que el cron de purga
-- las encuentre rápido sin afectar las queries del listado normal.
CREATE INDEX IF NOT EXISTS idx_siniestros_deleted_at
  ON siniestros(deleted_at)
  WHERE deleted_at IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 4. Backfill de CREACION para siniestros existentes
--    (idempotente: solo siniestros que aún no tienen ningún evento
--    CREACION en su bitácora)
-- ────────────────────────────────────────────────────────────

INSERT INTO siniestro_bitacora (siniestro_id, tipo, estado_nuevo, texto, created_at)
SELECT
  s.id,
  'CREACION',
  s.estado,
  'Backfill: evento de creación inferido del registro original',
  COALESCE(s.created_at, s.fecha_denuncia::timestamptz, NOW())
FROM siniestros s
WHERE NOT EXISTS (
  SELECT 1 FROM siniestro_bitacora b
  WHERE b.siniestro_id = s.id AND b.tipo = 'CREACION'
);
