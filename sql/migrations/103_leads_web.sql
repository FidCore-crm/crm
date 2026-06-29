-- ============================================================
-- Migración 103: Recepción de leads desde formularios web externos
-- ============================================================
-- El PAS puede colgar un formulario en su sitio web (ej:
-- loboseguros.com.ar/contacto) que postea directo al CRM. Los
-- leads llegan, se asignan automáticamente a un usuario
-- (round-robin entre activos / al admin / sin asignar) y disparan:
--   - Notificación in-app del tipo LEAD_WEB_NUEVO (panel "Inbox"
--     en el navbar, separado de la campana general).
--   - Email al admin con la plantilla sistema_lead_web_recibido
--     (editable desde Comunicaciones).
--
-- Protecciones del endpoint:
--   - Token único de instalación (64 chars hex) en la URL pública.
--   - Honeypot (campo invisible).
--   - Rate-limit por IP (5/min con failMode=closed).
--   - Whitelist de dominios permitidos (Referer + CORS).
--   - Validación de campos.
--
-- La columna `leads.fuente` ya tiene el valor 'WEB' — lo
-- reutilizamos, no agregamos otra columna de origen.
--
-- Toda la migración es idempotente.
-- ============================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Tabla configuracion_leads_web (singleton)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.configuracion_leads_web (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activo BOOLEAN NOT NULL DEFAULT false,
  token VARCHAR(128) NOT NULL,
  dominios_permitidos TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  modo_asignacion VARCHAR(20) NOT NULL DEFAULT 'ROTATIVO',
  ultimo_usuario_asignado_id UUID,
  notificar_email_admin BOOLEAN NOT NULL DEFAULT true,
  notificar_inapp BOOLEAN NOT NULL DEFAULT true,
  recibidos_mes_actual INTEGER NOT NULL DEFAULT 0,
  recibidos_historico INTEGER NOT NULL DEFAULT 0,
  reset_contador_mes DATE NOT NULL DEFAULT (date_trunc('month', NOW())::date),
  ultimo_lead_recibido_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT configuracion_leads_web_modo_check
    CHECK (modo_asignacion IN ('ROTATIVO', 'ADMIN', 'SIN_ASIGNAR')),
  CONSTRAINT configuracion_leads_web_token_len
    CHECK (length(token) >= 32)
);

-- Índice parcial único para garantizar singleton (no nos importa el id, solo que haya UNO)
CREATE UNIQUE INDEX IF NOT EXISTS idx_configuracion_leads_web_singleton
  ON public.configuracion_leads_web ((true));

-- FK al usuario asignado (cursor de round-robin). SET NULL si el usuario se borra.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'configuracion_leads_web'
      AND constraint_name = 'configuracion_leads_web_ultimo_usuario_fk'
  ) THEN
    ALTER TABLE public.configuracion_leads_web
      ADD CONSTRAINT configuracion_leads_web_ultimo_usuario_fk
      FOREIGN KEY (ultimo_usuario_asignado_id)
      REFERENCES public.usuarios(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Trigger updated_at
DROP TRIGGER IF EXISTS tg_actualizar_updated_at_configuracion_leads_web ON public.configuracion_leads_web;
CREATE TRIGGER tg_actualizar_updated_at_configuracion_leads_web
  BEFORE UPDATE ON public.configuracion_leads_web
  FOR EACH ROW EXECUTE FUNCTION public.fn_actualizar_updated_at();

-- Insertar fila singleton si no existe (token random 64 hex chars = 32 bytes)
INSERT INTO public.configuracion_leads_web (
  activo, token, dominios_permitidos, modo_asignacion,
  notificar_email_admin, notificar_inapp
)
SELECT
  false,
  encode(gen_random_bytes(32), 'hex'),
  ARRAY[]::TEXT[],
  'ROTATIVO',
  true,
  true
WHERE NOT EXISTS (SELECT 1 FROM public.configuracion_leads_web);

COMMENT ON TABLE public.configuracion_leads_web IS
  'Configuración singleton para recepción de leads desde formularios web externos. El campo token va en la URL pública del endpoint y permite identificar la instalación.';

COMMENT ON COLUMN public.configuracion_leads_web.modo_asignacion IS
  'ROTATIVO=round-robin entre usuarios activos. ADMIN=todos al primer admin. SIN_ASIGNAR=cola para distribución manual.';

COMMENT ON COLUMN public.configuracion_leads_web.dominios_permitidos IS
  'Lista de dominios autorizados a postear al endpoint (ej: ["loboseguros.com.ar","www.loboseguros.com.ar"]). El endpoint verifica Referer Y emite CORS solo para estos dominios.';

-- ---------------------------------------------------------------------------
-- 2) Tabla de diagnóstico — últimos intentos al endpoint público
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.leads_web_intentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exito BOOLEAN NOT NULL,
  ip VARCHAR(45),
  referer TEXT,
  user_agent TEXT,
  motivo_rechazo VARCHAR(40),
  lead_id UUID,
  payload_resumen JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT leads_web_intentos_motivo_check
    CHECK (motivo_rechazo IS NULL OR motivo_rechazo IN (
      'TOKEN_INVALIDO', 'SISTEMA_INACTIVO', 'RATE_LIMIT',
      'HONEYPOT', 'REFERER_INVALIDO', 'CAMPOS_FALTANTES',
      'EMAIL_INVALIDO', 'PAYLOAD_GRANDE', 'ERROR_INTERNO'
    ))
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'leads_web_intentos'
      AND constraint_name = 'leads_web_intentos_lead_fk'
  ) THEN
    ALTER TABLE public.leads_web_intentos
      ADD CONSTRAINT leads_web_intentos_lead_fk
      FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_leads_web_intentos_created
  ON public.leads_web_intentos (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_leads_web_intentos_ip_created
  ON public.leads_web_intentos (ip, created_at DESC);

COMMENT ON TABLE public.leads_web_intentos IS
  'Auditoría rápida del endpoint público de leads. Útil para diagnóstico cuando el PAS prueba el formulario y quiere saber si llegó / por qué no. Se limpia automáticamente conservando solo los últimos 500 rows.';

-- ---------------------------------------------------------------------------
-- 3) Columna web_meta en `leads` para preservar metadatos del request
-- ---------------------------------------------------------------------------

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS web_meta JSONB;

COMMENT ON COLUMN public.leads.web_meta IS
  'Metadatos del request HTTP cuando el lead viene del endpoint público. Estructura: { ip, referer, user_agent, campos_extra, recibido_en, asignacion_modo }. NULL si el lead se creó manualmente.';

-- ---------------------------------------------------------------------------
-- 4) Toggle nuevo en configuracion_comunicaciones
-- ---------------------------------------------------------------------------

ALTER TABLE public.configuracion_comunicaciones
  ADD COLUMN IF NOT EXISTS notificar_admin_lead_web BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.configuracion_comunicaciones.notificar_admin_lead_web IS
  'Si está activo, manda email al admin con la plantilla sistema_lead_web_recibido cada vez que llega un lead desde el formulario web. Default ON.';

-- ---------------------------------------------------------------------------
-- 5) CHECK de notificaciones.tipo + LEAD_WEB_NUEVO
-- ---------------------------------------------------------------------------

ALTER TABLE public.notificaciones DROP CONSTRAINT IF EXISTS notificaciones_tipo_check;
ALTER TABLE public.notificaciones ADD CONSTRAINT notificaciones_tipo_check CHECK (
  tipo::text = ANY (ARRAY[
    'POLIZA_VENCIDA', 'TAREA_VENCIDA', 'SINIESTRO_30_DIAS', 'SINIESTRO_60_DIAS',
    'COTIZACION_SIN_RESPUESTA', 'COTIZACION_SIN_SEGUIMIENTO', 'OPORTUNIDAD_ESTANCADA',
    'COTIZACION_VENCIENDO_PRONTO', 'COTIZACION_VENCIDA',
    'IMPORTACION_INICIADA', 'IMPORTACION_ANALIZADA', 'IMPORTACION_LISTA_REVISION',
    'IMPORTACION_COMPLETADA', 'IMPORTACION_FALLIDA', 'IMPORTACION_PAUSADA', 'IMPORTACION_DESHECHA',
    'PDF_LISTO_PARA_REVISAR', 'PDF_FALLIDO',
    'POLIZA_REHABILITADA',
    'BACKUP_FALLIDO', 'BACKUP_SYNC_FALLIDO',
    'RESTAURACION_INICIADA', 'RESTAURACION_COMPLETADA', 'RESTAURACION_FALLIDA',
    'EMAIL_AUTOMATICO_FALLIDO',
    'COLA_EMAILS_ATRASADA',
    'SINIESTRO_DENUNCIA_PUBLICA',
    'SOLICITUD_BLANQUEO_PASSWORD', 'BLANQUEO_ABUSO_DETECTADO',
    'LICENCIA_POR_VENCER', 'LICENCIA_VENCIDA', 'LICENCIA_EN_GRACIA', 'LICENCIA_BLOQUEADA',
    'LICENCIA_CARGADA', 'LICENCIA_PROMOVIDA',
    'ACTUALIZACION_DISPONIBLE', 'ACTUALIZACION_PROGRAMADA', 'ACTUALIZACION_COMPLETADA',
    'ACTUALIZACION_FALLIDA',
    'LEAD_WEB_NUEVO'
  ]::text[])
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'configuracion_notificaciones'
      AND constraint_name = 'configuracion_notificaciones_tipo_check'
  ) THEN
    EXECUTE 'ALTER TABLE public.configuracion_notificaciones DROP CONSTRAINT configuracion_notificaciones_tipo_check';
    EXECUTE $cnst$
      ALTER TABLE public.configuracion_notificaciones ADD CONSTRAINT configuracion_notificaciones_tipo_check CHECK (
        tipo::text = ANY (ARRAY[
          'POLIZA_VENCIDA', 'TAREA_VENCIDA', 'SINIESTRO_30_DIAS', 'SINIESTRO_60_DIAS',
          'COTIZACION_SIN_RESPUESTA', 'COTIZACION_SIN_SEGUIMIENTO', 'OPORTUNIDAD_ESTANCADA',
          'COTIZACION_VENCIENDO_PRONTO', 'COTIZACION_VENCIDA',
          'IMPORTACION_INICIADA', 'IMPORTACION_ANALIZADA', 'IMPORTACION_LISTA_REVISION',
          'IMPORTACION_COMPLETADA', 'IMPORTACION_FALLIDA', 'IMPORTACION_PAUSADA', 'IMPORTACION_DESHECHA',
          'PDF_LISTO_PARA_REVISAR', 'PDF_FALLIDO',
          'POLIZA_REHABILITADA',
          'BACKUP_FALLIDO', 'BACKUP_SYNC_FALLIDO',
          'RESTAURACION_INICIADA', 'RESTAURACION_COMPLETADA', 'RESTAURACION_FALLIDA',
          'EMAIL_AUTOMATICO_FALLIDO',
          'COLA_EMAILS_ATRASADA',
          'SINIESTRO_DENUNCIA_PUBLICA',
          'SOLICITUD_BLANQUEO_PASSWORD', 'BLANQUEO_ABUSO_DETECTADO',
          'LICENCIA_POR_VENCER', 'LICENCIA_VENCIDA', 'LICENCIA_EN_GRACIA', 'LICENCIA_BLOQUEADA',
          'LICENCIA_CARGADA', 'LICENCIA_PROMOVIDA',
          'ACTUALIZACION_DISPONIBLE', 'ACTUALIZACION_PROGRAMADA', 'ACTUALIZACION_COMPLETADA',
          'ACTUALIZACION_FALLIDA',
          'LEAD_WEB_NUEVO'
        ]::text[])
      )
    $cnst$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6) CHECK email_envios.tipo_envio + SISTEMA_LEAD_WEB_RECIBIDO
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  constraint_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO constraint_def
    FROM pg_constraint
   WHERE conname = 'email_envios_tipo_envio_check';

  IF constraint_def IS NULL OR constraint_def NOT LIKE '%SISTEMA_LEAD_WEB_RECIBIDO%' THEN
    ALTER TABLE public.email_envios DROP CONSTRAINT IF EXISTS email_envios_tipo_envio_check;
    ALTER TABLE public.email_envios
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
        'SISTEMA_LEAD_WEB_RECIBIDO',
        'AUTH_RECUPERAR_PASSWORD',
        'AUTH_INVITACION_USUARIO',
        'AUTH_CONFIRMACION_EMAIL'
      ));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 7) Plantilla nueva: sistema_lead_web_recibido
-- ---------------------------------------------------------------------------

INSERT INTO public.plantillas_email (
  codigo, nombre, descripcion, contexto,
  asunto, saludo, cuerpo, cierre,
  asunto_default, saludo_default, cuerpo_default, cierre_default,
  variables_disponibles, es_sistema, editable
)
VALUES (
  'sistema_lead_web_recibido',
  'Lead nuevo desde la web',
  'Email que recibe el admin (o el usuario asignado) cuando llega un lead desde el formulario público de la web. Lo dispara automáticamente el endpoint /api/publico/leads/[token].',
  'GENERAL',
  'Nuevo lead desde la web: {{nombre_lead}}',
  'Hola {{nombre_admin}}!',
  'Llegó un lead nuevo a través del formulario web.

Datos del lead:
- Nombre: {{nombre_lead}} {{apellido_lead}}
- Email: {{email_lead}}
- Teléfono: {{telefono_lead}}
- Tipo de seguro de interés: {{seguro_lead}}
- Mensaje: {{mensaje_lead}}

Asignado a: {{asignado_a}}
Origen: {{referer_lead}}

Ingresá al CRM para hacerle el seguimiento.',
  'Saludos,
{{organizacion_nombre}}',
  'Nuevo lead desde la web: {{nombre_lead}}',
  'Hola {{nombre_admin}}!',
  'Llegó un lead nuevo a través del formulario web.

Datos del lead:
- Nombre: {{nombre_lead}} {{apellido_lead}}
- Email: {{email_lead}}
- Teléfono: {{telefono_lead}}
- Tipo de seguro de interés: {{seguro_lead}}
- Mensaje: {{mensaje_lead}}

Asignado a: {{asignado_a}}
Origen: {{referer_lead}}

Ingresá al CRM para hacerle el seguimiento.',
  'Saludos,
{{organizacion_nombre}}',
  ARRAY[
    'nombre_admin','nombre_lead','apellido_lead','email_lead',
    'telefono_lead','seguro_lead','mensaje_lead','asignado_a','referer_lead',
    'organizacion_nombre','organizacion_telefono','organizacion_email'
  ]::text[],
  true,
  true
)
ON CONFLICT (codigo) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 8) Sumar configuracion_leads_web y leads_web_intentos a Realtime
--    (la UI del navbar usa Realtime para refrescar contadores sin polling)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  -- leads ya está en la publicación realtime (migración 051) → no se toca
  -- Solo agregamos intentos para el diagnóstico en vivo de la pantalla de config.
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'leads_web_intentos'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.leads_web_intentos';
  END IF;
END $$;

ALTER TABLE public.leads_web_intentos REPLICA IDENTITY FULL;

COMMIT;
