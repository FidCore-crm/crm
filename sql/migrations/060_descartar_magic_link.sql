-- Migración 060: descartar magic link
--
-- Magic link fue implementado en C.4 (#75 parte) pero descartado tras
-- evaluación de UX. Razones (ver memory/decision_no_magic_link.md):
--   - El password reset (#86) ya cubre "olvidé mi contraseña"
--   - El blanqueo de admin sigue disponible como fallback
--   - Para 1-3 usuarios estables que conocen su password, magic link no
--     resuelve un problema concreto, solo agrega un toggle confuso
--   - Si SMTP no está configurado, parece roto
--
-- Esta migración elimina la plantilla de email y el tipo de envío.
-- Los endpoints y páginas relacionados se eliminaron del código fuente.

BEGIN;

-- 1. Eliminar plantilla de email
DELETE FROM plantillas_email WHERE codigo = 'auth_magic_link';

-- 2. Recrear CHECK constraint de email_envios.tipo_envio SIN AUTH_MAGIC_LINK
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
    -- Notificaciones al admin
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
    -- Auth (Supabase Auth)
    'AUTH_RECUPERAR_PASSWORD',
    'AUTH_INVITACION_USUARIO',
    'AUTH_CONFIRMACION_EMAIL'
    -- AUTH_MAGIC_LINK eliminado en esta migración
  )
);

COMMIT;
