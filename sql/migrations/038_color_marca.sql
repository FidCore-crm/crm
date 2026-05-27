-- Migración 038: color de marca personalizable del PAS
--
-- Agrega un color único configurable en la tabla configuracion. Solo afecta
-- superficies cara al asegurado (PDFs de cotización, emails al cliente, portal
-- del asegurado, formulario público de denuncia). El CRM interno NO usa este
-- color: mantiene su paleta navy/grises.
--
-- Default: '#0A1628' (el navy actual del sidebar — preserva el look para
-- cualquier instalación previa).

ALTER TABLE configuracion
  ADD COLUMN IF NOT EXISTS color_marca VARCHAR(7) NOT NULL DEFAULT '#0A1628';

ALTER TABLE configuracion
  DROP CONSTRAINT IF EXISTS configuracion_color_marca_format;

ALTER TABLE configuracion
  ADD CONSTRAINT configuracion_color_marca_format
  CHECK (color_marca ~ '^#[0-9a-fA-F]{6}$');

COMMENT ON COLUMN configuracion.color_marca IS
  'Color hex (#RRGGBB) de marca del PAS. Aplica solo a superficies cara al asegurado: PDFs cotización, emails, portal cliente, formulario denuncia. Elegible desde una paleta predefinida en /crm/configuracion/perfil.';
