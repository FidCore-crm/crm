-- ============================================================================
-- Migración 045 — Solicitudes de blanqueo de contraseña
--
-- Sistema de recuperación de contraseña para usuarios y admins.
--
-- Flujo:
--   1) Usuario común olvida pass → desde el login crea solicitud PENDIENTE.
--      Login queda bloqueado hasta que el admin habilite o rechace. Al
--      habilitar, la solicitud pasa a HABILITADA y el usuario, en su próximo
--      intento de login, ve directamente el modal "definí nueva contraseña".
--   2) Admin olvida pass → mismo flujo, pero como NO hay otro admin que
--      apruebe, se le manda un email con un token de confirmación al SMTP del
--      CRM (su propia casilla). Al hacer click, su solicitud pasa a HABILITADA.
--      Después define la nueva pass desde el login como cualquier user.
--
-- Estados:
--   PENDIENTE   - solicitud creada, esperando aprobación (admin manual o admin
--                 confirmando su propio email)
--   HABILITADA  - aprobada, el user puede definir su nueva contraseña
--   CONSUMIDA   - el user ya definió la nueva pass
--   RECHAZADA   - admin rechazó (libera el login con la pass vieja)
--   EXPIRADA    - quedó vieja sin atender (cron de limpieza)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Tabla principal
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS solicitudes_blanqueo_password (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',

  -- Token solo para auto-confirmación de admins (su propio reset).
  -- Es un hash SHA-256 del token plano enviado por email.
  -- Para users comunes este campo es NULL: el admin habilita desde la UI
  -- sin necesidad de token.
  token_hash VARCHAR(128) NULL,
  token_expira_at TIMESTAMPTZ NULL,

  -- Auditoría / metadata
  ip_origen INET NULL,
  user_agent TEXT NULL,
  habilitada_por_admin_id UUID NULL REFERENCES usuarios(id) ON DELETE SET NULL,
  fecha_habilitacion TIMESTAMPTZ NULL,
  fecha_consumo TIMESTAMPTZ NULL,
  fecha_rechazo TIMESTAMPTZ NULL,
  motivo_rechazo TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT solicitudes_blanqueo_estado_check CHECK (
    estado IN ('PENDIENTE', 'HABILITADA', 'CONSUMIDA', 'RECHAZADA', 'EXPIRADA')
  )
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_blanqueo_usuario
  ON solicitudes_blanqueo_password (usuario_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_solicitudes_blanqueo_pendientes
  ON solicitudes_blanqueo_password (created_at DESC)
  WHERE estado = 'PENDIENTE';

CREATE INDEX IF NOT EXISTS idx_solicitudes_blanqueo_habilitadas
  ON solicitudes_blanqueo_password (usuario_id, fecha_habilitacion DESC)
  WHERE estado = 'HABILITADA';

-- Solo puede haber UNA solicitud activa (PENDIENTE o HABILITADA) por usuario.
-- Esto fuerza que para crear una nueva primero se cierre la anterior.
CREATE UNIQUE INDEX IF NOT EXISTS idx_solicitudes_blanqueo_unica_activa
  ON solicitudes_blanqueo_password (usuario_id)
  WHERE estado IN ('PENDIENTE', 'HABILITADA');

-- Lookup rápido por token_hash para el endpoint de confirmación admin.
CREATE INDEX IF NOT EXISTS idx_solicitudes_blanqueo_token_hash
  ON solicitudes_blanqueo_password (token_hash)
  WHERE token_hash IS NOT NULL;

-- RLS: bloqueado por completo. Todo se opera vía service_role en API routes.
ALTER TABLE solicitudes_blanqueo_password ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2) Tipos de notificación nuevos
-- ----------------------------------------------------------------------------
ALTER TABLE notificaciones DROP CONSTRAINT IF EXISTS notificaciones_tipo_check;
ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_tipo_check CHECK (
  (tipo)::text = ANY (ARRAY[
    'POLIZA_VENCIDA','TAREA_VENCIDA','SINIESTRO_30_DIAS','SINIESTRO_60_DIAS',
    'COTIZACION_SIN_RESPUESTA','COTIZACION_SIN_SEGUIMIENTO','OPORTUNIDAD_ESTANCADA',
    'COTIZACION_VENCIENDO_PRONTO','COTIZACION_VENCIDA',
    'IMPORTACION_INICIADA','IMPORTACION_ANALIZADA','IMPORTACION_LISTA_REVISION',
    'IMPORTACION_COMPLETADA','IMPORTACION_FALLIDA','IMPORTACION_PAUSADA','IMPORTACION_DESHECHA',
    'PDF_LISTO_PARA_REVISAR','PDF_FALLIDO','POLIZA_REHABILITADA',
    'BACKUP_FALLIDO','BACKUP_SYNC_FALLIDO',
    'RESTAURACION_INICIADA','RESTAURACION_COMPLETADA','RESTAURACION_FALLIDA',
    'EMAIL_AUTOMATICO_FALLIDO','SINIESTRO_DENUNCIA_PUBLICA',
    'SOLICITUD_BLANQUEO_PASSWORD','BLANQUEO_ABUSO_DETECTADO'
  ]::varchar[])
);

ALTER TABLE configuracion_notificaciones DROP CONSTRAINT IF EXISTS configuracion_notificaciones_tipo_check;
ALTER TABLE configuracion_notificaciones ADD CONSTRAINT configuracion_notificaciones_tipo_check CHECK (
  (tipo)::text = ANY (ARRAY[
    'POLIZA_VENCIDA','TAREA_VENCIDA','SINIESTRO_30_DIAS','SINIESTRO_60_DIAS',
    'COTIZACION_SIN_RESPUESTA','COTIZACION_SIN_SEGUIMIENTO','OPORTUNIDAD_ESTANCADA',
    'COTIZACION_VENCIENDO_PRONTO','COTIZACION_VENCIDA',
    'IMPORTACION_INICIADA','IMPORTACION_ANALIZADA','IMPORTACION_LISTA_REVISION',
    'IMPORTACION_COMPLETADA','IMPORTACION_FALLIDA','IMPORTACION_PAUSADA','IMPORTACION_DESHECHA',
    'PDF_LISTO_PARA_REVISAR','PDF_FALLIDO','POLIZA_REHABILITADA',
    'BACKUP_FALLIDO','BACKUP_SYNC_FALLIDO',
    'RESTAURACION_INICIADA','RESTAURACION_COMPLETADA','RESTAURACION_FALLIDA',
    'EMAIL_AUTOMATICO_FALLIDO','SINIESTRO_DENUNCIA_PUBLICA',
    'SOLICITUD_BLANQUEO_PASSWORD','BLANQUEO_ABUSO_DETECTADO'
  ]::varchar[])
);

-- ----------------------------------------------------------------------------
-- 3) Tipos de envío de email nuevos
-- ----------------------------------------------------------------------------
ALTER TABLE email_envios DROP CONSTRAINT IF EXISTS email_envios_tipo_envio_check;
ALTER TABLE email_envios ADD CONSTRAINT email_envios_tipo_envio_check CHECK (
  (tipo_envio)::text = ANY (ARRAY[
    'AUTOMATICO_BIENVENIDA','AUTOMATICO_RENOVACION','AUTOMATICO_PORTAL_CLIENTE',
    'MANUAL','MASIVO','NOTIFICACION_INTERNA',
    'SISTEMA_BACKUP_COMPLETADO','SISTEMA_BACKUP_FALLIDO','SISTEMA_BACKUP_SYNC_FALLIDO',
    'SISTEMA_RESTAURACION_INICIADA','SISTEMA_RESTAURACION_COMPLETADA','SISTEMA_RESTAURACION_FALLIDA',
    'SISTEMA_PDF_PROCESADO','SISTEMA_PDF_FALLIDO',
    'SISTEMA_EMAIL_AUTOMATICO_FALLIDO','SISTEMA_ERROR_CRITICO',
    'SISTEMA_SUGERENCIA_CORRECCION_PORTAL',
    'SISTEMA_SOLICITUD_BLANQUEO_PASSWORD','SISTEMA_BLANQUEO_ADMIN_CONFIRMACION'
  ]::varchar[])
);

-- ----------------------------------------------------------------------------
-- 4) Plantillas de email
-- ----------------------------------------------------------------------------
INSERT INTO plantillas_email (
  codigo, nombre, descripcion, contexto,
  asunto, saludo, cuerpo, cierre,
  asunto_default, saludo_default, cuerpo_default, cierre_default,
  variables_disponibles, es_sistema, editable
)
VALUES
-- Plantilla 1: aviso al admin de que un usuario solicitó blanqueo
(
  'sistema_solicitud_blanqueo_password',
  'Solicitud de blanqueo de contraseña',
  'Aviso al administrador cuando un usuario solicita blanqueo de su contraseña. Editable.',
  'GENERAL',
  'Solicitud de blanqueo de contraseña — {{usuario_nombre_completo}}',
  'Hola {{nombre_admin}},',
  'El usuario {{usuario_nombre_completo}} ({{usuario_email}}) acaba de solicitar el blanqueo de su contraseña.

Si reconocés esta solicitud y querés permitir que defina una nueva contraseña, andá a la sección de Usuarios del CRM y hacé click en "Habilitar blanqueo" sobre la fila del usuario. Una vez habilitado, el usuario va a poder definir su nueva contraseña la próxima vez que entre al login.

Si no reconocés la solicitud, podés rechazarla desde la misma pantalla.

Información de la solicitud:
- Usuario: {{usuario_nombre_completo}}
- Email: {{usuario_email}}
- Fecha: {{fecha_solicitud}}
- IP: {{ip_origen}}',
  'Saludos,
{{productora_nombre}}',
  'Solicitud de blanqueo de contraseña — {{usuario_nombre_completo}}',
  'Hola {{nombre_admin}},',
  'El usuario {{usuario_nombre_completo}} ({{usuario_email}}) acaba de solicitar el blanqueo de su contraseña.

Si reconocés esta solicitud y querés permitir que defina una nueva contraseña, andá a la sección de Usuarios del CRM y hacé click en "Habilitar blanqueo" sobre la fila del usuario. Una vez habilitado, el usuario va a poder definir su nueva contraseña la próxima vez que entre al login.

Si no reconocés la solicitud, podés rechazarla desde la misma pantalla.

Información de la solicitud:
- Usuario: {{usuario_nombre_completo}}
- Email: {{usuario_email}}
- Fecha: {{fecha_solicitud}}
- IP: {{ip_origen}}',
  'Saludos,
{{productora_nombre}}',
  ARRAY['nombre_admin','usuario_nombre_completo','usuario_email','fecha_solicitud','ip_origen','productora_nombre']::text[],
  true, true
),
-- Plantilla 2: link de auto-confirmación cuando el admin pide su propio reset
(
  'sistema_blanqueo_admin_confirmacion',
  'Confirmación de blanqueo de admin',
  'Email enviado al admin cuando solicita blanqueo de su propia contraseña. Contiene un link de un solo uso para confirmar la solicitud y habilitar el reset.',
  'GENERAL',
  'Confirmá el blanqueo de tu contraseña',
  'Hola {{nombre_admin}},',
  'Recibimos una solicitud para blanquear la contraseña de tu cuenta de administrador en el CRM.

Si fuiste vos, hacé click en el siguiente link para confirmar la solicitud. El link es de un solo uso y vence en 24 horas:

{{url_confirmacion}}

Una vez confirmado, vas a poder definir tu nueva contraseña desde la pantalla de login del CRM.

Si NO fuiste vos quien solicitó este blanqueo, ignorá este email. La solicitud va a quedar pendiente y vas a poder seguir usando tu contraseña actual sin problemas.

Datos de la solicitud:
- Fecha: {{fecha_solicitud}}
- IP: {{ip_origen}}',
  'Saludos,
{{productora_nombre}}',
  'Confirmá el blanqueo de tu contraseña',
  'Hola {{nombre_admin}},',
  'Recibimos una solicitud para blanquear la contraseña de tu cuenta de administrador en el CRM.

Si fuiste vos, hacé click en el siguiente link para confirmar la solicitud. El link es de un solo uso y vence en 24 horas:

{{url_confirmacion}}

Una vez confirmado, vas a poder definir tu nueva contraseña desde la pantalla de login del CRM.

Si NO fuiste vos quien solicitó este blanqueo, ignorá este email. La solicitud va a quedar pendiente y vas a poder seguir usando tu contraseña actual sin problemas.

Datos de la solicitud:
- Fecha: {{fecha_solicitud}}
- IP: {{ip_origen}}',
  'Saludos,
{{productora_nombre}}',
  ARRAY['nombre_admin','url_confirmacion','fecha_solicitud','ip_origen','productora_nombre']::text[],
  true, true
)
ON CONFLICT (codigo) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 5) Marcar migración como aplicada (para el script de migraciones idempotente)
-- ----------------------------------------------------------------------------
INSERT INTO public.migraciones_aplicadas (nombre)
VALUES ('045_solicitudes_blanqueo_password.sql')
ON CONFLICT (nombre) DO NOTHING;
