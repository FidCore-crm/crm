-- ============================================================================
-- Migración 099: agregar fecha_nacimiento a personas
-- ============================================================================
-- Campo opcional, solo aplica a personas físicas (las jurídicas quedan en NULL).
-- ============================================================================

ALTER TABLE personas
  ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE;
