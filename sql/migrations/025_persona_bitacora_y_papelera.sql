-- ============================================================
-- 025_persona_bitacora_y_papelera.sql
--
-- 1. Bitácora append-only de eventos críticos en personas
--    (creación, edición, cambio de estado, eliminación, restauración).
-- 2. Papelera de reciclaje: las personas eliminadas se marcan con
--    deleted_at en vez de borrarse. Un cron purga las que tienen
--    >30 días en la papelera (DELETE físico con CASCADE).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Tabla persona_bitacora
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS persona_bitacora (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,

  tipo_evento VARCHAR NOT NULL CHECK (tipo_evento IN (
    'CREACION',
    'EDICION',
    'CAMBIO_ESTADO',
    'ELIMINACION',
    'RESTAURACION',
    'PURGA_DEFINITIVA'
  )),

  estado_anterior VARCHAR,
  estado_nuevo VARCHAR,

  -- Para EDICION: lista de campos modificados (JSONB array)
  campos_modificados JSONB,

  motivo TEXT,
  observaciones TEXT,

  usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_persona_bitacora_persona ON persona_bitacora(persona_id);
CREATE INDEX IF NOT EXISTS idx_persona_bitacora_fecha ON persona_bitacora(created_at DESC);

ALTER TABLE persona_bitacora ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo en persona_bitacora" ON persona_bitacora;
CREATE POLICY "Permitir todo en persona_bitacora" ON persona_bitacora
  FOR ALL USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 2. Papelera: columnas deleted_at + deleted_by_usuario_id en personas
-- ────────────────────────────────────────────────────────────

ALTER TABLE personas ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS deleted_by_usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL;

-- Índice parcial: solo cubre las que están en papelera para que el cron de
-- purga las encuentre rápido sin afectar las queries normales del listado.
CREATE INDEX IF NOT EXISTS idx_personas_deleted_at ON personas(deleted_at) WHERE deleted_at IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 3. Backfill: CREACION para personas existentes (idempotente)
-- ────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM persona_bitacora LIMIT 1) THEN
    INSERT INTO persona_bitacora (persona_id, tipo_evento, estado_nuevo, created_at)
    SELECT id, 'CREACION', estado, COALESCE(fecha_alta::timestamptz, created_at, NOW())
    FROM personas;
  END IF;
END $$;
