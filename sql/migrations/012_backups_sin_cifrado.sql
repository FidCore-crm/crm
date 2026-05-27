-- ============================================================================
-- Refactor: eliminar cifrado del sistema de backups
-- ============================================================================
-- Los backups pasan a ser archivos .crmbak (tar.gz sin cifrar).
-- La seguridad recae en permisos Linux + cuenta de Google Drive con 2FA.
-- NO se migran backups existentes: el sistema está en desarrollo.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) configuracion_backups — eliminar todo lo de passphrase
-- ---------------------------------------------------------------------------
ALTER TABLE configuracion_backups DROP COLUMN IF EXISTS passphrase_hash;
ALTER TABLE configuracion_backups DROP COLUMN IF EXISTS passphrase_salt;
ALTER TABLE configuracion_backups DROP COLUMN IF EXISTS passphrase_configurada_en;
ALTER TABLE configuracion_backups DROP COLUMN IF EXISTS passphrase_recovery_email_enviado;
ALTER TABLE configuracion_backups DROP COLUMN IF EXISTS passphrase_recovery_email_fecha;
ALTER TABLE configuracion_backups DROP COLUMN IF EXISTS passphrase_derived_key_encrypted;

-- ---------------------------------------------------------------------------
-- 2) backups — eliminar columnas del formato .crmseg (cifrado)
-- ---------------------------------------------------------------------------
-- archivo_unico_path y archivo_unico_tamano_bytes se mantienen — ahora guardan
-- la ruta al .crmbak. contenido_incluido también se mantiene.
ALTER TABLE backups DROP CONSTRAINT IF EXISTS backups_formato_check;
ALTER TABLE backups DROP COLUMN IF EXISTS formato;
ALTER TABLE backups DROP COLUMN IF EXISTS archivo_unico_sha256;

-- ---------------------------------------------------------------------------
-- 3) notificaciones — eliminar tipos de passphrase
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
    'BACKUP_FALLIDO',
    'BACKUP_SYNC_FALLIDO',
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
        'RESTAURACION_INICIADA','RESTAURACION_COMPLETADA','RESTAURACION_FALLIDA'
      ));
  END IF;
END $$;

-- Eliminar notificaciones huérfanas si hay alguna de los tipos viejos
DELETE FROM notificaciones
WHERE tipo IN ('BACKUP_PASSPHRASE_CONFIGURADA', 'BACKUP_PASSPHRASE_RECOVERY_ENVIADO');

-- ---------------------------------------------------------------------------
-- 4) restauraciones — eliminar estado DESCIFRANDO
-- ---------------------------------------------------------------------------
ALTER TABLE restauraciones DROP CONSTRAINT IF EXISTS restauraciones_estado_check;
ALTER TABLE restauraciones
  ADD CONSTRAINT restauraciones_estado_check
  CHECK (estado IN (
    'PENDIENTE', 'VALIDANDO', 'PRE_BACKUP',
    'EXTRAYENDO', 'RESTAURANDO_DB', 'RESTAURANDO_STORAGE',
    'FINALIZANDO', 'COMPLETADA', 'FALLIDA', 'CANCELADA'
  ));

-- ---------------------------------------------------------------------------
-- 5) Limpieza: sistema en desarrollo, no hay backups reales para preservar
-- ---------------------------------------------------------------------------
TRUNCATE TABLE restauraciones;
TRUNCATE TABLE backups CASCADE;
