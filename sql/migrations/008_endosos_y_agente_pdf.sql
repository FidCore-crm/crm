-- ============================================================
-- 008_endosos_y_agente_pdf.sql
--
-- Parte A: permite adjuntar archivos a endosos individuales
--   (nueva categoría `endosos` + columna endoso_id en poliza_archivos).
--
-- Parte B: backend del módulo IA para parser de PDFs de pólizas/
--   renovaciones/endosos — tabla pdf_procesamientos, toggle del
--   módulo en configuracion y nuevos tipos de notificaciones.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- PARTE A — Archivos de endosos
-- ────────────────────────────────────────────────────────────

ALTER TABLE poliza_archivos
  ADD COLUMN IF NOT EXISTS endoso_id UUID REFERENCES endosos(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_poliza_archivos_endoso
  ON poliza_archivos(endoso_id) WHERE endoso_id IS NOT NULL;

-- Nota: la columna `categoria` es VARCHAR sin CHECK, así que se admite
-- el nuevo valor `endosos` sin alterar la tabla. Documentado en CLAUDE.md.

-- ────────────────────────────────────────────────────────────
-- PARTE B — Módulo IA: parser de PDFs
-- ────────────────────────────────────────────────────────────

-- Toggle del módulo (independiente de la API key)
ALTER TABLE configuracion
  ADD COLUMN IF NOT EXISTS modulo_ia_pdf_polizas_activo BOOLEAN DEFAULT false;

-- Tabla principal de procesamientos
CREATE TABLE IF NOT EXISTS pdf_procesamientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tipo de operación que representa el PDF
  tipo_operacion VARCHAR NOT NULL CHECK (
    tipo_operacion IN ('POLIZA_NUEVA', 'RENOVACION', 'ENDOSO')
  ),

  -- Si es renovación o endoso, póliza del CRM a la que aplica
  poliza_origen_id UUID REFERENCES polizas(id) ON DELETE SET NULL,

  -- Resultados tras aprobar
  poliza_creada_id UUID REFERENCES polizas(id) ON DELETE SET NULL,
  endoso_creado_id UUID REFERENCES endosos(id) ON DELETE SET NULL,

  -- Estado del flujo
  estado VARCHAR NOT NULL DEFAULT 'PENDIENTE' CHECK (
    estado IN ('PENDIENTE', 'PROCESANDO', 'EXTRAIDO', 'APROBADO', 'CANCELADO', 'FALLIDO')
  ),

  -- Archivo original
  nombre_archivo VARCHAR NOT NULL,
  tamano_archivo INTEGER,
  ruta_temporal TEXT,

  -- Datos extraídos por la IA (DatosExtraidosPoliza | DatosExtraidosEndoso)
  datos_extraidos JSONB,

  -- Mapeo contra catálogos del CRM
  mapeos_catalogos JSONB,

  -- Campos que requieren decisión del PAS
  campos_dudosos JSONB,

  -- Tracking de uso de IA
  tokens_usados INTEGER,
  costo_estimado DECIMAL(10, 4),

  -- Errores
  error_mensaje TEXT,

  -- Auditoría
  usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pdf_procesamientos_estado
  ON pdf_procesamientos(estado);
CREATE INDEX IF NOT EXISTS idx_pdf_procesamientos_usuario
  ON pdf_procesamientos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_pdf_procesamientos_poliza_origen
  ON pdf_procesamientos(poliza_origen_id) WHERE poliza_origen_id IS NOT NULL;

ALTER TABLE pdf_procesamientos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo en pdf_procesamientos" ON pdf_procesamientos;
CREATE POLICY "Permitir todo en pdf_procesamientos" ON pdf_procesamientos
  FOR ALL USING (true) WITH CHECK (true);

-- Trigger para mantener updated_at al día (reusa el pattern de otras tablas)
CREATE OR REPLACE FUNCTION trg_pdf_procesamientos_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_pdf_procesamientos_touch ON pdf_procesamientos;
CREATE TRIGGER tg_pdf_procesamientos_touch
  BEFORE UPDATE ON pdf_procesamientos
  FOR EACH ROW EXECUTE FUNCTION trg_pdf_procesamientos_touch();

-- ────────────────────────────────────────────────────────────
-- Nuevos tipos de notificaciones (PDF_LISTO_PARA_REVISAR / PDF_FALLIDO)
-- Se recrea el CHECK manteniendo TODOS los valores previos.
-- ────────────────────────────────────────────────────────────

ALTER TABLE notificaciones DROP CONSTRAINT IF EXISTS notificaciones_tipo_check;
ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_tipo_check CHECK (
  tipo IN (
    'POLIZA_VENCIDA',
    'TAREA_VENCIDA',
    'SINIESTRO_30_DIAS',
    'SINIESTRO_60_DIAS',
    'COTIZACION_SIN_RESPUESTA',
    'COTIZACION_SIN_SEGUIMIENTO',
    'OPORTUNIDAD_ESTANCADA',
    'COTIZACION_VENCIENDO_PRONTO',
    'COTIZACION_VENCIDA',
    'IMPORTACION_INICIADA',
    'IMPORTACION_ANALIZADA',
    'IMPORTACION_LISTA_REVISION',
    'IMPORTACION_COMPLETADA',
    'IMPORTACION_FALLIDA',
    'IMPORTACION_PAUSADA',
    'IMPORTACION_DESHECHA',
    'PDF_LISTO_PARA_REVISAR',
    'PDF_FALLIDO'
  )
);

ALTER TABLE configuracion_notificaciones DROP CONSTRAINT IF EXISTS configuracion_notificaciones_tipo_check;
ALTER TABLE configuracion_notificaciones ADD CONSTRAINT configuracion_notificaciones_tipo_check CHECK (
  tipo IN (
    'POLIZA_VENCIDA',
    'TAREA_VENCIDA',
    'SINIESTRO_30_DIAS',
    'SINIESTRO_60_DIAS',
    'COTIZACION_SIN_RESPUESTA',
    'COTIZACION_SIN_SEGUIMIENTO',
    'OPORTUNIDAD_ESTANCADA',
    'COTIZACION_VENCIENDO_PRONTO',
    'COTIZACION_VENCIDA',
    'IMPORTACION_INICIADA',
    'IMPORTACION_ANALIZADA',
    'IMPORTACION_LISTA_REVISION',
    'IMPORTACION_COMPLETADA',
    'IMPORTACION_FALLIDA',
    'IMPORTACION_PAUSADA',
    'IMPORTACION_DESHECHA',
    'PDF_LISTO_PARA_REVISAR',
    'PDF_FALLIDO'
  )
);
