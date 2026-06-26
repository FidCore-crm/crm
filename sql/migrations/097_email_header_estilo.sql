-- Migración 097: estilo de encabezado de emails (banda / compacto / lateral).
--
-- Permite al PAS elegir entre 3 variantes de header para los emails que
-- envía el CRM. Default 'banda' (replica el comportamiento previo más cerca
-- del header navy con logo a la izquierda).
--
-- - banda: banda horizontal con gradient del color de marca, logo en cuadro
--          blanco a la izquierda, nombre + subtítulo a la derecha, barra
--          de acento fina debajo.
-- - compacto: header bajo con gradient, nombre a la izquierda, cuadrito del
--             logo a la derecha. Más espacio para el cuerpo.
-- - lateral: sin bloque de color en el header; el contenedor del email
--            recibe un border-top de 5px en color de marca, logo en cuadro
--            con color de marca, nombre en color de marca. Estilo aireado.

ALTER TABLE configuracion
  ADD COLUMN IF NOT EXISTS email_header_estilo VARCHAR(20)
    NOT NULL DEFAULT 'banda'
    CHECK (email_header_estilo IN ('banda', 'compacto', 'lateral'));
