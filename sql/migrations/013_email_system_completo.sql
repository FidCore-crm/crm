-- ============================================================================
-- Sistema de email: formalización completa + encolado + plantillas editables
-- ============================================================================
--
-- Crea las tablas que hasta ahora estaban tipadas en TS pero sin CREATE en
-- migraciones: email_envios, email_bajas, email_clicks, plantillas_email.
--
-- Extiende configuracion_comunicaciones con toggles por tipo + retención +
-- delay de envíos automáticos + adjuntos máximos.
--
-- Siembra las 6 plantillas base. Si alguna ya existe por código, no se toca.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) email_envios — historial y cola de envíos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_envios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Destinatario
  persona_id UUID REFERENCES personas(id) ON DELETE SET NULL,
  poliza_id UUID REFERENCES polizas(id) ON DELETE SET NULL,
  destinatario_email VARCHAR NOT NULL,
  destinatario_nombre VARCHAR,

  -- Contenido
  plantilla_codigo VARCHAR NOT NULL,
  asunto VARCHAR NOT NULL,
  cuerpo_html TEXT,
  archivos_adjuntos JSONB,
  variables_usadas JSONB,

  -- Estado / cola
  estado VARCHAR NOT NULL DEFAULT 'ENCOLADO',
  intentos INTEGER NOT NULL DEFAULT 0,
  error_mensaje TEXT,
  enviar_despues_de TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Origen
  tipo_envio VARCHAR NOT NULL,
  enviado_por_usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,

  -- Tracking
  token_tracking VARCHAR UNIQUE,
  fecha_apertura TIMESTAMP WITH TIME ZONE,
  cantidad_aperturas INTEGER NOT NULL DEFAULT 0,
  fecha_primer_click TIMESTAMP WITH TIME ZONE,
  cantidad_clicks INTEGER NOT NULL DEFAULT 0,

  -- Retención (archivado = se borró cuerpo/adjuntos/variables, solo quedó metadata)
  archivado BOOLEAN NOT NULL DEFAULT false,

  -- Auditoría
  fecha_creacion TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  fecha_envio TIMESTAMP WITH TIME ZONE
);

-- CHECK constraints (drop + recreate para idempotencia)
ALTER TABLE email_envios DROP CONSTRAINT IF EXISTS email_envios_estado_check;
ALTER TABLE email_envios
  ADD CONSTRAINT email_envios_estado_check
  CHECK (estado IN (
    'ENCOLADO', 'ENVIANDO', 'ENVIADO', 'FALLIDO',
    'EXCLUIDO_BAJA', 'EXCLUIDO_NO_MARKETING', 'PENDIENTE'
  ));

ALTER TABLE email_envios DROP CONSTRAINT IF EXISTS email_envios_tipo_envio_check;
ALTER TABLE email_envios
  ADD CONSTRAINT email_envios_tipo_envio_check
  CHECK (tipo_envio IN (
    'AUTOMATICO_BIENVENIDA',
    'AUTOMATICO_RENOVACION',
    'AUTOMATICO_PORTAL_CLIENTE',
    'MANUAL',
    'MASIVO',
    'NOTIFICACION_INTERNA'
  ));

CREATE INDEX IF NOT EXISTS idx_email_envios_persona ON email_envios(persona_id);
CREATE INDEX IF NOT EXISTS idx_email_envios_poliza ON email_envios(poliza_id);
CREATE INDEX IF NOT EXISTS idx_email_envios_estado ON email_envios(estado);
CREATE INDEX IF NOT EXISTS idx_email_envios_created ON email_envios(fecha_creacion DESC);
CREATE INDEX IF NOT EXISTS idx_email_envios_tipo ON email_envios(tipo_envio);
CREATE INDEX IF NOT EXISTS idx_email_envios_encolados
  ON email_envios(estado, enviar_despues_de)
  WHERE estado = 'ENCOLADO';
CREATE INDEX IF NOT EXISTS idx_email_envios_token
  ON email_envios(token_tracking)
  WHERE token_tracking IS NOT NULL;

ALTER TABLE email_envios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo en email_envios" ON email_envios;
CREATE POLICY "Permitir todo en email_envios" ON email_envios FOR ALL USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 2) email_bajas — unsubscribe list
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_bajas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR UNIQUE NOT NULL,
  persona_id UUID REFERENCES personas(id) ON DELETE SET NULL,
  origen VARCHAR,
  motivo TEXT,
  fecha_baja TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE email_bajas DROP CONSTRAINT IF EXISTS email_bajas_origen_check;
ALTER TABLE email_bajas
  ADD CONSTRAINT email_bajas_origen_check
  CHECK (origen IS NULL OR origen IN ('unsubscribe_link', 'manual_admin', 'bounce_permanente'));

CREATE INDEX IF NOT EXISTS idx_email_bajas_email ON email_bajas(email);
CREATE INDEX IF NOT EXISTS idx_email_bajas_persona ON email_bajas(persona_id);

ALTER TABLE email_bajas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo en email_bajas" ON email_bajas;
CREATE POLICY "Permitir todo en email_bajas" ON email_bajas FOR ALL USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 3) email_clicks — tracking de clicks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  envio_id UUID NOT NULL REFERENCES email_envios(id) ON DELETE CASCADE,
  url_destino TEXT NOT NULL,
  ip_origen VARCHAR,
  user_agent TEXT,
  fecha_click TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_clicks_envio ON email_clicks(envio_id);

ALTER TABLE email_clicks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo en email_clicks" ON email_clicks;
CREATE POLICY "Permitir todo en email_clicks" ON email_clicks FOR ALL USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 4) plantillas_email — editables por el PAS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plantillas_email (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  codigo VARCHAR UNIQUE NOT NULL,
  nombre VARCHAR NOT NULL,
  descripcion TEXT,
  contexto VARCHAR NOT NULL,

  -- Contenido editable (estructura fija con 4 campos)
  asunto VARCHAR NOT NULL,
  saludo TEXT NOT NULL,
  cuerpo TEXT NOT NULL,
  cierre TEXT NOT NULL,

  -- Defaults del sistema — usados por "Restaurar default" del editor
  asunto_default VARCHAR,
  saludo_default TEXT,
  cuerpo_default TEXT,
  cierre_default TEXT,

  variables_disponibles JSONB NOT NULL DEFAULT '[]'::jsonb,

  activa BOOLEAN NOT NULL DEFAULT true,
  es_sistema BOOLEAN NOT NULL DEFAULT true,
  editable BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE plantillas_email DROP CONSTRAINT IF EXISTS plantillas_email_contexto_check;
ALTER TABLE plantillas_email
  ADD CONSTRAINT plantillas_email_contexto_check
  CHECK (contexto IN ('PERSONA', 'POLIZA', 'PORTAL_CLIENTE', 'GENERAL'));

CREATE INDEX IF NOT EXISTS idx_plantillas_email_codigo ON plantillas_email(codigo);

ALTER TABLE plantillas_email ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo en plantillas_email" ON plantillas_email;
CREATE POLICY "Permitir todo en plantillas_email" ON plantillas_email FOR ALL USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 5) configuracion_comunicaciones — nuevos campos
-- ---------------------------------------------------------------------------
ALTER TABLE configuracion_comunicaciones ADD COLUMN IF NOT EXISTS envio_automatico_bienvenida_poliza BOOLEAN DEFAULT true;
ALTER TABLE configuracion_comunicaciones ADD COLUMN IF NOT EXISTS envio_automatico_portal_cliente BOOLEAN DEFAULT true;
ALTER TABLE configuracion_comunicaciones ADD COLUMN IF NOT EXISTS max_adjuntos_mb INTEGER DEFAULT 20;
ALTER TABLE configuracion_comunicaciones ADD COLUMN IF NOT EXISTS delay_entre_envios_automaticos_seg INTEGER DEFAULT 10;
ALTER TABLE configuracion_comunicaciones ADD COLUMN IF NOT EXISTS retener_completo_dias INTEGER DEFAULT 90;
ALTER TABLE configuracion_comunicaciones ADD COLUMN IF NOT EXISTS retener_metadata_meses INTEGER DEFAULT 6;
ALTER TABLE configuracion_comunicaciones ADD COLUMN IF NOT EXISTS eliminar_despues_meses INTEGER DEFAULT 12;

-- ---------------------------------------------------------------------------
-- 6) notificaciones — nuevo tipo EMAIL_AUTOMATICO_FALLIDO
-- ---------------------------------------------------------------------------
ALTER TABLE notificaciones DROP CONSTRAINT IF EXISTS notificaciones_tipo_check;
ALTER TABLE notificaciones
  ADD CONSTRAINT notificaciones_tipo_check
  CHECK (tipo IN (
    'POLIZA_VENCIDA','TAREA_VENCIDA','SINIESTRO_30_DIAS','SINIESTRO_60_DIAS',
    'COTIZACION_SIN_RESPUESTA','COTIZACION_SIN_SEGUIMIENTO','OPORTUNIDAD_ESTANCADA',
    'COTIZACION_VENCIENDO_PRONTO','COTIZACION_VENCIDA',
    'IMPORTACION_INICIADA','IMPORTACION_ANALIZADA','IMPORTACION_LISTA_REVISION',
    'IMPORTACION_COMPLETADA','IMPORTACION_FALLIDA','IMPORTACION_PAUSADA','IMPORTACION_DESHECHA',
    'PDF_LISTO_PARA_REVISAR','PDF_FALLIDO','POLIZA_REHABILITADA',
    'BACKUP_FALLIDO','BACKUP_SYNC_FALLIDO',
    'RESTAURACION_INICIADA','RESTAURACION_COMPLETADA','RESTAURACION_FALLIDA',
    'EMAIL_AUTOMATICO_FALLIDO'
  ));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'configuracion_notificaciones') THEN
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
        'RESTAURACION_INICIADA','RESTAURACION_COMPLETADA','RESTAURACION_FALLIDA',
        'EMAIL_AUTOMATICO_FALLIDO'
      ));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 7) Seed de plantillas del sistema — solo si no existen por código
-- ---------------------------------------------------------------------------
INSERT INTO plantillas_email (codigo, nombre, descripcion, contexto, asunto, saludo, cuerpo, cierre,
                              asunto_default, saludo_default, cuerpo_default, cierre_default,
                              variables_disponibles, es_sistema, editable)
VALUES
  (
    'bienvenida_poliza',
    'Bienvenida de póliza nueva',
    'Email automático al activarse una nueva póliza. Adjunta toda la documentación.',
    'POLIZA',
    'Tu póliza {{numero_poliza}} ya está activa',
    'Hola {{nombre}}!',
    'Te enviamos esta notificación para confirmarte que tu póliza ya está vigente y lista para usar.

Datos de tu póliza:
- Número: {{numero_poliza}}
- Compañía: {{compania}}
- Ramo: {{ramo}}
- Riesgo: {{riesgo}}
- Vigencia: desde {{fecha_inicio}} hasta {{fecha_fin}}

Adjuntamos toda la documentación de la póliza. Guardala en un lugar seguro y tené una copia siempre a mano.',
    'Cualquier consulta, estamos a tu disposición.

Saludos,
{{productora_nombre}}',
    'Tu póliza {{numero_poliza}} ya está activa',
    'Hola {{nombre}}!',
    'Te enviamos esta notificación para confirmarte que tu póliza ya está vigente y lista para usar.

Datos de tu póliza:
- Número: {{numero_poliza}}
- Compañía: {{compania}}
- Ramo: {{ramo}}
- Riesgo: {{riesgo}}
- Vigencia: desde {{fecha_inicio}} hasta {{fecha_fin}}

Adjuntamos toda la documentación de la póliza. Guardala en un lugar seguro y tené una copia siempre a mano.',
    'Cualquier consulta, estamos a tu disposición.

Saludos,
{{productora_nombre}}',
    '["nombre","apellido","numero_poliza","compania","ramo","fecha_inicio","fecha_fin","riesgo","productora_nombre","productora_telefono","productora_email"]'::jsonb,
    true, true
  ),
  (
    'renovacion_poliza',
    'Renovación de póliza',
    'Email automático al activarse una renovación. Adjunta la nueva documentación.',
    'POLIZA',
    'Renovación de tu póliza {{numero_poliza}}',
    'Hola {{nombre}}!',
    'Te informamos que tu póliza fue renovada y ya se encuentra vigente.

Datos de la renovación:
- Número: {{numero_poliza}}
- Compañía: {{compania}}
- Ramo: {{ramo}}
- Riesgo: {{riesgo}}
- Vigencia: desde {{fecha_inicio}} hasta {{fecha_fin}}

Adjuntamos la nueva documentación. Te recomendamos reemplazar la documentación anterior para tener siempre la última versión a mano.',
    'Cualquier consulta, estamos a tu disposición.

Saludos,
{{productora_nombre}}',
    'Renovación de tu póliza {{numero_poliza}}',
    'Hola {{nombre}}!',
    'Te informamos que tu póliza fue renovada y ya se encuentra vigente.

Datos de la renovación:
- Número: {{numero_poliza}}
- Compañía: {{compania}}
- Ramo: {{ramo}}
- Riesgo: {{riesgo}}
- Vigencia: desde {{fecha_inicio}} hasta {{fecha_fin}}

Adjuntamos la nueva documentación. Te recomendamos reemplazar la documentación anterior para tener siempre la última versión a mano.',
    'Cualquier consulta, estamos a tu disposición.

Saludos,
{{productora_nombre}}',
    '["nombre","apellido","numero_poliza","compania","ramo","fecha_inicio","fecha_fin","riesgo","productora_nombre","productora_telefono","productora_email"]'::jsonb,
    true, true
  ),
  (
    'recordatorio_pago',
    'Recordatorio de pago',
    'Email manual para recordar pagos pendientes.',
    'POLIZA',
    'Recordatorio de pago - Póliza {{numero_poliza}}',
    'Hola {{nombre}}!',
    'Te escribimos para recordarte que tenés un pago pendiente correspondiente a tu póliza:

- Número: {{numero_poliza}}
- Compañía: {{compania}}
- Ramo: {{ramo}}

Por favor regularizá el pago a la brevedad para mantener activa tu cobertura.',
    'Cualquier consulta sobre el pago, no dudes en contactarnos.

Saludos,
{{productora_nombre}}',
    'Recordatorio de pago - Póliza {{numero_poliza}}',
    'Hola {{nombre}}!',
    'Te escribimos para recordarte que tenés un pago pendiente correspondiente a tu póliza:

- Número: {{numero_poliza}}
- Compañía: {{compania}}
- Ramo: {{ramo}}

Por favor regularizá el pago a la brevedad para mantener activa tu cobertura.',
    'Cualquier consulta sobre el pago, no dudes en contactarnos.

Saludos,
{{productora_nombre}}',
    '["nombre","apellido","numero_poliza","compania","ramo","productora_nombre","productora_telefono","productora_email"]'::jsonb,
    true, true
  ),
  (
    'notificacion_general',
    'Notificación / Novedades',
    'Email para comunicar novedades, cambios o información general.',
    'GENERAL',
    '{{titulo}}',
    'Hola {{nombre}}!',
    '{{cuerpo_mensaje}}',
    'Saludos,
{{productora_nombre}}',
    '{{titulo}}',
    'Hola {{nombre}}!',
    '{{cuerpo_mensaje}}',
    'Saludos,
{{productora_nombre}}',
    '["nombre","apellido","titulo","cuerpo_mensaje","productora_nombre","productora_telefono","productora_email"]'::jsonb,
    true, true
  ),
  (
    'informativa',
    'Informativa puntual',
    'Email para avisos puntuales con título y cuerpo libre.',
    'GENERAL',
    '{{titulo}}',
    'Hola {{nombre}}!',
    '{{cuerpo_mensaje}}',
    'Saludos,
{{productora_nombre}}',
    '{{titulo}}',
    'Hola {{nombre}}!',
    '{{cuerpo_mensaje}}',
    'Saludos,
{{productora_nombre}}',
    '["nombre","apellido","titulo","cuerpo_mensaje","productora_nombre","productora_telefono","productora_email"]'::jsonb,
    true, true
  ),
  (
    'portal_cliente_acceso',
    'Acceso al Portal del Cliente',
    'Email automático enviado al habilitar el acceso al portal.',
    'PORTAL_CLIENTE',
    'Tu acceso al Portal del Cliente',
    'Hola {{nombre}}!',
    'Habilitamos tu acceso al Portal del Cliente. Desde ahí vas a poder:

- Ver todas tus pólizas vigentes
- Descargar tu documentación
- Consultar siniestros activos
- Denunciar un nuevo siniestro

Accedé al portal usando este link:
{{url_portal}}',
    'Cualquier consulta, estamos a tu disposición.

Saludos,
{{productora_nombre}}',
    'Tu acceso al Portal del Cliente',
    'Hola {{nombre}}!',
    'Habilitamos tu acceso al Portal del Cliente. Desde ahí vas a poder:

- Ver todas tus pólizas vigentes
- Descargar tu documentación
- Consultar siniestros activos
- Denunciar un nuevo siniestro

Accedé al portal usando este link:
{{url_portal}}',
    'Cualquier consulta, estamos a tu disposición.

Saludos,
{{productora_nombre}}',
    '["nombre","apellido","url_portal","productora_nombre","productora_telefono","productora_email"]'::jsonb,
    true, true
  )
ON CONFLICT (codigo) DO NOTHING;
