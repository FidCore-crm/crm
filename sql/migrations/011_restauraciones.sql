-- ============================================================================
-- Fase 2 — Sistema de restauración de backups
-- ============================================================================
-- Tabla restauraciones: tracking completo de cada restauración (fuente, estado,
-- progreso, pre-backup generado, contenido restaurado, logs, auditoría).
-- ============================================================================

CREATE TABLE IF NOT EXISTS restauraciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Origen
  fuente VARCHAR NOT NULL CHECK (fuente IN ('BACKUP_EXISTENTE', 'ARCHIVO_SUBIDO')),
  backup_id UUID REFERENCES backups(id) ON DELETE SET NULL,
  nombre_archivo VARCHAR,
  tamano_archivo_bytes BIGINT,
  sha256_archivo VARCHAR,

  -- Estado de la máquina de estados
  estado VARCHAR NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN (
    'PENDIENTE', 'VALIDANDO', 'PRE_BACKUP', 'DESCIFRANDO',
    'EXTRAYENDO', 'RESTAURANDO_DB', 'RESTAURANDO_STORAGE',
    'FINALIZANDO', 'COMPLETADA', 'FALLIDA', 'CANCELADA'
  )),

  -- Progreso
  paso_actual INTEGER DEFAULT 0,
  total_pasos INTEGER DEFAULT 8,
  mensaje_progreso TEXT,
  porcentaje INTEGER DEFAULT 0,

  -- Contenido a restaurar (el PAS elige al confirmar)
  restaura_db BOOLEAN DEFAULT true,
  restaura_storage BOOLEAN DEFAULT true,
  restaura_env BOOLEAN DEFAULT false,
  restaura_rclone BOOLEAN DEFAULT false,
  restaura_systemd BOOLEAN DEFAULT false,

  -- Pre-backup de seguridad (el backup del estado actual antes de restaurar)
  crear_pre_backup BOOLEAN DEFAULT true,
  pre_backup_id UUID REFERENCES backups(id) ON DELETE SET NULL,

  -- Metadata del backup que se restaura (extraída del archivo)
  metadata_backup JSONB,

  -- Resultados
  fecha_inicio TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  fecha_fin TIMESTAMP WITH TIME ZONE,
  duracion_segundos INTEGER,
  error_mensaje TEXT,
  log_completo TEXT,

  -- Trabajo temporal
  work_dir TEXT,

  -- Auditoría
  usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  ip_origen VARCHAR,
  user_agent TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restauraciones_fecha ON restauraciones(fecha_inicio DESC);
CREATE INDEX IF NOT EXISTS idx_restauraciones_estado ON restauraciones(estado);
CREATE INDEX IF NOT EXISTS idx_restauraciones_usuario ON restauraciones(usuario_id);

ALTER TABLE restauraciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo en restauraciones" ON restauraciones;
CREATE POLICY "Permitir todo en restauraciones" ON restauraciones FOR ALL USING (true) WITH CHECK (true);

-- Nuevos tipos de notificación
ALTER TABLE notificaciones DROP CONSTRAINT IF EXISTS notificaciones_tipo_check;
ALTER TABLE notificaciones
  ADD CONSTRAINT notificaciones_tipo_check
  CHECK (tipo IN (
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
    'POLIZA_REHABILITADA',
    'BACKUP_FALLIDO',
    'BACKUP_SYNC_FALLIDO',
    'BACKUP_PASSPHRASE_CONFIGURADA',
    'BACKUP_PASSPHRASE_RECOVERY_ENVIADO',
    -- Fase 2
    'RESTAURACION_INICIADA',
    'RESTAURACION_COMPLETADA',
    'RESTAURACION_FALLIDA'
  ));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'configuracion_notificaciones'
  ) THEN
    ALTER TABLE configuracion_notificaciones DROP CONSTRAINT IF EXISTS configuracion_notificaciones_tipo_check;
    ALTER TABLE configuracion_notificaciones
      ADD CONSTRAINT configuracion_notificaciones_tipo_check
      CHECK (tipo IN (
        'POLIZA_VENCIDA','TAREA_VENCIDA','SINIESTRO_30_DIAS','SINIESTRO_60_DIAS',
        'COTIZACION_SIN_RESPUESTA','COTIZACION_SIN_SEGUIMIENTO','OPORTUNIDAD_ESTANCADA',
        'COTIZACION_VENCIENDO_PRONTO','COTIZACION_VENCIDA',
        'IMPORTACION_INICIADA','IMPORTACION_ANALIZADA','IMPORTACION_LISTA_REVISION',
        'IMPORTACION_COMPLETADA','IMPORTACION_FALLIDA','IMPORTACION_PAUSADA','IMPORTACION_DESHECHA',
        'PDF_LISTO_PARA_REVISAR','PDF_FALLIDO','POLIZA_REHABILITADA',
        'BACKUP_FALLIDO','BACKUP_SYNC_FALLIDO',
        'BACKUP_PASSPHRASE_CONFIGURADA','BACKUP_PASSPHRASE_RECOVERY_ENVIADO',
        'RESTAURACION_INICIADA','RESTAURACION_COMPLETADA','RESTAURACION_FALLIDA'
      ));
  END IF;
END $$;
