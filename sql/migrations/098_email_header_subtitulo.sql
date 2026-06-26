-- Migración 098: subtítulo editable del encabezado de emails.
--
-- En la variante 'banda' del encabezado de emails aparece un subtítulo
-- debajo del nombre de la organización (antes hardcoded como "Productor
-- Asesor de Seguros"). Ahora es editable desde /crm/configuracion/perfil.
--
-- Backfill condicional: las instalaciones existentes reciben un texto
-- sensible según su tipo de operación.

ALTER TABLE configuracion
  ADD COLUMN IF NOT EXISTS email_header_subtitulo VARCHAR(80);

UPDATE configuracion
  SET email_header_subtitulo = CASE
    WHEN tipo_operacion = 'SOCIEDAD' THEN 'Sociedad de Productores Asesores de Seguros'
    ELSE 'Productor Asesor de Seguros'
  END
  WHERE email_header_subtitulo IS NULL;

ALTER TABLE configuracion
  ALTER COLUMN email_header_subtitulo SET DEFAULT '';

ALTER TABLE configuracion
  ALTER COLUMN email_header_subtitulo SET NOT NULL;
