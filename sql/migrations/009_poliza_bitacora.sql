-- ============================================================
-- 009_poliza_bitacora.sql
--
-- Bitácora append-only de cambios de estado y eventos críticos
-- de las pólizas (creación, cancelación, anulación, rehabilitación,
-- renovación creada/activada).
--
-- También agrega el tipo de notificación POLIZA_REHABILITADA.
-- ============================================================

CREATE TABLE IF NOT EXISTS poliza_bitacora (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poliza_id UUID NOT NULL REFERENCES polizas(id) ON DELETE CASCADE,

  tipo_evento VARCHAR NOT NULL CHECK (tipo_evento IN (
    'CREACION',
    'CAMBIO_ESTADO',
    'CANCELACION',
    'ANULACION',
    'REHABILITACION',
    'RENOVACION_CREADA',
    'RENOVACION_ACTIVADA'
  )),

  estado_anterior VARCHAR,
  estado_nuevo VARCHAR,

  motivo TEXT,
  observaciones TEXT,

  usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_poliza_bitacora_poliza ON poliza_bitacora(poliza_id);
CREATE INDEX IF NOT EXISTS idx_poliza_bitacora_fecha ON poliza_bitacora(created_at DESC);

ALTER TABLE poliza_bitacora ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo en poliza_bitacora" ON poliza_bitacora;
CREATE POLICY "Permitir todo en poliza_bitacora" ON poliza_bitacora
  FOR ALL USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- Backfill: poblar eventos históricos inferibles de las pólizas
-- actuales. Solo corre si la tabla está vacía para ser idempotente.
-- ────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM poliza_bitacora LIMIT 1) THEN
    -- CREACION para todas las pólizas
    INSERT INTO poliza_bitacora (poliza_id, tipo_evento, estado_nuevo, created_at)
    SELECT id, 'CREACION', estado, created_at
    FROM polizas;

    -- CANCELACION para las canceladas
    INSERT INTO poliza_bitacora (poliza_id, tipo_evento, estado_anterior, estado_nuevo, motivo, observaciones, created_at)
    SELECT id, 'CANCELACION', 'VIGENTE', 'CANCELADA', motivo_baja, observaciones_baja,
           COALESCE(fecha_baja::timestamptz, updated_at)
    FROM polizas WHERE estado = 'CANCELADA';

    -- ANULACION para las anuladas
    INSERT INTO poliza_bitacora (poliza_id, tipo_evento, estado_anterior, estado_nuevo, motivo, observaciones, created_at)
    SELECT id, 'ANULACION', 'VIGENTE', 'ANULADA', motivo_baja, observaciones_baja,
           COALESCE(fecha_baja::timestamptz, updated_at)
    FROM polizas WHERE estado = 'ANULADA';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- Nuevo tipo de notificación: POLIZA_REHABILITADA
-- (recrea el CHECK preservando los tipos previos)
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
    'PDF_FALLIDO',
    'POLIZA_REHABILITADA'
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
    'PDF_FALLIDO',
    'POLIZA_REHABILITADA'
  )
);
