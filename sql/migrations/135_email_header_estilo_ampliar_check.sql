-- ============================================================================
-- Migración 135 — v1.0.151
-- Ampliar CHECK de configuracion.email_header_estilo con las 2 variantes
-- "solo logo" agregadas en v1.0.150.
-- ============================================================================
--
-- Contexto: v1.0.150 agregó los estilos 'banda_solo_logo' y 'blanco_solo_logo'
-- al frontend pero el CHECK constraint de DB seguía permitiendo solo los 3
-- valores originales ('banda', 'compacto', 'lateral'). Al intentar guardar
-- desde /crm/configuracion/perfil aparecía el mensaje "los datos cargados
-- no cumplen las validaciones" — es el CHECK rechazando el INSERT.
--
-- Fix: dropear el CHECK viejo y recrear con los 5 valores válidos.
--
-- Idempotente: el DROP CONSTRAINT usa IF EXISTS y el ADD CONSTRAINT tiene
-- nombre único. Puede correr N veces sin efectos.
-- ============================================================================

ALTER TABLE configuracion
  DROP CONSTRAINT IF EXISTS configuracion_email_header_estilo_check;

ALTER TABLE configuracion
  ADD CONSTRAINT configuracion_email_header_estilo_check
  CHECK (email_header_estilo IN (
    'banda',
    'compacto',
    'lateral',
    'banda_solo_logo',
    'blanco_solo_logo'
  ));

COMMENT ON COLUMN configuracion.email_header_estilo IS
  'v1.0.150. Estilo del encabezado de emails. Valores: banda (default), compacto, lateral, banda_solo_logo (solo logo sobre color de marca), blanco_solo_logo (solo logo sobre blanco con barra de acento).';
