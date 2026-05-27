-- Migración 068: completar textos predefinidos de plantillas de email
--
-- 5 plantillas quedaron sin saludo/cuerpo/cierre desde la migración del
-- sistema de comunicaciones (013 y posteriores). El editor del PAS las muestra
-- vacías. Acá las completamos con textos predefinidos coherentes por contexto.
--
-- Se setean tanto `saludo`/`cuerpo`/`cierre` (texto actual) como sus _default
-- (referencia para "Restaurar default"). Si el PAS ya tocó alguna, este UPDATE
-- la va a pisar — riesgo aceptable porque estaban vacías y el upgrade los
-- completa con algo razonable.

BEGIN;

-- ─── 1. portal_cliente_acceso ───────────────────────────────────────────────
UPDATE plantillas_email SET
  saludo         = E'Hola {{nombre}},',
  saludo_default = E'Hola {{nombre}},',
  cuerpo         = E'Habilitamos tu portal personal en {{productora_nombre}}. Desde ahí podés:\n\n• Consultar tus pólizas vigentes y descargar la documentación\n• Ver el estado de tus siniestros en curso\n• Denunciar un nuevo siniestro las 24 horas\n• Acceder a los teléfonos de asistencia de cada compañía\n\nGuardá el link en favoritos — el acceso es permanente y no requiere contraseña.\n\n{{boton_accion}}',
  cuerpo_default = E'Habilitamos tu portal personal en {{productora_nombre}}. Desde ahí podés:\n\n• Consultar tus pólizas vigentes y descargar la documentación\n• Ver el estado de tus siniestros en curso\n• Denunciar un nuevo siniestro las 24 horas\n• Acceder a los teléfonos de asistencia de cada compañía\n\nGuardá el link en favoritos — el acceso es permanente y no requiere contraseña.\n\n{{boton_accion}}',
  cierre         = E'Cualquier consulta estamos a tu disposición.\n\nSaludos,\n{{productora_nombre}}',
  cierre_default = E'Cualquier consulta estamos a tu disposición.\n\nSaludos,\n{{productora_nombre}}'
WHERE codigo = 'portal_cliente_acceso';

-- ─── 2. renovacion_poliza ───────────────────────────────────────────────────
UPDATE plantillas_email SET
  saludo         = E'Hola {{nombre}},',
  saludo_default = E'Hola {{nombre}},',
  cuerpo         = E'Te confirmamos que tu póliza de {{ramo}} con {{compania}} fue renovada correctamente.\n\n📄 Número de póliza: {{numero_poliza}}\n🏢 Compañía: {{compania}}\n📅 Vigencia: del {{fecha_inicio}} al {{fecha_fin}}\n🚗 Bien asegurado: {{riesgo}}\n\nAdjuntamos la documentación de la nueva vigencia. Te recomendamos guardar el PDF en tu teléfono para tenerlo siempre a mano.',
  cuerpo_default = E'Te confirmamos que tu póliza de {{ramo}} con {{compania}} fue renovada correctamente.\n\n📄 Número de póliza: {{numero_poliza}}\n🏢 Compañía: {{compania}}\n📅 Vigencia: del {{fecha_inicio}} al {{fecha_fin}}\n🚗 Bien asegurado: {{riesgo}}\n\nAdjuntamos la documentación de la nueva vigencia. Te recomendamos guardar el PDF en tu teléfono para tenerlo siempre a mano.',
  cierre         = E'Gracias por seguir confiando en nosotros.\n\nSaludos,\n{{productora_nombre}}\n{{productora_telefono}}',
  cierre_default = E'Gracias por seguir confiando en nosotros.\n\nSaludos,\n{{productora_nombre}}\n{{productora_telefono}}'
WHERE codigo = 'renovacion_poliza';

-- ─── 3. recordatorio_pago ───────────────────────────────────────────────────
UPDATE plantillas_email SET
  saludo         = E'Hola {{nombre}},',
  saludo_default = E'Hola {{nombre}},',
  cuerpo         = E'Te escribimos para recordarte que tenés un vencimiento pendiente en tu póliza de {{ramo}} con {{compania}}.\n\n📄 Número de póliza: {{numero_poliza}}\n\nTe pedimos que regularices el pago a la brevedad para evitar interrupciones en la cobertura. Si ya pagaste, ignorá este mensaje.\n\nAnte cualquier duda sobre cómo abonar o si necesitás cambiar el medio de pago, escribinos.',
  cuerpo_default = E'Te escribimos para recordarte que tenés un vencimiento pendiente en tu póliza de {{ramo}} con {{compania}}.\n\n📄 Número de póliza: {{numero_poliza}}\n\nTe pedimos que regularices el pago a la brevedad para evitar interrupciones en la cobertura. Si ya pagaste, ignorá este mensaje.\n\nAnte cualquier duda sobre cómo abonar o si necesitás cambiar el medio de pago, escribinos.',
  cierre         = E'Quedamos atentos.\n\nSaludos,\n{{productora_nombre}}\n{{productora_telefono}}',
  cierre_default = E'Quedamos atentos.\n\nSaludos,\n{{productora_nombre}}\n{{productora_telefono}}'
WHERE codigo = 'recordatorio_pago';

-- ─── 4. notificacion_general ───────────────────────────────────────────────
-- Plantilla flexible: el PAS personaliza asunto + cuerpo via variables.
UPDATE plantillas_email SET
  saludo         = E'Hola {{nombre}},',
  saludo_default = E'Hola {{nombre}},',
  cuerpo         = E'{{titulo}}\n\n{{cuerpo_mensaje}}',
  cuerpo_default = E'{{titulo}}\n\n{{cuerpo_mensaje}}',
  cierre         = E'Cualquier consulta estamos a tu disposición.\n\nSaludos,\n{{productora_nombre}}\n{{productora_telefono}}',
  cierre_default = E'Cualquier consulta estamos a tu disposición.\n\nSaludos,\n{{productora_nombre}}\n{{productora_telefono}}',
  variables_disponibles = ARRAY['nombre','apellido','titulo','cuerpo_mensaje','productora_nombre','productora_telefono','productora_email']
WHERE codigo = 'notificacion_general';

-- ─── 5. informativa ────────────────────────────────────────────────────────
-- Variante simple de notificacion_general: solo asunto + cuerpo, sin "saludo
-- enfático". Para avisos cortos no transaccionales.
UPDATE plantillas_email SET
  saludo         = E'Hola {{nombre}},',
  saludo_default = E'Hola {{nombre}},',
  cuerpo         = E'{{cuerpo_mensaje}}',
  cuerpo_default = E'{{cuerpo_mensaje}}',
  cierre         = E'Saludos,\n{{productora_nombre}}',
  cierre_default = E'Saludos,\n{{productora_nombre}}',
  variables_disponibles = ARRAY['nombre','apellido','cuerpo_mensaje','productora_nombre','productora_telefono','productora_email']
WHERE codigo = 'informativa';

COMMIT;
