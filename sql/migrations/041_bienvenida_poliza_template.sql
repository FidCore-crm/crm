-- ============================================================
-- Migración 041: Plantilla bienvenida_poliza + rename portal
-- ============================================================
-- 1) Inserta la plantilla `bienvenida_poliza` que faltaba en la DB.
--    Esto hace que aparezca en el editor de plantillas para que el PAS
--    pueda personalizarla.
-- 2) Renombra el `nombre` legible de `portal_cliente_acceso` a "Acceso
--    al Portal del Asegurado" para acompañar el rename UI ya hecho.
--
-- Idempotente: si la plantilla ya existe no la pisa.
-- ============================================================

BEGIN;

INSERT INTO plantillas_email (
  codigo, nombre, descripcion, contexto,
  asunto, saludo, cuerpo, cierre,
  asunto_default, saludo_default, cuerpo_default, cierre_default,
  variables_disponibles, es_sistema, editable
)
VALUES (
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
  ARRAY['nombre','apellido','numero_poliza','compania','ramo','fecha_inicio','fecha_fin','riesgo','productora_nombre','productora_telefono','productora_email']::text[],
  true,
  true
)
ON CONFLICT (codigo) DO NOTHING;

-- Acompañar el rename UI: "Portal del Cliente" → "Portal del Asegurado"
UPDATE plantillas_email
   SET nombre = 'Acceso al Portal del Asegurado',
       descripcion = 'Email con el link de acceso permanente al portal del asegurado'
 WHERE codigo = 'portal_cliente_acceso';

COMMIT;
