-- ============================================================
-- Migración 023 — Audit log de pólizas eliminadas
-- ============================================================
--
-- Cuando un admin elimina una póliza, el FK CASCADE borra también
-- su bitácora (poliza_bitacora). Eso significa que NO queda rastro
-- de la eliminación en ninguna tabla. Para poder auditar quién
-- eliminó qué y cuándo (incluso después de la eliminación), guardamos
-- un snapshot mínimo en una tabla independiente del FK.
--
-- Esta tabla NO tiene FK hacia polizas: sobrevive al DELETE.
--
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS polizas_eliminadas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Snapshot del registro original (sin FK)
  poliza_id UUID NOT NULL,
  numero_poliza VARCHAR NOT NULL,
  asegurado_id UUID,
  asegurado_nombre VARCHAR,
  compania_id UUID,
  compania_nombre VARCHAR,
  ramo_id UUID,
  ramo_nombre VARCHAR,
  estado VARCHAR,
  fecha_inicio DATE,
  fecha_fin DATE,
  poliza_origen_id UUID,

  -- Métricas eliminadas en cascada
  cant_polizas_hijas INTEGER DEFAULT 0,
  cant_riesgos INTEGER DEFAULT 0,
  cant_siniestros INTEGER DEFAULT 0,
  cant_endosos INTEGER DEFAULT 0,
  cant_archivos INTEGER DEFAULT 0,

  -- Auditoría
  eliminada_por_usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  eliminada_por_email VARCHAR,
  motivo TEXT,
  fecha_eliminacion TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_polizas_eliminadas_fecha
  ON polizas_eliminadas(fecha_eliminacion DESC);
CREATE INDEX IF NOT EXISTS idx_polizas_eliminadas_usuario
  ON polizas_eliminadas(eliminada_por_usuario_id);
CREATE INDEX IF NOT EXISTS idx_polizas_eliminadas_numero
  ON polizas_eliminadas(numero_poliza);

ALTER TABLE polizas_eliminadas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo en polizas_eliminadas" ON polizas_eliminadas;
CREATE POLICY "Permitir todo en polizas_eliminadas" ON polizas_eliminadas
  FOR ALL USING (true) WITH CHECK (true);
