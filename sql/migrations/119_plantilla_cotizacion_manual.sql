-- Plantilla editable para el email de cotización manual
--
-- Antes, el email que salía al apretar "Enviar por email" desde la ficha de
-- cotización usaba 2 campos de texto guardados en `configuracion`
-- (cotizacion_email_asunto_template + cotizacion_email_cuerpo_template) y
-- piggybackeaba sobre la plantilla `notificacion_general`. Esos 2 campos
-- solo permitían editar asunto + cuerpo plano, sin los 4 bloques
-- (asunto/saludo/cuerpo/cierre) ni la preview visual que tienen las demás.
--
-- Esta migración crea la plantilla real `cotizacion_manual` en la tabla
-- `plantillas_email` para que el PAS la edite igual que bienvenida_poliza,
-- renovacion_poliza, etc. desde /crm/configuracion/comunicaciones. La ficha
-- de cotización pasa a usarla directamente.
--
-- Los 2 campos legacy quedan en `configuracion` por si alguna instalación
-- tenía datos ahí, pero la UI del perfil ya no los expone. Migración
-- futura los puede eliminar cuando estemos seguros que nadie los usa.

-- Idempotencia: si ya existe (por reintento) no hacemos nada.
INSERT INTO plantillas_email (
  codigo, nombre, contexto,
  asunto, asunto_default,
  saludo, saludo_default,
  cuerpo, cuerpo_default,
  cierre, cierre_default,
  variables_disponibles,
  activa, es_sistema, editable
)
VALUES (
  'cotizacion_manual',
  'Envío de cotización por email',
  'GENERAL',

  -- Asunto
  'Cotización N° {{numero_cotizacion}} - {{ramo}}',
  'Cotización N° {{numero_cotizacion}} - {{ramo}}',

  -- Saludo
  'Hola {{nombre}},',
  'Hola {{nombre}},',

  -- Cuerpo
  'Como te habíamos comentado, te acercamos la cotización N° {{numero_cotizacion}} correspondiente al ramo {{ramo}}.

En el PDF adjunto vas a encontrar el detalle completo de las {{cantidad_opciones}} compañías cotizadas, con las coberturas comparadas para que puedas evaluar la que más te convenga.

Cualquier duda o consulta, quedamos a disposición.',
  'Como te habíamos comentado, te acercamos la cotización N° {{numero_cotizacion}} correspondiente al ramo {{ramo}}.

En el PDF adjunto vas a encontrar el detalle completo de las {{cantidad_opciones}} compañías cotizadas, con las coberturas comparadas para que puedas evaluar la que más te convenga.

Cualquier duda o consulta, quedamos a disposición.',

  -- Cierre
  'Saludos cordiales,
{{organizacion_nombre}}',
  'Saludos cordiales,
{{organizacion_nombre}}',

  -- Variables disponibles (las que el sender inyecta al llamar)
  ARRAY[
    'nombre',
    'apellido',
    'numero_cotizacion',
    'ramo',
    'cantidad_opciones',
    'organizacion_nombre',
    'organizacion_telefono',
    'organizacion_email'
  ],

  true,    -- activa
  true,    -- es_sistema (ver decision_plantillas_email_filtro_codigo — todas son true, el filtro real es por prefijo)
  true     -- editable
)
ON CONFLICT (codigo) DO NOTHING;
