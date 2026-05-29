-- Migración 087 — Sacar la última mención a "productora" del schema.
--
-- La columna `mailing_plantillas.variables_disponibles` tenía como DEFAULT un
-- array que listaba `productora_nombre/telefono/email`. Aunque la tabla está
-- vacía (no afecta data existente), cuando un PAS cree su primera plantilla
-- el array por defecto se llenaría con los nombres viejos.
--
-- Cambiamos el DEFAULT a los nombres canónicos `organizacion_*`.

BEGIN;

ALTER TABLE public.mailing_plantillas
  ALTER COLUMN variables_disponibles
  SET DEFAULT '{nombre,apellido,email,organizacion_nombre,organizacion_telefono,organizacion_email}'::text[];

-- Idempotente: si en el futuro alguien creó una plantilla antes de esta
-- migración, le actualizamos el array reemplazando los nombres viejos.
UPDATE public.mailing_plantillas
SET variables_disponibles = array(
  SELECT CASE v
    WHEN 'productora_nombre'   THEN 'organizacion_nombre'
    WHEN 'productora_telefono' THEN 'organizacion_telefono'
    WHEN 'productora_email'    THEN 'organizacion_email'
    WHEN 'productora_logo'     THEN 'organizacion_logo'
    WHEN 'productora_color_marca' THEN 'organizacion_color_marca'
    ELSE v
  END
  FROM unnest(variables_disponibles) AS v
)
WHERE 'productora_nombre' = ANY(variables_disponibles)
   OR 'productora_telefono' = ANY(variables_disponibles)
   OR 'productora_email' = ANY(variables_disponibles)
   OR 'productora_logo' = ANY(variables_disponibles)
   OR 'productora_color_marca' = ANY(variables_disponibles);

COMMIT;
