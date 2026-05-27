-- ============================================================
-- Migración 003: Post-its del dashboard (schema efectivo)
-- ============================================================
-- EJECUTAR MANUALMENTE.
-- La tabla ya existe en Prod (la UI y la API asumen este schema).
-- Este archivo es idempotente: solo crea si falta, para entornos
-- nuevos o restores desde cero.
--
-- Notas sobre nombres:
-- * La auditoría sugería contenido/es_compartido/fecha_eliminacion
-- * El código real usa texto/compartido. Los post-it persisten hasta
--   que el usuario los elimine manualmente (no hay cleanup automático).
-- ============================================================

CREATE TABLE IF NOT EXISTS postits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  color VARCHAR DEFAULT 'amarillo',
  compartido BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_postits_usuario ON postits(usuario_id);
CREATE INDEX IF NOT EXISTS idx_postits_created_at ON postits(created_at);

ALTER TABLE postits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir todo en postits" ON postits;
CREATE POLICY "Permitir todo en postits" ON postits
  FOR ALL USING (true) WITH CHECK (true);
