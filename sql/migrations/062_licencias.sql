-- 062_licencias.sql
-- Sistema de licencias Ed25519 offline.
--
-- Una licencia es un archivo .lic firmado por la llave privada de Nahuel.
-- El CRM verifica con la llave pública embebida en el código.
-- Soporta: licencia activa + múltiples encoladas (renovación anticipada).

BEGIN;

CREATE TABLE IF NOT EXISTS licencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Datos firmados (parseados del JSON .lic, son una copia para queries)
  cliente VARCHAR(200) NOT NULL,
  razon_social VARCHAR(200),
  instalacion_id UUID NOT NULL,
  plan VARCHAR(20) NOT NULL CHECK (plan IN ('MENSUAL', 'SEMESTRAL', 'ANUAL', 'PERMANENTE')),
  fecha_inicio DATE NOT NULL,
  fecha_vencimiento DATE NOT NULL,
  fecha_emision DATE NOT NULL,
  notas TEXT,

  -- Datos crudos para re-verificar la firma cuando haga falta
  payload_completo JSONB NOT NULL,
  firma TEXT NOT NULL,

  -- Estado de la licencia dentro de la cola
  -- ACTIVA: la que está rigiendo ahora (solo una a la vez)
  -- ENCOLADA: cargada por anticipado, todavía no empezó su vigencia
  -- EXPIRADA: ya pasó su fecha_vencimiento
  -- REEMPLAZADA: la dejaron de lado al cargar una nueva más reciente
  estado VARCHAR(20) NOT NULL DEFAULT 'ENCOLADA'
    CHECK (estado IN ('ACTIVA', 'ENCOLADA', 'EXPIRADA', 'REEMPLAZADA')),

  -- Auditoría
  cargada_por_usuario_id UUID REFERENCES usuarios_perfil(id) ON DELETE SET NULL,
  fecha_carga TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT licencias_fechas_coherentes CHECK (fecha_vencimiento >= fecha_inicio)
);

-- Solo puede haber UNA licencia ACTIVA a la vez (índice parcial único)
CREATE UNIQUE INDEX IF NOT EXISTS idx_licencias_solo_una_activa
  ON licencias (estado)
  WHERE estado = 'ACTIVA';

-- Para queries del cron de rotación
CREATE INDEX IF NOT EXISTS idx_licencias_encoladas_por_inicio
  ON licencias (fecha_inicio)
  WHERE estado = 'ENCOLADA';

-- Para mostrar histórico ordenado
CREATE INDEX IF NOT EXISTS idx_licencias_fecha_carga
  ON licencias (fecha_carga DESC);

-- RLS: solo admin lee/escribe (la licencia es info global, no por cartera)
ALTER TABLE licencias ENABLE ROW LEVEL SECURITY;

CREATE POLICY licencias_select_admin ON licencias
  FOR SELECT TO authenticated
  USING (fn_es_admin_actual());

CREATE POLICY licencias_insert_admin ON licencias
  FOR INSERT TO authenticated
  WITH CHECK (fn_es_admin_actual());

CREATE POLICY licencias_update_admin ON licencias
  FOR UPDATE TO authenticated
  USING (fn_es_admin_actual())
  WITH CHECK (fn_es_admin_actual());

CREATE POLICY licencias_delete_admin ON licencias
  FOR DELETE TO authenticated
  USING (fn_es_admin_actual());

COMMENT ON TABLE licencias IS 'Licencias .lic firmadas con Ed25519. Una ACTIVA + N ENCOLADAS para renovación anticipada.';

-- Tipos nuevos de notificación para el escalonamiento de avisos
ALTER TABLE notificaciones
  DROP CONSTRAINT IF EXISTS notificaciones_tipo_check;

ALTER TABLE notificaciones
  ADD CONSTRAINT notificaciones_tipo_check
  CHECK (tipo IN (
    'POLIZA_VENCIDA', 'TAREA_VENCIDA', 'SINIESTRO_30_DIAS', 'SINIESTRO_60_DIAS',
    'COTIZACION_SIN_RESPUESTA', 'COTIZACION_SIN_SEGUIMIENTO', 'OPORTUNIDAD_ESTANCADA',
    'COTIZACION_VENCIENDO_PRONTO', 'COTIZACION_VENCIDA',
    'POLIZA_REHABILITADA',
    'PDF_LISTO_PARA_REVISAR', 'PDF_FALLIDO',
    'BACKUP_FALLIDO', 'BACKUP_SYNC_FALLIDO',
    'RESTAURACION_INICIADA', 'RESTAURACION_COMPLETADA', 'RESTAURACION_FALLIDA',
    'IMPORTACION_INICIADA', 'IMPORTACION_ANALIZADA', 'IMPORTACION_LISTA_REVISION',
    'IMPORTACION_COMPLETADA', 'IMPORTACION_FALLIDA', 'IMPORTACION_PAUSADA',
    'IMPORTACION_DESHECHA',
    'EMAIL_AUTOMATICO_FALLIDO',
    'SINIESTRO_DENUNCIA_PUBLICA',
    'SOLICITUD_BLANQUEO_PASSWORD', 'BLANQUEO_ABUSO_DETECTADO',
    'LICENCIA_POR_VENCER', 'LICENCIA_VENCIDA', 'LICENCIA_EN_GRACIA', 'LICENCIA_BLOQUEADA',
    'LICENCIA_CARGADA', 'LICENCIA_PROMOVIDA'
  ));

ALTER TABLE configuracion_notificaciones
  DROP CONSTRAINT IF EXISTS configuracion_notificaciones_tipo_check;

ALTER TABLE configuracion_notificaciones
  ADD CONSTRAINT configuracion_notificaciones_tipo_check
  CHECK (tipo IN (
    'POLIZA_VENCIDA', 'TAREA_VENCIDA', 'SINIESTRO_30_DIAS', 'SINIESTRO_60_DIAS',
    'COTIZACION_SIN_RESPUESTA', 'COTIZACION_SIN_SEGUIMIENTO', 'OPORTUNIDAD_ESTANCADA',
    'COTIZACION_VENCIENDO_PRONTO', 'COTIZACION_VENCIDA',
    'POLIZA_REHABILITADA',
    'PDF_LISTO_PARA_REVISAR', 'PDF_FALLIDO',
    'BACKUP_FALLIDO', 'BACKUP_SYNC_FALLIDO',
    'RESTAURACION_INICIADA', 'RESTAURACION_COMPLETADA', 'RESTAURACION_FALLIDA',
    'IMPORTACION_INICIADA', 'IMPORTACION_ANALIZADA', 'IMPORTACION_LISTA_REVISION',
    'IMPORTACION_COMPLETADA', 'IMPORTACION_FALLIDA', 'IMPORTACION_PAUSADA',
    'IMPORTACION_DESHECHA',
    'EMAIL_AUTOMATICO_FALLIDO',
    'SINIESTRO_DENUNCIA_PUBLICA',
    'SOLICITUD_BLANQUEO_PASSWORD', 'BLANQUEO_ABUSO_DETECTADO',
    'LICENCIA_POR_VENCER', 'LICENCIA_VENCIDA', 'LICENCIA_EN_GRACIA', 'LICENCIA_BLOQUEADA',
    'LICENCIA_CARGADA', 'LICENCIA_PROMOVIDA'
  ));

-- Tipos nuevos de email del sistema (para que el admin reciba avisos por email)
ALTER TABLE email_envios
  DROP CONSTRAINT IF EXISTS email_envios_tipo_envio_check;

ALTER TABLE email_envios
  ADD CONSTRAINT email_envios_tipo_envio_check
  CHECK (tipo_envio IN (
    'AUTOMATICO_BIENVENIDA', 'AUTOMATICO_RENOVACION', 'AUTOMATICO_PORTAL_CLIENTE',
    'MANUAL', 'MASIVO', 'NOTIFICACION_INTERNA',
    'SISTEMA_BACKUP_COMPLETADO', 'SISTEMA_BACKUP_FALLIDO', 'SISTEMA_BACKUP_SYNC_FALLIDO',
    'SISTEMA_RESTAURACION_INICIADA', 'SISTEMA_RESTAURACION_COMPLETADA', 'SISTEMA_RESTAURACION_FALLIDA',
    'SISTEMA_PDF_PROCESADO', 'SISTEMA_PDF_FALLIDO', 'SISTEMA_EMAIL_AUTOMATICO_FALLIDO',
    'SISTEMA_ERROR_CRITICO',
    'SISTEMA_SUGERENCIA_CORRECCION_PORTAL',
    'SISTEMA_SOLICITUD_BLANQUEO_PASSWORD', 'SISTEMA_BLANQUEO_ADMIN_CONFIRMACION',
    'AUTH_RECUPERAR_PASSWORD', 'AUTH_INVITACION_USUARIO', 'AUTH_CONFIRMACION_EMAIL',
    'SISTEMA_LICENCIA_POR_VENCER', 'SISTEMA_LICENCIA_VENCIDA',
    'SISTEMA_LICENCIA_EN_GRACIA', 'SISTEMA_LICENCIA_BLOQUEADA'
  ));

-- Plantillas de email del sistema para avisos de licencia
INSERT INTO plantillas_email (codigo, contexto, nombre, descripcion, asunto, saludo, cuerpo, cierre,
  asunto_default, saludo_default, cuerpo_default, cierre_default,
  es_sistema, editable, activa)
VALUES
  (
    'sistema_licencia_por_vencer',
    'GENERAL',
    'Aviso: licencia por vencer',
    'Se envía al admin cuando faltan 30, 15 o 7 días para que venza la licencia.',
    'Tu licencia Pulzar vence en {{dias_restantes}} días',
    'Hola {{nombre_admin}},',
    'Tu licencia Pulzar plan {{plan}} vence el {{fecha_vencimiento}} ({{dias_restantes}} días restantes).' || E'\n\n' ||
    'Para evitar interrupciones, contactá a tu proveedor para renovar antes del vencimiento. Cuando recibas la nueva licencia, podés cargarla desde Configuración → Licencia incluso ahora mismo: el sistema la activará automáticamente cuando venza la actual.',
    'Equipo Pulzar',
    'Tu licencia Pulzar vence en {{dias_restantes}} días',
    'Hola {{nombre_admin}},',
    'Tu licencia Pulzar plan {{plan}} vence el {{fecha_vencimiento}} ({{dias_restantes}} días restantes).' || E'\n\n' ||
    'Para evitar interrupciones, contactá a tu proveedor para renovar antes del vencimiento. Cuando recibas la nueva licencia, podés cargarla desde Configuración → Licencia incluso ahora mismo: el sistema la activará automáticamente cuando venza la actual.',
    'Equipo Pulzar',
    true, true, true
  ),
  (
    'sistema_licencia_en_gracia',
    'GENERAL',
    'Aviso: licencia vencida — período de gracia',
    'Se envía al admin cuando la licencia venció y entró en período de gracia (7 días).',
    'Tu licencia Pulzar venció — quedan {{dias_gracia}} días de gracia',
    'Hola {{nombre_admin}},',
    'Tu licencia Pulzar venció el {{fecha_vencimiento}}. El sistema sigue funcionando con normalidad durante los próximos {{dias_gracia}} días para que tengas tiempo de renovar.' || E'\n\n' ||
    'Si no cargás una licencia válida antes del {{fecha_bloqueo}}, el CRM pasa a modo solo lectura: podrás consultar personas, pólizas y siniestros, pero no editar ni crear nada nuevo.',
    'Equipo Pulzar',
    'Tu licencia Pulzar venció — quedan {{dias_gracia}} días de gracia',
    'Hola {{nombre_admin}},',
    'Tu licencia Pulzar venció el {{fecha_vencimiento}}. El sistema sigue funcionando con normalidad durante los próximos {{dias_gracia}} días para que tengas tiempo de renovar.' || E'\n\n' ||
    'Si no cargás una licencia válida antes del {{fecha_bloqueo}}, el CRM pasa a modo solo lectura: podrás consultar personas, pólizas y siniestros, pero no editar ni crear nada nuevo.',
    'Equipo Pulzar',
    true, true, true
  ),
  (
    'sistema_licencia_bloqueada',
    'GENERAL',
    'Aviso: licencia bloqueada — modo solo lectura',
    'Se envía al admin cuando se agotó el período de gracia y el CRM entró en modo solo lectura.',
    'Tu Pulzar quedó en modo solo lectura',
    'Hola {{nombre_admin}},',
    'El período de gracia terminó. Tu Pulzar ahora está en modo solo lectura: podés consultar personas, pólizas y siniestros, pero no crear ni editar nada nuevo.' || E'\n\n' ||
    'Para reactivar el sistema completo, cargá una licencia válida desde Configuración → Licencia. Apenas la subas, todas las funciones se desbloquean al instante.',
    'Equipo Pulzar',
    'Tu Pulzar quedó en modo solo lectura',
    'Hola {{nombre_admin}},',
    'El período de gracia terminó. Tu Pulzar ahora está en modo solo lectura: podés consultar personas, pólizas y siniestros, pero no crear ni editar nada nuevo.' || E'\n\n' ||
    'Para reactivar el sistema completo, cargá una licencia válida desde Configuración → Licencia. Apenas la subas, todas las funciones se desbloquean al instante.',
    'Equipo Pulzar',
    true, true, true
  )
ON CONFLICT (codigo) DO NOTHING;

COMMIT;
