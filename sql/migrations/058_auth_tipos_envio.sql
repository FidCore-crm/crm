-- Migración 058: Tipos de envío de email para flows de auth
--
-- Amplía el CHECK constraint de email_envios.tipo_envio para incluir:
--   - AUTH_RECUPERAR_PASSWORD  (#86)
--   - AUTH_INVITACION_USUARIO  (#87)
--   - AUTH_MAGIC_LINK          (#75)
--   - AUTH_CONFIRMACION_EMAIL  (#85)
--
-- También limpia el tipo legacy SISTEMA_TEST_SMTP que no estaba en el constraint
-- pero sí en el TS (se usa solo para testing, no se persiste).

BEGIN;

ALTER TABLE email_envios DROP CONSTRAINT IF EXISTS email_envios_tipo_envio_check;

ALTER TABLE email_envios ADD CONSTRAINT email_envios_tipo_envio_check CHECK (
  tipo_envio IN (
    -- Comunicaciones a clientes
    'AUTOMATICO_BIENVENIDA',
    'AUTOMATICO_RENOVACION',
    'AUTOMATICO_PORTAL_CLIENTE',
    'MANUAL',
    'MASIVO',
    'NOTIFICACION_INTERNA',
    -- Notificaciones al admin por eventos del sistema
    'SISTEMA_BACKUP_COMPLETADO',
    'SISTEMA_BACKUP_FALLIDO',
    'SISTEMA_BACKUP_SYNC_FALLIDO',
    'SISTEMA_RESTAURACION_INICIADA',
    'SISTEMA_RESTAURACION_COMPLETADA',
    'SISTEMA_RESTAURACION_FALLIDA',
    'SISTEMA_PDF_PROCESADO',
    'SISTEMA_PDF_FALLIDO',
    'SISTEMA_EMAIL_AUTOMATICO_FALLIDO',
    'SISTEMA_ERROR_CRITICO',
    'SISTEMA_SUGERENCIA_CORRECCION_PORTAL',
    'SISTEMA_SOLICITUD_BLANQUEO_PASSWORD',
    'SISTEMA_BLANQUEO_ADMIN_CONFIRMACION',
    -- Auth (#74-87 Supabase Auth)
    'AUTH_RECUPERAR_PASSWORD',
    'AUTH_INVITACION_USUARIO',
    'AUTH_MAGIC_LINK',
    'AUTH_CONFIRMACION_EMAIL'
  )
);

COMMIT;
