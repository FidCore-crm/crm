-- v1.0.154: el toggle "ocultar nombre en header" fue eliminado del perfil en
-- v1.0.152 pero el renderer y los endpoints de preview seguían respetando el
-- valor. Efecto colateral: instalaciones donde el PAS activó el toggle antes
-- de v1.0.152 quedaron con "nombre oculto" persistente — al cambiar el estilo
-- desde el perfil, el logo aparecía centrado sin nombre en todas las variantes.
--
-- Esta migración pone el flag en false para todas las instalaciones para
-- garantizar que ningún registro histórico "arrastre" el bug. La columna
-- se conserva por compat con backups anteriores.

UPDATE configuracion
   SET email_header_ocultar_nombre = false
 WHERE email_header_ocultar_nombre = true;
