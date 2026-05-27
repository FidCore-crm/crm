-- ============================================================================
-- Sistema unificado de errores — Fase 1
-- ============================================================================
--
-- Crea la tabla `errores_sistema` para persistir errores críticos con
-- agregación por ventana temporal (si el mismo error ocurre N veces en la
-- ventana, se incrementa `contador` en vez de crear rows nuevos).
--
-- Agrega 3 columnas en `configuracion_comunicaciones` para la retención y la
-- ventana de agregación (reusa el patrón existente de los emails).
-- ============================================================================

CREATE TABLE IF NOT EXISTS errores_sistema (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identificación
  codigo VARCHAR NOT NULL,           -- ERR_DB_001, ERR_EXT_002, etc.
  mensaje TEXT NOT NULL,             -- mensaje legible

  -- Contexto técnico
  modulo VARCHAR,                    -- 'comunicaciones', 'backups', 'agente-pdf', etc.
  endpoint VARCHAR,                  -- ruta de API si aplica
  metodo VARCHAR,                    -- GET / POST / etc.

  -- Detalle (se elimina al archivar)
  stack_trace TEXT,
  request_body JSONB,
  request_headers JSONB,
  contexto_extra JSONB,              -- cualquier dato extra del lugar donde ocurrió

  -- Usuario afectado (si aplica)
  usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,

  -- Correlation
  correlation_id VARCHAR,            -- para rastrear errores relacionados

  -- Agregación: si el mismo error se repite, incrementamos contador en vez
  -- de crear rows nuevos (ver persistencia.ts)
  contador INTEGER NOT NULL DEFAULT 1,
  primera_aparicion TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  ultima_aparicion TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- Retención
  archivado BOOLEAN NOT NULL DEFAULT false,  -- true = solo metadata, sin detalle

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_errores_codigo ON errores_sistema(codigo);
CREATE INDEX IF NOT EXISTS idx_errores_modulo ON errores_sistema(modulo);
CREATE INDEX IF NOT EXISTS idx_errores_ultima ON errores_sistema(ultima_aparicion DESC);
CREATE INDEX IF NOT EXISTS idx_errores_correlation
  ON errores_sistema(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_errores_no_archivados
  ON errores_sistema(created_at DESC) WHERE archivado = false;

-- Índice para la query de agregación (codigo + modulo + endpoint + ventana)
CREATE INDEX IF NOT EXISTS idx_errores_agregacion
  ON errores_sistema(codigo, modulo, endpoint, ultima_aparicion);

ALTER TABLE errores_sistema ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'errores_sistema'
      AND policyname = 'Permitir todo en errores_sistema'
  ) THEN
    CREATE POLICY "Permitir todo en errores_sistema" ON errores_sistema
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Configuración de retención en configuracion_comunicaciones
-- ---------------------------------------------------------------------------
ALTER TABLE configuracion_comunicaciones
  ADD COLUMN IF NOT EXISTS errores_retener_completo_dias INTEGER NOT NULL DEFAULT 30;
ALTER TABLE configuracion_comunicaciones
  ADD COLUMN IF NOT EXISTS errores_retener_metadata_dias INTEGER NOT NULL DEFAULT 90;
ALTER TABLE configuracion_comunicaciones
  ADD COLUMN IF NOT EXISTS errores_ventana_agregacion_minutos INTEGER NOT NULL DEFAULT 60;
