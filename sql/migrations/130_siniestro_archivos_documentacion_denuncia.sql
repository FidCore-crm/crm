-- ══════════════════════════════════════════════════════════════════════════════
-- Migración 130: agregar categoría 'documentacion_denuncia' a siniestro_archivos
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Contexto:
--   Hasta v1.0.133 existía una sola categoría de archivos ('documentacion')
--   que mezclaba lo que subía el asegurado al denunciar + lo que el PAS
--   agregaba manualmente. Todo era visible en la ficha del CRM y (por bug
--   del portal) también en el portal del asegurado.
--
--   A partir de v1.0.134 se separan en 2 categorías:
--
--     'documentacion'          → la que sube el ASEGURADO al hacer la denuncia
--                                (fotos del choque, DNI del conductor, cédula
--                                verde, etc.). NO se muestra en el portal
--                                (el asegurado ya la tiene) — solo la ve el PAS.
--
--     'documentacion_denuncia' → la que sube el PAS en la ficha del siniestro
--                                (denuncia administrativa presentada a la
--                                compañía, certificado de cobertura, carta
--                                de franquicia, respuestas de la compañía).
--                                SÍ se muestra en el portal del asegurado
--                                para que la descargue.
--
--   La categoría 'fotos' quedaba del modelo previo y se unificó en la
--   migración 128 (todos los 'fotos' se movieron a 'documentacion').
--   La dejamos en el CHECK por compat de backups viejos que se restauren.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Reemplazar el CHECK constraint
ALTER TABLE siniestro_archivos
  DROP CONSTRAINT IF EXISTS siniestro_archivos_categoria_check;

ALTER TABLE siniestro_archivos
  ADD CONSTRAINT siniestro_archivos_categoria_check
  CHECK (categoria IN ('fotos', 'documentacion', 'documentacion_denuncia'));

COMMIT;
