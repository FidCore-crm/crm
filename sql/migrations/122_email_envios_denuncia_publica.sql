-- ============================================================
-- 122 — Agregar tipos SINIESTRO_DENUNCIA_CLIENTE / _PAS al CHECK de email_envios
-- ============================================================
-- Cuando el cliente envía una denuncia de siniestro desde el formulario público
-- (/denuncia), el CRM manda un email de confirmación al cliente + un aviso al
-- PAS con los datos + PDF adjunto. Estos envíos van directo con `enviarEmail()`
-- (fuera de la cola porque son transaccionales inmediatos), pero desde v1.0.98
-- se registran post-hoc en `email_envios` para tener tracking + auditoría.
--
-- Esta migración amplía el CHECK constraint para aceptar los 2 nuevos
-- valores. Solo agrega; no borra ningún tipo previo.
-- ============================================================

ALTER TABLE public.email_envios
  DROP CONSTRAINT IF EXISTS email_envios_tipo_envio_check;

ALTER TABLE public.email_envios
  ADD CONSTRAINT email_envios_tipo_envio_check CHECK (
    tipo_envio IN (
      'AUTOMATICO_BIENVENIDA',
      'AUTOMATICO_BIENVENIDA_CLIENTE',
      'AUTOMATICO_RENOVACION',
      'AUTOMATICO_PORTAL_CLIENTE',
      'MANUAL',
      'MASIVO',
      'NOTIFICACION_INTERNA',
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
      'SISTEMA_LICENCIA_POR_VENCER',
      'SISTEMA_LICENCIA_VENCIDA',
      'SISTEMA_LICENCIA_EN_GRACIA',
      'SISTEMA_LICENCIA_BLOQUEADA',
      'SISTEMA_ROLLBACK_UPDATE',
      'SISTEMA_LEAD_WEB_RECIBIDO',
      'AUTH_RECUPERAR_PASSWORD',
      'AUTH_INVITACION_USUARIO',
      'AUTH_CONFIRMACION_EMAIL',
      -- Nuevos en v1.0.98: registro post-hoc de denuncias públicas.
      'SINIESTRO_DENUNCIA_CLIENTE',
      'SINIESTRO_DENUNCIA_PAS'
    )
  );
