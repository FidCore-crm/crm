-- Migración 067: tabla plantillas_whatsapp + seed inicial
--
-- WhatsApp NO se envía desde el CRM (no hay integración con WA Business API).
-- El CRM solo abre wa.me con un texto pre-armado y el PAS revisa/envía desde
-- su teléfono. Por eso la plantilla es texto plano (no HTML, no asunto, no
-- header/cierre estructurado). Variables se escriben como {{nombre}} y se
-- reemplazan en cliente con un mini renderer.

BEGIN;

CREATE TABLE IF NOT EXISTS plantillas_whatsapp (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo                VARCHAR NOT NULL UNIQUE,
  nombre                VARCHAR NOT NULL,
  descripcion           TEXT,
  contexto              VARCHAR NOT NULL CHECK (contexto IN (
    'PERSONA', 'POLIZA', 'SINIESTRO', 'TAREA',
    'RENOVACION', 'COTIZACION', 'PORTAL', 'GENERAL'
  )),
  variables_disponibles TEXT[],
  mensaje               TEXT NOT NULL,
  mensaje_default       TEXT NOT NULL,
  activa                BOOLEAN DEFAULT TRUE,
  es_sistema            BOOLEAN NOT NULL DEFAULT TRUE,
  editable              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plantillas_whatsapp_codigo  ON plantillas_whatsapp(codigo);
CREATE INDEX IF NOT EXISTS idx_plantillas_whatsapp_contexto ON plantillas_whatsapp(contexto);

-- Trigger updated_at (consistente con resto de tablas - migración 052)
DROP TRIGGER IF EXISTS tg_actualizar_updated_at_plantillas_whatsapp ON plantillas_whatsapp;
CREATE TRIGGER tg_actualizar_updated_at_plantillas_whatsapp
  BEFORE UPDATE ON plantillas_whatsapp
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();

-- RLS: lectura pública (lo lee el frontend para renderizar antes de abrir wa.me),
-- escritura solo via service_role (los endpoints validan admin).
ALTER TABLE plantillas_whatsapp ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plantillas_whatsapp_select ON plantillas_whatsapp;
CREATE POLICY plantillas_whatsapp_select ON plantillas_whatsapp
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS plantillas_whatsapp_admin_all ON plantillas_whatsapp;
CREATE POLICY plantillas_whatsapp_admin_all ON plantillas_whatsapp
  FOR ALL TO authenticated USING (fn_es_admin_actual()) WITH CHECK (fn_es_admin_actual());

-- ─── Seed inicial ───────────────────────────────────────────────────────────
-- 8 plantillas cubriendo todos los lugares del CRM donde se abre wa.me.
-- Tanto `mensaje` como `mensaje_default` se siembran con el mismo texto;
-- al editar, solo `mensaje` cambia, y "Restaurar default" copia mensaje_default.

INSERT INTO plantillas_whatsapp
  (codigo, nombre, descripcion, contexto, variables_disponibles, mensaje, mensaje_default)
VALUES

  ('portal_cliente_acceso',
   'Acceso al Portal del Asegurado',
   'Mensaje con el link permanente al portal del cliente. Se envía al generar/regenerar acceso desde la ficha de persona.',
   'PORTAL',
   ARRAY['nombre', 'apellido', 'url_portal', 'productora_nombre'],
   E'Hola {{nombre}}! Te comparto el acceso a tu portal personal donde podés ver tus pólizas, denunciar siniestros y descargar la documentación:\n\n{{url_portal}}\n\nGuardá el link, está disponible siempre que lo necesites.\n\nSaludos,\n{{productora_nombre}}',
   E'Hola {{nombre}}! Te comparto el acceso a tu portal personal donde podés ver tus pólizas, denunciar siniestros y descargar la documentación:\n\n{{url_portal}}\n\nGuardá el link, está disponible siempre que lo necesites.\n\nSaludos,\n{{productora_nombre}}'
  ),

  ('contacto_persona',
   'Contacto general con cliente',
   'Mensaje genérico de saludo. Se usa en el botón WhatsApp de la ficha de persona.',
   'PERSONA',
   ARRAY['nombre', 'productora_nombre'],
   E'Hola {{nombre}}, te contactamos desde {{productora_nombre}}.\n\nQuedamos a tu disposición ante cualquier consulta.\n\nSaludos.',
   E'Hola {{nombre}}, te contactamos desde {{productora_nombre}}.\n\nQuedamos a tu disposición ante cualquier consulta.\n\nSaludos.'
  ),

  ('info_poliza',
   'Información de póliza',
   'Mensaje para informar sobre una póliza puntual. Se usa en el botón WhatsApp del listado de pólizas.',
   'POLIZA',
   ARRAY['nombre', 'numero_poliza', 'compania', 'ramo', 'productora_nombre'],
   E'Hola {{nombre}}, te informamos sobre tu póliza Nro. {{numero_poliza}} con {{compania}} ({{ramo}}).\n\nQuedamos a tu disposición.\nSaludos,\n{{productora_nombre}}',
   E'Hola {{nombre}}, te informamos sobre tu póliza Nro. {{numero_poliza}} con {{compania}} ({{ramo}}).\n\nQuedamos a tu disposición.\nSaludos,\n{{productora_nombre}}'
  ),

  ('info_siniestro',
   'Novedades de siniestro',
   'Mensaje para informar novedades sobre un siniestro. Se usa en el botón WhatsApp del listado y ficha de siniestros.',
   'SINIESTRO',
   ARRAY['nombre', 'numero_caso', 'productora_nombre'],
   E'Hola {{nombre}}, te contactamos por novedades respecto a tu caso {{numero_caso}}.\n\nQuedamos a tu disposición ante cualquier consulta.\nSaludos,\n{{productora_nombre}}',
   E'Hola {{nombre}}, te contactamos por novedades respecto a tu caso {{numero_caso}}.\n\nQuedamos a tu disposición ante cualquier consulta.\nSaludos,\n{{productora_nombre}}'
  ),

  ('gestion_tarea',
   'Gestión de tarea',
   'Mensaje relacionado a una tarea de seguimiento. Se usa en el botón WhatsApp del listado de tareas.',
   'TAREA',
   ARRAY['nombre', 'titulo_tarea', 'productora_nombre'],
   E'Hola {{nombre}}, te contactamos respecto a: {{titulo_tarea}}.\n\nSaludos,\n{{productora_nombre}}',
   E'Hola {{nombre}}, te contactamos respecto a: {{titulo_tarea}}.\n\nSaludos,\n{{productora_nombre}}'
  ),

  ('recordatorio_renovacion',
   'Recordatorio de renovación',
   'Aviso de vencimiento próximo de póliza. Se usa en el botón WhatsApp del listado de renovaciones.',
   'RENOVACION',
   ARRAY['nombre', 'numero_poliza', 'fecha_fin', 'compania', 'productora_nombre'],
   E'Hola {{nombre}}, te recordamos que tu póliza Nro. {{numero_poliza}} con {{compania}} vence el {{fecha_fin}}.\n\nNos pondremos en contacto para gestionar la renovación.\n\nSaludos,\n{{productora_nombre}}',
   E'Hola {{nombre}}, te recordamos que tu póliza Nro. {{numero_poliza}} con {{compania}} vence el {{fecha_fin}}.\n\nNos pondremos en contacto para gestionar la renovación.\n\nSaludos,\n{{productora_nombre}}'
  ),

  ('envio_cotizacion',
   'Envío de cotización',
   'Mensaje para enviar una cotización armada. Se usa al enviar cotización por WhatsApp desde la ficha de cotización.',
   'COTIZACION',
   ARRAY['nombre', 'numero_cotizacion', 'ramo', 'productora_nombre'],
   E'Hola {{nombre}}, te envío la cotización {{numero_cotizacion}} para {{ramo}}.\n\nQuedo atento a tus comentarios.\nSaludos,\n{{productora_nombre}}',
   E'Hola {{nombre}}, te envío la cotización {{numero_cotizacion}} para {{ramo}}.\n\nQuedo atento a tus comentarios.\nSaludos,\n{{productora_nombre}}'
  ),

  ('contacto_general',
   'Mensaje libre / genérico',
   'Plantilla de fallback cuando no aplica ninguna otra. Solo nombre del cliente y nombre del productor.',
   'GENERAL',
   ARRAY['nombre', 'productora_nombre'],
   E'Hola {{nombre}}, te contactamos desde {{productora_nombre}}.',
   E'Hola {{nombre}}, te contactamos desde {{productora_nombre}}.'
  )

ON CONFLICT (codigo) DO NOTHING;

COMMIT;
