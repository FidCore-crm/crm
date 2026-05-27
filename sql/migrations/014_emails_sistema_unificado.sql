-- ============================================================================
-- Sistema de emails unificado: prioridad en la cola + plantillas de sistema
-- ============================================================================
--
-- 1) Agrega columna `prioridad` en email_envios (ALTA / NORMAL) y un índice
--    compuesto para que el cron procese primero los críticos.
-- 2) Amplía el CHECK de tipo_envio con los 10 tipos SISTEMA_*.
-- 3) Agrega toggle `notificar_admin_eventos_informativos` en
--    configuracion_comunicaciones (opt-in para emails informativos al admin).
-- 4) Siembra 9 plantillas de sistema (las que no existan ya por código).
--
-- IMPORTANTE — Self-healing:
-- Esta migración asume que algunas instalaciones tienen la tabla
-- `email_envios`, `plantillas_email` y `configuracion_comunicaciones` con un
-- esquema más viejo que el que declara la migración 013 (porque 013 nunca
-- llegó a correr ahí, o porque las tablas se crearon a mano antes de
-- formalizarse). Por eso 014 también agrega defensivamente las columnas que
-- 013 debería haber dejado, hace backfill y reescribe los CHECK constraints
-- a un superset compatible con ambas variantes.
--
-- Idempotente: se puede correr varias veces sin romper nada.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Saneamiento previo de email_envios (campos que 013 podría no haber dejado)
-- ---------------------------------------------------------------------------
ALTER TABLE email_envios
  ADD COLUMN IF NOT EXISTS enviar_despues_de TIMESTAMP WITH TIME ZONE DEFAULT NOW();

ALTER TABLE email_envios
  ADD COLUMN IF NOT EXISTS archivado BOOLEAN NOT NULL DEFAULT false;

-- CHECK de estado: superset que incluye ENCOLADO + los estados viejos
ALTER TABLE email_envios DROP CONSTRAINT IF EXISTS email_envios_estado_check;
ALTER TABLE email_envios
  ADD CONSTRAINT email_envios_estado_check
  CHECK (estado IN (
    'PENDIENTE',
    'ENCOLADO',
    'ENVIANDO',
    'ENVIADO',
    'FALLIDO',
    'EXCLUIDO_BAJA',
    'EXCLUIDO_NO_MARKETING'
  ));

-- ---------------------------------------------------------------------------
-- 2) Prioridad en email_envios
-- ---------------------------------------------------------------------------
ALTER TABLE email_envios
  ADD COLUMN IF NOT EXISTS prioridad VARCHAR NOT NULL DEFAULT 'NORMAL';

ALTER TABLE email_envios DROP CONSTRAINT IF EXISTS email_envios_prioridad_check;
ALTER TABLE email_envios
  ADD CONSTRAINT email_envios_prioridad_check
  CHECK (prioridad IN ('ALTA', 'NORMAL'));

-- Índice de cola priorizada: el cron hace
--   WHERE estado='ENCOLADO' AND enviar_despues_de <= NOW()
--   ORDER BY prioridad DESC, enviar_despues_de ASC, fecha_creacion ASC
CREATE INDEX IF NOT EXISTS idx_email_envios_cola_priorizada
  ON email_envios(prioridad DESC, enviar_despues_de ASC, fecha_creacion ASC)
  WHERE estado = 'ENCOLADO';

-- ---------------------------------------------------------------------------
-- 3) Ampliar CHECK de tipo_envio con los tipos SISTEMA_*
-- ---------------------------------------------------------------------------
-- Hay instalaciones donde sobrevive el constraint viejo `email_envios_tipo_check`
-- (sin _envio_) — lo bajamos también por las dudas.
ALTER TABLE email_envios DROP CONSTRAINT IF EXISTS email_envios_tipo_check;
ALTER TABLE email_envios DROP CONSTRAINT IF EXISTS email_envios_tipo_envio_check;
ALTER TABLE email_envios
  ADD CONSTRAINT email_envios_tipo_envio_check
  CHECK (tipo_envio IN (
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
    'SISTEMA_TEST_SMTP'
  ));

-- ---------------------------------------------------------------------------
-- 4) Saneamiento de configuracion_comunicaciones
-- ---------------------------------------------------------------------------
-- Toggles + retención + delays + adjuntos + opt-in informativos al admin.
-- Todas con default seguro para que las filas existentes queden coherentes.
ALTER TABLE configuracion_comunicaciones
  ADD COLUMN IF NOT EXISTS envio_automatico_bienvenida_poliza BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE configuracion_comunicaciones
  ADD COLUMN IF NOT EXISTS envio_automatico_portal_cliente BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE configuracion_comunicaciones
  ADD COLUMN IF NOT EXISTS delay_entre_envios_automaticos_seg INTEGER NOT NULL DEFAULT 10;
ALTER TABLE configuracion_comunicaciones
  ADD COLUMN IF NOT EXISTS max_adjuntos_mb INTEGER NOT NULL DEFAULT 20;
ALTER TABLE configuracion_comunicaciones
  ADD COLUMN IF NOT EXISTS retener_completo_dias INTEGER NOT NULL DEFAULT 90;
ALTER TABLE configuracion_comunicaciones
  ADD COLUMN IF NOT EXISTS retener_metadata_meses INTEGER NOT NULL DEFAULT 6;
ALTER TABLE configuracion_comunicaciones
  ADD COLUMN IF NOT EXISTS eliminar_despues_meses INTEGER NOT NULL DEFAULT 12;
ALTER TABLE configuracion_comunicaciones
  ADD COLUMN IF NOT EXISTS notificar_admin_eventos_informativos BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 5) Saneamiento de plantillas_email (013 podría no haber dejado las columnas
--    `asunto/saludo/cuerpo/cierre` editables ni los `*_default` ni los flags)
-- ---------------------------------------------------------------------------
-- 4 campos editables (nullable durante backfill, no se fuerzan NOT NULL)
ALTER TABLE plantillas_email ADD COLUMN IF NOT EXISTS asunto VARCHAR;
ALTER TABLE plantillas_email ADD COLUMN IF NOT EXISTS saludo TEXT;
ALTER TABLE plantillas_email ADD COLUMN IF NOT EXISTS cuerpo TEXT;
ALTER TABLE plantillas_email ADD COLUMN IF NOT EXISTS cierre TEXT;

-- Defaults (para el botón "Restaurar default" del editor)
-- `asunto_default` ya existía en versiones viejas. Las otras 3 pueden faltar.
ALTER TABLE plantillas_email ADD COLUMN IF NOT EXISTS saludo_default TEXT;
ALTER TABLE plantillas_email ADD COLUMN IF NOT EXISTS cuerpo_default TEXT;
ALTER TABLE plantillas_email ADD COLUMN IF NOT EXISTS cierre_default TEXT;

-- Flags de comportamiento
ALTER TABLE plantillas_email ADD COLUMN IF NOT EXISTS es_sistema BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE plantillas_email ADD COLUMN IF NOT EXISTS editable BOOLEAN NOT NULL DEFAULT true;

-- Backfill mínimo: las plantillas viejas tenían solo `asunto_default`. Para
-- que no queden `asunto` NULL tras la migración, copiamos el default a la
-- columna editable cuando no haya valor. Saludo/cuerpo/cierre quedan NULL si
-- la plantilla vieja no tenía esa información (el editor las mostrará vacías
-- y el admin puede completarlas si quiere editarla).
UPDATE plantillas_email
   SET asunto = asunto_default
 WHERE asunto IS NULL AND asunto_default IS NOT NULL;

-- CHECK de contexto: superset compatible con ambos vocabularios (el viejo
-- tenía CLIENTE/POLIZA/RENOVACION/GENERAL; el nuevo PERSONA/POLIZA/PORTAL_CLIENTE/GENERAL).
-- Aceptamos los dos.
ALTER TABLE plantillas_email DROP CONSTRAINT IF EXISTS plantillas_contexto_check;
ALTER TABLE plantillas_email DROP CONSTRAINT IF EXISTS plantillas_email_contexto_check;
ALTER TABLE plantillas_email
  ADD CONSTRAINT plantillas_email_contexto_check
  CHECK (contexto IN (
    'PERSONA',
    'POLIZA',
    'PORTAL_CLIENTE',
    'GENERAL',
    -- Vocabulario legacy
    'CLIENTE',
    'RENOVACION'
  ));

-- ---------------------------------------------------------------------------
-- 6) Seed de plantillas de sistema
--    - contexto=GENERAL (no dependen de persona/póliza/portal)
--    - es_sistema=true, editable=true (el admin puede editarlas)
--    - se copian los valores a `*_default` para que el botón "Restaurar
--      default" del editor existente funcione sin cambios.
--    - `variables_disponibles` se setea como text[] (matching el schema real).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_codigo         TEXT;
  v_nombre         TEXT;
  v_descripcion    TEXT;
  v_asunto         TEXT;
  v_saludo         TEXT;
  v_cuerpo         TEXT;
  v_cierre         TEXT;
  v_variables      TEXT[];
BEGIN

  ---- BACKUP_COMPLETADO ---------------------------------------------------
  v_codigo := 'sistema_backup_completado';
  IF NOT EXISTS (SELECT 1 FROM plantillas_email WHERE codigo = v_codigo) THEN
    v_nombre      := 'Backup completado';
    v_descripcion := 'Notificación al admin cuando el backup automático se completa correctamente. (Informativo)';
    v_asunto      := '✓ Backup completado - {{fecha_backup}}';
    v_saludo      := 'Hola {{nombre_admin}}!';
    v_cuerpo      := 'El backup automático de tu CRM se completó correctamente.

Datos del backup:
- Fecha: {{fecha_backup}}
- Tipo: {{tipo_backup}}
- Tamaño: {{tamano_mb}} MB
- Sincronizado a Google Drive: {{sync_status}}

Tus datos están seguros.';
    v_cierre      := 'Saludos,
Sistema CRM Seguros';
    v_variables   := ARRAY['nombre_admin','fecha_backup','tipo_backup','tamano_mb','sync_status']::text[];

    INSERT INTO plantillas_email
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

  ---- BACKUP_FALLIDO ------------------------------------------------------
  v_codigo := 'sistema_backup_fallido';
  IF NOT EXISTS (SELECT 1 FROM plantillas_email WHERE codigo = v_codigo) THEN
    v_nombre      := 'Backup fallido';
    v_descripcion := 'Notificación crítica al admin cuando el backup automático falla. (Crítico)';
    v_asunto      := '⚠ Backup FALLIDO - Acción requerida';
    v_saludo      := 'Hola {{nombre_admin}}!';
    v_cuerpo      := 'El backup automático de tu CRM FALLÓ.

Detalles del error:
- Fecha del intento: {{fecha_intento}}
- Tipo de backup: {{tipo_backup}}
- Mensaje de error: {{error_mensaje}}

Por favor revisá el panel de backups y verificá:
- Espacio disponible en disco
- Estado del servicio Docker
- Estado de la conexión con Google Drive

Tus datos del último backup exitoso siguen disponibles.';
    v_cierre      := 'Atención requerida.
Sistema CRM Seguros';
    v_variables   := ARRAY['nombre_admin','fecha_intento','tipo_backup','error_mensaje']::text[];

    INSERT INTO plantillas_email
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

  ---- BACKUP_SYNC_FALLIDO -------------------------------------------------
  v_codigo := 'sistema_backup_sync_fallido';
  IF NOT EXISTS (SELECT 1 FROM plantillas_email WHERE codigo = v_codigo) THEN
    v_nombre      := 'Sync con Google Drive fallido';
    v_descripcion := 'Notificación al admin cuando la sincronización con Google Drive falla. (Crítico)';
    v_asunto      := '⚠ Sincronización con Google Drive FALLIDA';
    v_saludo      := 'Hola {{nombre_admin}}!';
    v_cuerpo      := 'El backup local se completó correctamente, pero la sincronización con Google Drive FALLÓ.

Detalles:
- Fecha del intento: {{fecha_intento}}
- Mensaje de error: {{error_mensaje}}

Tu backup local está seguro, pero NO se subió a la nube. Si el servidor falla, vas a tener que restaurar desde el backup local.

Acciones recomendadas:
- Verificá tu conexión a internet
- Confirmá que rclone esté configurado correctamente
- Revisá que tu cuenta de Google Drive tenga espacio disponible';
    v_cierre      := 'Atención requerida.
Sistema CRM Seguros';
    v_variables   := ARRAY['nombre_admin','fecha_intento','error_mensaje']::text[];

    INSERT INTO plantillas_email
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

  ---- RESTAURACION_INICIADA ----------------------------------------------
  v_codigo := 'sistema_restauracion_iniciada';
  IF NOT EXISTS (SELECT 1 FROM plantillas_email WHERE codigo = v_codigo) THEN
    v_nombre      := 'Restauración iniciada';
    v_descripcion := 'Notificación al admin cuando se inicia una restauración del CRM. (Informativo)';
    v_asunto      := '🔄 Restauración del CRM iniciada';
    v_saludo      := 'Hola {{nombre_admin}}!';
    v_cuerpo      := 'Se inició una restauración de tu CRM.

Detalles:
- Fecha de inicio: {{fecha_inicio}}
- Iniciada por: {{usuario_iniciador}}
- Backup a restaurar: {{nombre_backup}}

El sistema va a estar temporalmente fuera de servicio mientras se completa la restauración.';
    v_cierre      := 'Sistema CRM Seguros';
    v_variables   := ARRAY['nombre_admin','fecha_inicio','usuario_iniciador','nombre_backup']::text[];

    INSERT INTO plantillas_email
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

  ---- RESTAURACION_COMPLETADA --------------------------------------------
  v_codigo := 'sistema_restauracion_completada';
  IF NOT EXISTS (SELECT 1 FROM plantillas_email WHERE codigo = v_codigo) THEN
    v_nombre      := 'Restauración completada';
    v_descripcion := 'Notificación al admin cuando una restauración finaliza con éxito. (Informativo)';
    v_asunto      := '✓ Restauración completada exitosamente';
    v_saludo      := 'Hola {{nombre_admin}}!';
    v_cuerpo      := 'La restauración de tu CRM se completó correctamente.

Detalles:
- Fecha de finalización: {{fecha_fin}}
- Duración: {{duracion}}
- Backup restaurado: {{nombre_backup}}

Tu CRM está nuevamente operativo. Todas las sesiones se cerraron por seguridad, deberás volver a iniciar sesión.';
    v_cierre      := 'Sistema CRM Seguros';
    v_variables   := ARRAY['nombre_admin','fecha_fin','duracion','nombre_backup']::text[];

    INSERT INTO plantillas_email
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

  ---- RESTAURACION_FALLIDA -----------------------------------------------
  v_codigo := 'sistema_restauracion_fallida';
  IF NOT EXISTS (SELECT 1 FROM plantillas_email WHERE codigo = v_codigo) THEN
    v_nombre      := 'Restauración fallida';
    v_descripcion := 'Notificación crítica al admin cuando una restauración falla. (Crítico)';
    v_asunto      := '⚠ Restauración FALLIDA - Acción requerida';
    v_saludo      := 'Hola {{nombre_admin}}!';
    v_cuerpo      := 'La restauración del CRM FALLÓ.

Detalles del error:
- Fecha del intento: {{fecha_intento}}
- Etapa donde falló: {{etapa_fallo}}
- Mensaje de error: {{error_mensaje}}

IMPORTANTE: tus datos actuales NO fueron modificados (la restauración falló antes de afectar la base de datos). Si la restauración alcanzó a modificar archivos, hay un pre-backup de seguridad disponible para revertir.

Por favor revisá el panel de backups y consultá el log completo de la restauración para más detalles.';
    v_cierre      := 'Atención urgente requerida.
Sistema CRM Seguros';
    v_variables   := ARRAY['nombre_admin','fecha_intento','etapa_fallo','error_mensaje']::text[];

    INSERT INTO plantillas_email
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

  ---- PDF_PROCESADO ------------------------------------------------------
  v_codigo := 'sistema_pdf_procesado';
  IF NOT EXISTS (SELECT 1 FROM plantillas_email WHERE codigo = v_codigo) THEN
    v_nombre      := 'PDF procesado por agente IA';
    v_descripcion := 'Notificación al admin cuando el agente IA termina de procesar un PDF. (Informativo)';
    v_asunto      := '✓ PDF listo para revisar';
    v_saludo      := 'Hola {{nombre_admin}}!';
    v_cuerpo      := 'El agente IA terminó de procesar un PDF y está listo para tu revisión.

Detalles:
- Archivo: {{nombre_pdf}}
- Tipo de operación: {{tipo_operacion}}
- Fecha de procesamiento: {{fecha_procesamiento}}

Ingresá al CRM para revisar y aprobar los datos extraídos:
{{url_revision}}';
    v_cierre      := 'Sistema CRM Seguros';
    v_variables   := ARRAY['nombre_admin','nombre_pdf','tipo_operacion','fecha_procesamiento','url_revision']::text[];

    INSERT INTO plantillas_email
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

  ---- PDF_FALLIDO --------------------------------------------------------
  v_codigo := 'sistema_pdf_fallido';
  IF NOT EXISTS (SELECT 1 FROM plantillas_email WHERE codigo = v_codigo) THEN
    v_nombre      := 'PDF fallido por agente IA';
    v_descripcion := 'Notificación al admin cuando el agente IA falla al procesar un PDF. (Informativo)';
    v_asunto      := '⚠ El procesamiento de un PDF falló';
    v_saludo      := 'Hola {{nombre_admin}}!';
    v_cuerpo      := 'El agente IA no pudo procesar un PDF.

Detalles:
- Archivo: {{nombre_pdf}}
- Tipo de operación: {{tipo_operacion}}
- Mensaje de error: {{error_mensaje}}

Podés intentar volver a procesarlo desde el CRM o cargar la información manualmente.';
    v_cierre      := 'Sistema CRM Seguros';
    v_variables   := ARRAY['nombre_admin','nombre_pdf','tipo_operacion','error_mensaje']::text[];

    INSERT INTO plantillas_email
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

  ---- EMAIL_AUTOMATICO_FALLIDO -------------------------------------------
  v_codigo := 'sistema_email_automatico_fallido';
  IF NOT EXISTS (SELECT 1 FROM plantillas_email WHERE codigo = v_codigo) THEN
    v_nombre      := 'Email automático al cliente fallido';
    v_descripcion := 'Notificación al admin cuando un email automático a un cliente no se pudo enviar. (Informativo)';
    v_asunto      := '⚠ No se pudo enviar un email automático';
    v_saludo      := 'Hola {{nombre_admin}}!';
    v_cuerpo      := 'Un email automático a un cliente falló al enviarse.

Detalles:
- Cliente: {{nombre_cliente}}
- Email destinatario: {{email_destinatario}}
- Tipo: {{tipo_email}}
- Fecha del intento: {{fecha_intento}}
- Error: {{error_mensaje}}

Podés revisar el detalle y reintentar el envío desde el panel de comunicaciones del CRM.';
    v_cierre      := 'Sistema CRM Seguros';
    v_variables   := ARRAY['nombre_admin','nombre_cliente','email_destinatario','tipo_email','fecha_intento','error_mensaje']::text[];

    INSERT INTO plantillas_email
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
