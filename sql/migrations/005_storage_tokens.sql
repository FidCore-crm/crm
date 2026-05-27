-- ============================================================
-- 005_storage_tokens.sql
-- Tokens firmados para acceso público a archivos vía
-- /api/storage/[...path]?token=...
-- ============================================================

CREATE TABLE IF NOT EXISTS storage_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token VARCHAR UNIQUE NOT NULL,
  ruta_archivo VARCHAR NOT NULL,
  fecha_creacion TIMESTAMPTZ DEFAULT NOW(),
  fecha_expiracion TIMESTAMPTZ NOT NULL,
  veces_usado INTEGER DEFAULT 0,
  max_usos INTEGER DEFAULT NULL,
  contexto VARCHAR,
  creado_por_usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_storage_tokens_token ON storage_tokens(token);
CREATE INDEX IF NOT EXISTS idx_storage_tokens_expiracion ON storage_tokens(fecha_expiracion);

ALTER TABLE storage_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo en storage_tokens" ON storage_tokens;
CREATE POLICY "Permitir todo en storage_tokens" ON storage_tokens FOR ALL USING (true) WITH CHECK (true);
