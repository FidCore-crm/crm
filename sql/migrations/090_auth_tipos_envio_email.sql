-- Migración 090 — Agregar tipos AUTH_* al CHECK de email_envios.tipo_envio.
--
-- El código del flow de invitaciones, recuperación de password y cambio de
-- email manda emails con tipo_envio AUTH_*. Sin esta migración, esos INSERT
-- a email_envios fallaban con violación del CHECK constraint. Detectado en
-- la auditoría 2026-05-29.

BEGIN;

ALTER TABLE public.email_envios DROP CONSTRAINT IF EXISTS email_envios_tipo_envio_check;

ALTER TABLE public.email_envios ADD CONSTRAINT email_envios_tipo_envio_check CHECK (
  (tipo_envio)::text = ANY ((ARRAY[
    'AUTOMATICO_BIENVENIDA'::character varying,
    'AUTOMATICO_RENOVACION'::character varying,
    'AUTOMATICO_PORTAL_CLIENTE'::character varying,
    'MANUAL'::character varying,
    'MASIVO'::character varying,
    'NOTIFICACION_INTERNA'::character varying,
    'SISTEMA_BACKUP_COMPLETADO'::character varying,
    'SISTEMA_BACKUP_FALLIDO'::character varying,
    'SISTEMA_BACKUP_SYNC_FALLIDO'::character varying,
    'SISTEMA_RESTAURACION_INICIADA'::character varying,
    'SISTEMA_RESTAURACION_COMPLETADA'::character varying,
    'SISTEMA_RESTAURACION_FALLIDA'::character varying,
    'SISTEMA_PDF_PROCESADO'::character varying,
    'SISTEMA_PDF_FALLIDO'::character varying,
    'SISTEMA_EMAIL_AUTOMATICO_FALLIDO'::character varying,
    'SISTEMA_ERROR_CRITICO'::character varying,
    'SISTEMA_SUGERENCIA_CORRECCION_PORTAL'::character varying,
    'SISTEMA_SOLICITUD_BLANQUEO_PASSWORD'::character varying,
    'SISTEMA_BLANQUEO_ADMIN_CONFIRMACION'::character varying,
    'AUTH_RECUPERAR_PASSWORD'::character varying,
    'AUTH_INVITACION_USUARIO'::character varying,
    'AUTH_CONFIRMACION_EMAIL'::character varying
  ])::text[])
);

COMMIT;
