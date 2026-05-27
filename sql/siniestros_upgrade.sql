-- ============================================================
-- Siniestros — Upgrade: columnas extra + tabla archivos
-- Ejecutar en Supabase Studio (SQL Editor)
-- ============================================================

-- 1. Agregar columnas a siniestros (si no existen)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='siniestros' AND column_name='hora_siniestro') THEN
    ALTER TABLE siniestros ADD COLUMN hora_siniestro TIME;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='siniestros' AND column_name='lugar_siniestro') THEN
    ALTER TABLE siniestros ADD COLUMN lugar_siniestro TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='siniestros' AND column_name='localidad_siniestro') THEN
    ALTER TABLE siniestros ADD COLUMN localidad_siniestro TEXT;
  END IF;
END$$;

-- 2. Crear tabla siniestro_archivos
CREATE TABLE IF NOT EXISTS siniestro_archivos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  siniestro_id UUID NOT NULL REFERENCES siniestros(id) ON DELETE CASCADE,
  categoria   TEXT NOT NULL CHECK (categoria IN ('fotos','documentacion')),
  nombre      TEXT NOT NULL,
  ruta        TEXT NOT NULL,
  mime_type   TEXT,
  tamano      INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_siniestro_archivos_siniestro_id ON siniestro_archivos(siniestro_id);

-- RLS
ALTER TABLE siniestro_archivos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='siniestro_archivos' AND policyname='Permitir todo en siniestro_archivos') THEN
    CREATE POLICY "Permitir todo en siniestro_archivos" ON siniestro_archivos
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END$$;
