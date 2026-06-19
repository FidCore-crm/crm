-- ============================================================
-- 092 — Notificación de rollback automático del updater
-- ============================================================
-- Cuando un update del CRM falla y el script aplicar-actualizacion.sh
-- dispara rollback automático, hasta ahora NO se notificaba al admin.
-- Quedaba solo en cron.log que nadie mira. Resultado: el admin podía
-- enterarse días después por casualidad (ej: una carpeta storage.pre-restore
-- en disco).
--
-- Esta migración:
-- 1. Amplía el CHECK de email_envios.tipo_envio para aceptar
--    SISTEMA_ROLLBACK_UPDATE.
-- 2. Crea la plantilla 'sistema_rollback_update' editable por el admin.
--
-- El endpoint /api/sistema/notificar-rollback (TS) recibe el aviso desde
-- el bash y llama encolarEmailSistema('ROLLBACK_UPDATE', { ... }).
-- ============================================================

BEGIN;

-- 1) CHECK ampliado (preservando todos los valores previos)
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
    'SISTEMA_LICENCIA_POR_VENCER'::character varying,
    'SISTEMA_LICENCIA_VENCIDA'::character varying,
    'SISTEMA_LICENCIA_EN_GRACIA'::character varying,
    'SISTEMA_LICENCIA_BLOQUEADA'::character varying,
    'AUTH_RECUPERAR_PASSWORD'::character varying,
    'AUTH_INVITACION_USUARIO'::character varying,
    'AUTH_CONFIRMACION_EMAIL'::character varying,
    'SISTEMA_ROLLBACK_UPDATE'::character varying
  ])::text[])
);

-- 2) Plantilla editable (idempotente: solo inserta si no existe)
DO $$
DECLARE
  v_codigo       text := 'sistema_rollback_update';
  v_nombre       text := 'Rollback automático del update';
  v_descripcion  text := 'Notificación crítica al admin cuando una actualización del CRM falla y el sistema vuelve atrás automáticamente.';
  v_asunto       text := '⚠ Update FALLIDO — el CRM volvió a la versión {{version_actual}}';
  v_saludo       text := 'Hola {{nombre_admin}}!';
  v_cuerpo       text := 'La actualización a la versión {{version_intentada}} falló y el sistema activó el rollback automático.

Resultado del rollback: {{resultado_rollback}}
Motivo del fallo: {{motivo_fallo}}
Versión actual: {{version_actual}}

El CRM sigue accesible. Tus datos están a salvo: el rollback usa el backup pre-update creado al inicio del proceso.

Recomendaciones:
- Revisá el log completo de la actualización desde Configuración → Actualizaciones.
- Si el rollback fue exitoso, podés esperar a una versión posterior antes de reintentar.
- Si el rollback INCOMPLETO, contactá a soporte técnico cuanto antes.';
  v_cierre       text := 'Saludos,
Sistema de actualizaciones FidCore';
  v_variables    text[] := ARRAY[
    'nombre_admin', 'version_intentada', 'version_actual',
    'motivo_fallo', 'resultado_rollback', 'fecha_evento'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.plantillas_email WHERE codigo = v_codigo) THEN
    INSERT INTO public.plantillas_email
      (codigo, nombre, descripcion, contexto,
       asunto, saludo, cuerpo, cierre,
       asunto_default, saludo_default, cuerpo_default, cierre_default,
       variables_disponibles, activa, es_sistema, editable)
    VALUES
      (v_codigo, v_nombre, v_descripcion, 'GENERAL',
       v_asunto, v_saludo, v_cuerpo, v_cierre,
       v_asunto, v_saludo, v_cuerpo, v_cierre,
       v_variables, true, true, true);
  END IF;
END $$;

COMMIT;
