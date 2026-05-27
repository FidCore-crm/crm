-- ============================================================
-- Tabla configuracion — Perfil de la productora
-- Ejecutar en Supabase Studio (SQL Editor)
-- ============================================================

CREATE TABLE IF NOT EXISTS configuracion (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_operacion  VARCHAR NOT NULL DEFAULT 'INDEPENDIENTE'
                  CHECK (tipo_operacion IN ('INDEPENDIENTE','SOCIEDAD')),
  nombre          TEXT,
  razon_social    TEXT,
  cuit            VARCHAR,
  matricula_ssn   VARCHAR,
  logo_path       TEXT,
  telefono        VARCHAR,
  whatsapp        VARCHAR,
  email           VARCHAR,
  direccion       TEXT,
  sitio_web       VARCHAR,
  instagram       VARCHAR,
  facebook        VARCHAR,
  socios          JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE configuracion ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='configuracion' AND policyname='Permitir todo en configuracion') THEN
    CREATE POLICY "Permitir todo en configuracion" ON configuracion
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END$$;
