-- ============================================================================
-- Migración 063: Wizard de onboarding al primer login
--
-- Agrega 3 columnas a `configuracion`:
--   - onboarding_completado_at: NULL = el admin todavía no terminó el wizard.
--     Cuando termina, se setea a NOW(). El guard del layout chequea este campo
--     para redirigir a /crm/onboarding si está NULL.
--   - onboarding_paso_actual: índice del paso actual (0-based). Permite que el
--     PAS cierre el browser y al volver retome desde donde estaba.
--   - usar_logo: si false, el CRM muestra solo el nombre de la organización en
--     todos los lugares donde habitualmente iría el logo (sidebar, login,
--     emails, PDF cotización, portal cliente, denuncia). Para PAS que no
--     tienen logo o no quieren usar uno.
--
-- Idempotente: si las columnas ya existen, no hace nada.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'configuracion'
      AND column_name = 'onboarding_completado_at'
  ) THEN
    ALTER TABLE configuracion ADD COLUMN onboarding_completado_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'configuracion'
      AND column_name = 'onboarding_paso_actual'
  ) THEN
    ALTER TABLE configuracion ADD COLUMN onboarding_paso_actual INTEGER NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'configuracion'
      AND column_name = 'usar_logo'
  ) THEN
    ALTER TABLE configuracion ADD COLUMN usar_logo BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;

-- Backfill: cualquier configuración existente se considera "ya onboarded"
-- para no forzar el wizard en instalaciones previas a esta migración.
UPDATE configuracion
SET onboarding_completado_at = COALESCE(onboarding_completado_at, NOW())
WHERE onboarding_completado_at IS NULL
  AND nombre IS NOT NULL;

-- Para configuraciones vacías (instalaciones nuevas, donde nombre es NULL)
-- dejamos onboarding_completado_at en NULL para que el wizard se dispare.

COMMENT ON COLUMN configuracion.onboarding_completado_at IS
  'Timestamp en que el admin completó el wizard de onboarding. NULL = wizard pendiente.';
COMMENT ON COLUMN configuracion.onboarding_paso_actual IS
  'Índice 0-based del paso actual del wizard. Permite retomar tras cerrar el browser.';
COMMENT ON COLUMN configuracion.usar_logo IS
  'Si false, el CRM muestra solo el nombre de la organización donde iría el logo.';
