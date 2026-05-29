-- Migración 086 — Eliminar el término "productora" del sistema.
--
-- Decisión del producto: la palabra "productora" no se usa más. En su lugar
-- hablamos del PAS (Productor Asesor de Seguros) o de la organización
-- (cuando es una SRL/SA/sociedad de productores). Esta migración:
--
--   1. Renombra las variables de plantilla {{productora_X}} → {{organizacion_X}}
--      en TODAS las plantillas activas (asunto, saludo, cuerpo, cierre +
--      versiones _default).
--   2. Reemplaza la palabra "Productora" / "productora" en los textos visibles
--      al usuario dentro de las plantillas de email y WhatsApp.
--
-- IMPORTANTE: el código mantiene `productora_*` como ALIAS de
-- `organizacion_*` en `email-variables.ts` por si quedó alguna plantilla
-- en otro lugar que las use. Las plantillas nuevas usan exclusivamente
-- `organizacion_*`.

BEGIN;

-- ============================================================================
-- 1) Renombrar variables {{productora_X}} → {{organizacion_X}}
--    en plantillas_email (TODOS los campos editables + sus *_default)
-- ============================================================================

UPDATE public.plantillas_email SET
  asunto          = regexp_replace(asunto,          '\{\{\s*productora_(\w+)\s*\}\}', '{{organizacion_\1}}', 'g'),
  saludo          = regexp_replace(saludo,          '\{\{\s*productora_(\w+)\s*\}\}', '{{organizacion_\1}}', 'g'),
  cuerpo          = regexp_replace(cuerpo,          '\{\{\s*productora_(\w+)\s*\}\}', '{{organizacion_\1}}', 'g'),
  cierre          = regexp_replace(cierre,          '\{\{\s*productora_(\w+)\s*\}\}', '{{organizacion_\1}}', 'g'),
  asunto_default  = regexp_replace(asunto_default,  '\{\{\s*productora_(\w+)\s*\}\}', '{{organizacion_\1}}', 'g'),
  saludo_default  = regexp_replace(saludo_default,  '\{\{\s*productora_(\w+)\s*\}\}', '{{organizacion_\1}}', 'g'),
  cuerpo_default  = regexp_replace(cuerpo_default,  '\{\{\s*productora_(\w+)\s*\}\}', '{{organizacion_\1}}', 'g'),
  cierre_default  = regexp_replace(cierre_default,  '\{\{\s*productora_(\w+)\s*\}\}', '{{organizacion_\1}}', 'g');

-- ============================================================================
-- 2) Reemplazar textos visibles dentro de plantillas_email
--    Solo donde aparece la palabra como término del rubro (no en variables).
-- ============================================================================

UPDATE public.plantillas_email SET
  asunto          = replace(replace(asunto,         'Productora', 'PAS u Organización'), 'productora', 'PAS u Organización'),
  saludo          = replace(replace(saludo,         'Productora', 'PAS u Organización'), 'productora', 'PAS u Organización'),
  cuerpo          = replace(replace(cuerpo,         'Productora', 'PAS u Organización'), 'productora', 'PAS u Organización'),
  cierre          = replace(replace(cierre,         'Productora', 'PAS u Organización'), 'productora', 'PAS u Organización'),
  asunto_default  = replace(replace(asunto_default, 'Productora', 'PAS u Organización'), 'productora', 'PAS u Organización'),
  saludo_default  = replace(replace(saludo_default, 'Productora', 'PAS u Organización'), 'productora', 'PAS u Organización'),
  cuerpo_default  = replace(replace(cuerpo_default, 'Productora', 'PAS u Organización'), 'productora', 'PAS u Organización'),
  cierre_default  = replace(replace(cierre_default, 'Productora', 'PAS u Organización'), 'productora', 'PAS u Organización')
WHERE
  asunto LIKE '%roductora%' OR saludo LIKE '%roductora%' OR
  cuerpo LIKE '%roductora%' OR cierre LIKE '%roductora%' OR
  asunto_default LIKE '%roductora%' OR saludo_default LIKE '%roductora%' OR
  cuerpo_default LIKE '%roductora%' OR cierre_default LIKE '%roductora%';

-- ============================================================================
-- 3) Renombrar variables + textos en plantillas_whatsapp si existe la tabla
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'plantillas_whatsapp') THEN
    EXECUTE $sql$
      UPDATE public.plantillas_whatsapp SET
        mensaje         = regexp_replace(mensaje,         '\{\{\s*productora_(\w+)\s*\}\}', '{{organizacion_\1}}', 'g'),
        mensaje_default = regexp_replace(mensaje_default, '\{\{\s*productora_(\w+)\s*\}\}', '{{organizacion_\1}}', 'g')
    $sql$;
    EXECUTE $sql$
      UPDATE public.plantillas_whatsapp SET
        mensaje         = replace(replace(mensaje,         'Productora', 'PAS u Organización'), 'productora', 'PAS u Organización'),
        mensaje_default = replace(replace(mensaje_default, 'Productora', 'PAS u Organización'), 'productora', 'PAS u Organización')
      WHERE mensaje LIKE '%roductora%' OR mensaje_default LIKE '%roductora%'
    $sql$;
  END IF;
END $$;

COMMIT;
