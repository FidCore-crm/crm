-- ============================================================
-- Migración 094: Separar bienvenida del CLIENTE de emisión de PÓLIZA
-- ============================================================
-- Hasta acá el sistema solo tenía un email "AUTOMATICO_BIENVENIDA" que se
-- mandaba cada vez que una póliza pasaba a VIGENTE. El problema: un cliente
-- de 5 años que se compra un auto nuevo recibía otra "bienvenida". Es
-- conceptualmente incorrecto: ese email cumple la función de "tu póliza
-- está emitida + acá tenés los PDFs", no de "bienvenido a la organización".
--
-- Esta migración:
--   1) Renombra visualmente la plantilla `bienvenida_poliza` a "Emisión de
--      póliza" (el código interno se mantiene por compat con email_envios
--      históricos).
--   2) Crea una plantilla NUEVA `bienvenida_cliente` para el saludo formal
--      cuando un cliente se incorpora a la organización. Se manda UNA SOLA
--      VEZ por persona, sin adjuntos.
--   3) Agrega columna `origen_creacion` a personas (mismo patrón que
--      pólizas) para distinguir importados de altas reales.
--   4) Agrega columna `bienvenida_cliente_encolada_en` para anti-duplicado.
--      Backfill a NOW() para todas las personas existentes — los clientes
--      que ya estaban en el sistema antes de esta feature NO reciben
--      bienvenida retroactiva.
--   5) Agrega toggle `envio_automatico_bienvenida_cliente` (default OFF).
--   6) Amplía el CHECK de email_envios.tipo_envio.
--
-- Idempotente en todos los pasos.
-- ============================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Columnas nuevas en `personas`
-- ---------------------------------------------------------------------------

ALTER TABLE personas
  ADD COLUMN IF NOT EXISTS origen_creacion VARCHAR(20) NOT NULL DEFAULT 'MANUAL';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'personas' AND constraint_name = 'personas_origen_creacion_check'
  ) THEN
    ALTER TABLE personas
      ADD CONSTRAINT personas_origen_creacion_check
      CHECK (origen_creacion IN ('MANUAL', 'IMPORTACION', 'AGENTE_PDF'));
  END IF;
END $$;

COMMENT ON COLUMN personas.origen_creacion IS
  'Cómo entró la persona al sistema. MANUAL=alta directa, AGENTE_PDF=creada al aplicar un PDF, IMPORTACION=cargada vía importador masivo. Las IMPORTACION NO disparan email de bienvenida automático (vienen de otra cartera, no son altas reales).';

ALTER TABLE personas
  ADD COLUMN IF NOT EXISTS bienvenida_cliente_encolada_en TIMESTAMPTZ;

COMMENT ON COLUMN personas.bienvenida_cliente_encolada_en IS
  'Timestamp en que se encoló el email AUTOMATICO_BIENVENIDA_CLIENTE para esta persona. NULL = nunca se encoló. Garantiza que la bienvenida se manda UNA SOLA VEZ por cliente en su vida (no por póliza).';

-- ---------------------------------------------------------------------------
-- 2) Backfill: personas existentes ya tienen "consumida" la bienvenida.
--    Esto evita disparos retroactivos cuando el PAS active el toggle.
--    Idempotente: solo toca filas con NULL (las nuevas post-migración
--    quedan NULL y reciben bienvenida normalmente).
-- ---------------------------------------------------------------------------

UPDATE personas
   SET bienvenida_cliente_encolada_en = NOW()
 WHERE bienvenida_cliente_encolada_en IS NULL;

-- ---------------------------------------------------------------------------
-- 3) Toggle en configuracion_comunicaciones
-- ---------------------------------------------------------------------------

ALTER TABLE configuracion_comunicaciones
  ADD COLUMN IF NOT EXISTS envio_automatico_bienvenida_cliente BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN configuracion_comunicaciones.envio_automatico_bienvenida_cliente IS
  'Si está activo, manda email "bienvenida_cliente" la primera vez que se emite una póliza VIGENTE para una persona MANUAL o AGENTE_PDF. Default OFF — el PAS lo activa cuando quiere.';

-- ---------------------------------------------------------------------------
-- 4) Ampliar CHECK de email_envios.tipo_envio para AUTOMATICO_BIENVENIDA_CLIENTE
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  constraint_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO constraint_def
    FROM pg_constraint
   WHERE conname = 'email_envios_tipo_envio_check';

  IF constraint_def IS NULL OR constraint_def NOT LIKE '%AUTOMATICO_BIENVENIDA_CLIENTE%' THEN
    ALTER TABLE email_envios DROP CONSTRAINT IF EXISTS email_envios_tipo_envio_check;
    ALTER TABLE email_envios
      ADD CONSTRAINT email_envios_tipo_envio_check
      CHECK (tipo_envio IN (
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
        'AUTH_RECUPERAR_PASSWORD',
        'AUTH_INVITACION_USUARIO',
        'AUTH_CONFIRMACION_EMAIL'
      ));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5) Plantilla nueva: bienvenida_cliente
-- ---------------------------------------------------------------------------

INSERT INTO plantillas_email (
  codigo, nombre, descripcion, contexto,
  asunto, saludo, cuerpo, cierre,
  asunto_default, saludo_default, cuerpo_default, cierre_default,
  variables_disponibles, es_sistema, editable
)
VALUES (
  'bienvenida_cliente',
  'Bienvenida del cliente',
  'Email automático cuando se incorpora un cliente nuevo a la organización (al emitirse su primera póliza). Se manda UNA SOLA VEZ por cliente. No lleva adjuntos.',
  'GENERAL',
  '¡Te damos la bienvenida a {{organizacion_nombre}}!',
  'Hola {{nombre}}!',
  'Queremos darte la bienvenida a {{organizacion_nombre}}. A partir de ahora vas a poder contar con nuestro acompañamiento para gestionar tus seguros y atender cualquier consulta que tengas.

Nuestro compromiso es brindarte una atención personalizada y estar a tu disposición cuando nos necesites.

Si tenés alguna pregunta o querés contactarnos, escribinos a {{organizacion_email}} o llamanos al {{organizacion_telefono}}.',
  '¡Gracias por confiar en nosotros!

Saludos cordiales,
{{organizacion_nombre}}',
  '¡Te damos la bienvenida a {{organizacion_nombre}}!',
  'Hola {{nombre}}!',
  'Queremos darte la bienvenida a {{organizacion_nombre}}. A partir de ahora vas a poder contar con nuestro acompañamiento para gestionar tus seguros y atender cualquier consulta que tengas.

Nuestro compromiso es brindarte una atención personalizada y estar a tu disposición cuando nos necesites.

Si tenés alguna pregunta o querés contactarnos, escribinos a {{organizacion_email}} o llamanos al {{organizacion_telefono}}.',
  '¡Gracias por confiar en nosotros!

Saludos cordiales,
{{organizacion_nombre}}',
  ARRAY['nombre','apellido','organizacion_nombre','organizacion_telefono','organizacion_email']::text[],
  true,
  true
)
ON CONFLICT (codigo) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6) Actualizar nombre legible de bienvenida_poliza para que no confunda
-- ---------------------------------------------------------------------------

UPDATE plantillas_email
   SET nombre = 'Emisión de póliza',
       descripcion = 'Email automático al emitirse una póliza nueva (cuando pasa a VIGENTE). Adjunta toda la documentación de la póliza. Distinto de la "Bienvenida del cliente", que se manda una sola vez en la vida del cliente.'
 WHERE codigo = 'bienvenida_poliza';

COMMIT;
