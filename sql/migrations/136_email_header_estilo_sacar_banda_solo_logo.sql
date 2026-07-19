-- ============================================================================
-- Migración 136 — v1.0.152
-- Eliminar la variante 'banda_solo_logo' del selector de encabezado.
-- ============================================================================
--
-- Contexto: la variante 'banda_solo_logo' (v1.0.150) mostraba el logo grande
-- centrado sobre un cuadro blanco con fondo del color de marca. Nahuel decidió
-- sacarla — queda solo 'blanco_solo_logo' como opción "solo logo".
--
-- Esta migración:
--   1. Migra cualquier registro con 'banda_solo_logo' a 'blanco_solo_logo'
--      (defensive — puede haber quedado de pruebas locales).
--   2. Recrea el CHECK constraint con los 4 valores válidos: banda, compacto,
--      lateral, blanco_solo_logo.
--
-- Idempotente: idempotency check en el UPDATE + IF EXISTS en el DROP.
-- ============================================================================

-- Paso 1: migrar filas existentes con el valor a eliminar
UPDATE configuracion
   SET email_header_estilo = 'blanco_solo_logo'
 WHERE email_header_estilo = 'banda_solo_logo';

-- Paso 2: recrear el CHECK constraint sin 'banda_solo_logo'
ALTER TABLE configuracion
  DROP CONSTRAINT IF EXISTS configuracion_email_header_estilo_check;

ALTER TABLE configuracion
  ADD CONSTRAINT configuracion_email_header_estilo_check
  CHECK (email_header_estilo IN (
    'banda',
    'compacto',
    'lateral',
    'blanco_solo_logo'
  ));

COMMENT ON COLUMN configuracion.email_header_estilo IS
  'v1.0.152. Estilo del encabezado de emails. Valores: banda (default), compacto, lateral, blanco_solo_logo (solo logo sobre fondo blanco con barra de acento en color de marca).';
