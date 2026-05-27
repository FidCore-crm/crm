-- ============================================================================
-- Fase 1 — Rediseño del sistema de backups al formato .crmseg
-- ============================================================================
--
-- Cambios:
--   1) configuracion_backups: pasos para passphrase + derived key
--   2) backups: formato, archivo único cifrado, sha256, contenido_incluido
--   3) notificaciones: 3 tipos nuevos (BACKUP_PASSPHRASE_CONFIGURADA,
--      BACKUP_PASSPHRASE_RECOVERY_ENVIADO, BACKUP_FALLIDO, BACKUP_SYNC_FALLIDO)
--
-- Notas:
--   - Todo es idempotente (IF NOT EXISTS / DROP+RECREATE para CHECK)
--   - La migración de backups legacy a CRMSEG NO ocurre acá — se hace manual
--     desde el panel cuando el PAS configura su passphrase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) configuracion_backups
-- ---------------------------------------------------------------------------
ALTER TABLE configuracion_backups
  ADD COLUMN IF NOT EXISTS passphrase_hash VARCHAR;

ALTER TABLE configuracion_backups
  ADD COLUMN IF NOT EXISTS passphrase_configurada_en TIMESTAMP WITH TIME ZONE;

ALTER TABLE configuracion_backups
  ADD COLUMN IF NOT EXISTS passphrase_recovery_email_enviado BOOLEAN DEFAULT false;

ALTER TABLE configuracion_backups
  ADD COLUMN IF NOT EXISTS passphrase_recovery_email_fecha TIMESTAMP WITH TIME ZONE;

-- Derived key encriptada con ENCRYPTION_KEY del sistema. Permite hacer backups
-- automáticos sin pedir la passphrase cada vez.
ALTER TABLE configuracion_backups
  ADD COLUMN IF NOT EXISTS passphrase_derived_key_encrypted TEXT;

-- Salt usado para derivar la key con scrypt (necesario para re-derivar al
-- validar la passphrase con el texto plano que ingrese el PAS).
ALTER TABLE configuracion_backups
  ADD COLUMN IF NOT EXISTS passphrase_salt VARCHAR;

-- ---------------------------------------------------------------------------
-- 2) backups
-- ---------------------------------------------------------------------------
ALTER TABLE backups
  ADD COLUMN IF NOT EXISTS formato VARCHAR DEFAULT 'LEGACY';

-- CHECK constraint (drop + recreate para idempotencia)
ALTER TABLE backups DROP CONSTRAINT IF EXISTS backups_formato_check;
ALTER TABLE backups
  ADD CONSTRAINT backups_formato_check
  CHECK (formato IN ('LEGACY', 'CRMSEG'));

ALTER TABLE backups
  ADD COLUMN IF NOT EXISTS archivo_unico_path TEXT;

ALTER TABLE backups
  ADD COLUMN IF NOT EXISTS archivo_unico_tamano_bytes BIGINT;

ALTER TABLE backups
  ADD COLUMN IF NOT EXISTS archivo_unico_sha256 VARCHAR;

ALTER TABLE backups
  ADD COLUMN IF NOT EXISTS contenido_incluido JSONB;

-- ---------------------------------------------------------------------------
-- 3) notificaciones — agregar tipos nuevos manteniendo los existentes
-- ---------------------------------------------------------------------------
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
    -- Backups (ya usados sin CHECK, ahora formalizados)
    'BACKUP_FALLIDO',
    'BACKUP_SYNC_FALLIDO',
    -- Nuevos — Fase 1 .crmseg
    'BACKUP_PASSPHRASE_CONFIGURADA',
    'BACKUP_PASSPHRASE_RECOVERY_ENVIADO'
  ));

-- Mismo CHECK en configuracion_notificaciones si existe
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'configuracion_notificaciones'
  ) THEN
    ALTER TABLE configuracion_notificaciones DROP CONSTRAINT IF EXISTS configuracion_notificaciones_tipo_check;
    ALTER TABLE configuracion_notificaciones
      ADD CONSTRAINT configuracion_notificaciones_tipo_check
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
        'BACKUP_PASSPHRASE_RECOVERY_ENVIADO'
      ));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Backfill: marcar todos los backups existentes como formato LEGACY
-- ---------------------------------------------------------------------------
UPDATE backups SET formato = 'LEGACY' WHERE formato IS NULL;
