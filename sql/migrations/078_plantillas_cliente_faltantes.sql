-- Migración 078: reagregar plantillas cliente que estaban documentadas en
-- CLAUDE.md pero faltaban en la DB.
--
-- Las plantillas se siembran como `es_sistema=true, editable=true`. El admin las
-- puede editar desde /crm/configuracion/comunicaciones y restaurar al default
-- (campos *_default conservan el seed original).
--
-- Las 5 plantillas:
--   - renovacion_poliza         (POLIZA, auto al activarse renovación)
--   - recordatorio_pago         (POLIZA, manual desde ficha)
--   - notificacion_general      (GENERAL, manual/masivo con {{titulo}}+{{cuerpo_mensaje}})
--   - informativa               (GENERAL, mismo formato que notificacion_general)
--   - portal_cliente_acceso     (PORTAL_CLIENTE, auto al habilitar portal)

BEGIN;

INSERT INTO public.plantillas_email (
  codigo, nombre, descripcion, contexto,
  asunto, asunto_default,
  saludo, saludo_default,
  cuerpo, cuerpo_default,
  cierre, cierre_default,
  variables_disponibles, es_sistema, editable, activa
) VALUES
-- ============================================================================
-- 1. renovacion_poliza
-- ============================================================================
(
  'renovacion_poliza',
  'Renovación de póliza',
  'Se envía automáticamente cuando una póliza renovada se activa (estado RENOVADA → VIGENTE). Adjunta la documentación nueva.',
  'POLIZA',
  'Tu póliza {{numero_poliza}} fue renovada',
  'Tu póliza {{numero_poliza}} fue renovada',
  'Hola {{nombre}}!',
  'Hola {{nombre}}!',
  E'Te informamos que tu póliza fue renovada exitosamente.\n\n• Número de póliza: {{numero_poliza}}\n• Compañía: {{compania}}\n• Ramo: {{ramo}}\n• Vigencia: desde {{fecha_inicio}} hasta {{fecha_fin}}\n• Riesgo asegurado: {{riesgo}}\n\nAdjunto encontrás la documentación actualizada.',
  E'Te informamos que tu póliza fue renovada exitosamente.\n\n• Número de póliza: {{numero_poliza}}\n• Compañía: {{compania}}\n• Ramo: {{ramo}}\n• Vigencia: desde {{fecha_inicio}} hasta {{fecha_fin}}\n• Riesgo asegurado: {{riesgo}}\n\nAdjunto encontrás la documentación actualizada.',
  E'Cualquier consulta, estamos a tu disposición.\n\nSaludos,\n{{productora_nombre}}',
  E'Cualquier consulta, estamos a tu disposición.\n\nSaludos,\n{{productora_nombre}}',
  ARRAY['nombre','apellido','numero_poliza','compania','ramo','fecha_inicio','fecha_fin','riesgo','productora_nombre','productora_telefono','productora_email'],
  true, true, true
),

-- ============================================================================
-- 2. recordatorio_pago
-- ============================================================================
(
  'recordatorio_pago',
  'Recordatorio de pago',
  'Se envía manualmente desde la ficha de la póliza para recordarle al asegurado un pago pendiente o próximo a vencer.',
  'POLIZA',
  'Recordatorio de pago — póliza {{numero_poliza}}',
  'Recordatorio de pago — póliza {{numero_poliza}}',
  'Hola {{nombre}}!',
  'Hola {{nombre}}!',
  E'Te recordamos que tu póliza {{numero_poliza}} ({{compania}} - {{ramo}}) tiene un pago pendiente.\n\nVigencia actual: hasta {{fecha_fin}}.\n\nSi ya hiciste el pago, podés ignorar este mensaje. Cualquier duda, escribinos.',
  E'Te recordamos que tu póliza {{numero_poliza}} ({{compania}} - {{ramo}}) tiene un pago pendiente.\n\nVigencia actual: hasta {{fecha_fin}}.\n\nSi ya hiciste el pago, podés ignorar este mensaje. Cualquier duda, escribinos.',
  E'Quedamos atentos.\n\nSaludos,\n{{productora_nombre}}',
  E'Quedamos atentos.\n\nSaludos,\n{{productora_nombre}}',
  ARRAY['nombre','apellido','numero_poliza','compania','ramo','fecha_inicio','fecha_fin','productora_nombre','productora_telefono','productora_email'],
  true, true, true
),

-- ============================================================================
-- 3. notificacion_general
-- ============================================================================
(
  'notificacion_general',
  'Notificación general',
  'Plantilla genérica para envíos manuales y masivos. Usa {{titulo}} para el encabezado y {{cuerpo_mensaje}} para el contenido principal.',
  'GENERAL',
  '{{titulo}}',
  '{{titulo}}',
  'Hola {{nombre}}!',
  'Hola {{nombre}}!',
  '{{cuerpo_mensaje}}',
  '{{cuerpo_mensaje}}',
  E'Saludos,\n{{productora_nombre}}',
  E'Saludos,\n{{productora_nombre}}',
  ARRAY['nombre','apellido','email','titulo','cuerpo_mensaje','productora_nombre','productora_telefono','productora_email'],
  true, true, true
),

-- ============================================================================
-- 4. informativa
-- ============================================================================
(
  'informativa',
  'Informativa',
  'Plantilla informativa con el mismo formato que notificacion_general. Pensada para avisos institucionales (cambios de horario, recordatorios, etc.).',
  'GENERAL',
  '{{titulo}}',
  '{{titulo}}',
  'Hola {{nombre}}!',
  'Hola {{nombre}}!',
  '{{cuerpo_mensaje}}',
  '{{cuerpo_mensaje}}',
  E'Saludos cordiales,\n{{productora_nombre}}',
  E'Saludos cordiales,\n{{productora_nombre}}',
  ARRAY['nombre','apellido','email','titulo','cuerpo_mensaje','productora_nombre','productora_telefono','productora_email'],
  true, true, true
),

-- ============================================================================
-- 5. portal_cliente_acceso
-- ============================================================================
(
  'portal_cliente_acceso',
  'Acceso al Portal del Cliente',
  'Se envía automáticamente cuando el admin habilita el portal para un cliente. Incluye el link permanente al portal.',
  'PORTAL_CLIENTE',
  'Tu acceso al Portal de Clientes',
  'Tu acceso al Portal de Clientes',
  'Hola {{nombre}}!',
  'Hola {{nombre}}!',
  E'Te habilitamos el acceso a nuestro Portal del Cliente donde vas a poder consultar tus pólizas, siniestros y los teléfonos de asistencia 24hs de las compañías en cualquier momento.\n\nUsá este link para entrar. Guardalo en favoritos:\n\n{{url_portal}}',
  E'Te habilitamos el acceso a nuestro Portal del Cliente donde vas a poder consultar tus pólizas, siniestros y los teléfonos de asistencia 24hs de las compañías en cualquier momento.\n\nUsá este link para entrar. Guardalo en favoritos:\n\n{{url_portal}}',
  E'Cualquier duda, escribinos.\n\nSaludos,\n{{productora_nombre}}',
  E'Cualquier duda, escribinos.\n\nSaludos,\n{{productora_nombre}}',
  ARRAY['nombre','apellido','email','url_portal','productora_nombre','productora_telefono','productora_email'],
  true, true, true
)

ON CONFLICT (codigo) DO NOTHING;

COMMIT;
