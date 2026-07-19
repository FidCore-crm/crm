-- ============================================================================
-- Migración 134 — v1.0.149
-- Toggle universal "ocultar nombre en header" de emails
-- ============================================================================
--
-- Contexto: algunos logos del PAS ya traen el nombre integrado en el diseño
-- (ej: "Seguros Pérez" escrito adentro del logo). Cuando el renderer del
-- email pone el nombre AL LADO del logo, queda redundante.
--
-- Alternativas descartadas:
--   - Variantes nuevas separadas (banda_solo_logo, blanco_solo_logo):
--     más rígido, obliga al PAS a elegir un layout específico.
--
-- Elegido: checkbox universal. El PAS mantiene su variante preferida
-- (banda / compacto / lateral) y decide por separado si oculta el nombre.
-- Cuando el flag está en true:
--   - El renderer no dibuja el <p>/<span> con el nombre.
--   - El logo puede ocupar más espacio horizontal (el celda de nombre
--     queda vacía y el logo se centra o expande).
--
-- Idempotente: usa IF NOT EXISTS. Puede correr N veces sin efectos.
-- ============================================================================

ALTER TABLE configuracion
  ADD COLUMN IF NOT EXISTS email_header_ocultar_nombre BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN configuracion.email_header_ocultar_nombre IS
  'v1.0.149. Si es true, el renderer de emails no pinta el nombre de la organización en el header — útil cuando el logo ya lo incluye en su diseño. Aplica a las 3 variantes (banda/compacto/lateral).';
