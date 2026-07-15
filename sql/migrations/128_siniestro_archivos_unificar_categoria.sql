-- ═══════════════════════════════════════════════════════════════
-- 128_siniestro_archivos_unificar_categoria.sql
--
-- Unifica las categorías 'fotos' y 'documentacion' en siniestro_archivos.
-- Desde v1.0.124 la ficha del siniestro tiene UNA sola sección
-- ("Archivos del siniestro") en lugar de dos separadas. Motivo: la sección
-- "Fotos" siempre quedaba vacía porque el formulario público subía todo
-- como 'documentacion'.
--
-- Los archivos físicos NO se mueven — el path guardado en la columna
-- `ruta` sigue apuntando a `.../fotos/archivo.ext` para los registros
-- legacy, y el endpoint que sirve archivos lee de esa ruta directamente
-- sin componer nada por categoría. La migración solo cambia el label en
-- DB para que aparezcan en el gestor unificado.
--
-- Idempotente: si vuelve a correr, no encuentra nada que actualizar.
-- ═══════════════════════════════════════════════════════════════

UPDATE siniestro_archivos
SET categoria = 'documentacion'
WHERE categoria = 'fotos';

-- Nota: el union type TS de SiniestroArchivo.categoria mantiene 'fotos'
-- por retrocompat con backups viejos que se restauren. Los datos nuevos
-- nunca reciben 'fotos' porque:
--   1. El form público (/api/publico/siniestros) solo crea 'documentacion'.
--   2. El endpoint /api/storage/upload normaliza 'fotos' → 'documentacion'
--      silenciosamente si algún cliente viejo lo sigue enviando.
