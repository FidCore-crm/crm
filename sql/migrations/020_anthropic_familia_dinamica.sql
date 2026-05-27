-- Migración 020: Sistema de resolución dinámica de modelos Anthropic.
--
-- Objetivo: que el CRM no dependa de IDs de modelo hardcodeados. Anthropic
-- discontinúa versiones periódicamente (ej: claude-sonnet-4-20250514 ya no
-- existe y fue reemplazado por claude-sonnet-4-6). El admin elige una
-- FAMILIA (sonnet / opus / haiku) y el CRM resuelve en tiempo de llamada
-- al modelo más nuevo disponible dentro de esa familia.
--
-- Cambios:
--   1. Columna anthropic_familia en configuracion (sonnet/opus/haiku).
--   2. Tabla anthropic_modelos_cache con la lista viva sincronizada con
--      /v1/models (refrescada por cron semanal + on-demand).
--   3. Backfill: infiere la familia del anthropic_model actual usando
--      substring match. Si no coincide, queda NULL y el resolver cae al
--      default 'sonnet' la próxima vez.

-- ---------------------------------------------------------------------------
-- 1. Columna anthropic_familia
-- ---------------------------------------------------------------------------
ALTER TABLE configuracion
  ADD COLUMN IF NOT EXISTS anthropic_familia VARCHAR(20);

-- CHECK constraint: solo valores conocidos + NULL. Si Anthropic publica una
-- familia nueva, hay que ampliar este CHECK en una migración futura — es
-- intencional que requiera revisión humana al agregar una familia.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'configuracion_anthropic_familia_check'
  ) THEN
    ALTER TABLE configuracion
      ADD CONSTRAINT configuracion_anthropic_familia_check
      CHECK (anthropic_familia IS NULL OR anthropic_familia IN ('sonnet', 'opus', 'haiku'));
  END IF;
END $$;

-- Backfill desde anthropic_model existente (substring match).
UPDATE configuracion
SET anthropic_familia =
  CASE
    WHEN anthropic_model ILIKE '%sonnet%' THEN 'sonnet'
    WHEN anthropic_model ILIKE '%opus%'   THEN 'opus'
    WHEN anthropic_model ILIKE '%haiku%'  THEN 'haiku'
    ELSE 'sonnet'  -- default razonable
  END
WHERE anthropic_familia IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Tabla anthropic_modelos_cache
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS anthropic_modelos_cache (
  id              VARCHAR(100) PRIMARY KEY,
  display_name    VARCHAR(200),
  familia         VARCHAR(20),           -- derivado de id: sonnet/opus/haiku/otro
  created_at      TIMESTAMPTZ,           -- fecha de publicación del modelo (Anthropic)
  deprecated_at   TIMESTAMPTZ,           -- fecha anunciada de deprecation (si existe)
  refreshed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anthropic_modelos_cache_familia
  ON anthropic_modelos_cache(familia)
  WHERE familia IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_anthropic_modelos_cache_vigentes
  ON anthropic_modelos_cache(familia, created_at DESC);

-- RLS permisiva (mismo patrón que otras tablas del sistema)
ALTER TABLE anthropic_modelos_cache ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'anthropic_modelos_cache'
      AND policyname = 'Permitir todo en anthropic_modelos_cache'
  ) THEN
    CREATE POLICY "Permitir todo en anthropic_modelos_cache"
      ON anthropic_modelos_cache FOR ALL
      USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMENT ON TABLE anthropic_modelos_cache IS
  'Cache local de GET https://api.anthropic.com/v1/models. Refrescado por cron semanal (/api/cron/sincronizar-modelos-anthropic) y on-demand cuando una llamada falla con MODEL_DISCONTINUED.';

COMMENT ON COLUMN configuracion.anthropic_familia IS
  'Familia de modelo que prefiere el admin (sonnet/opus/haiku). El ID concreto se resuelve en tiempo de llamada al modelo más nuevo disponible en esa familia.';
