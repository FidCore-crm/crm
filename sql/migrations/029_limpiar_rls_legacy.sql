-- ============================================================
-- 029_limpiar_rls_legacy.sql
--
-- Las migraciones 026 (personas) y 028 (siniestros) endurecieron RLS
-- creando policies "*_select_anon" pero NO eliminaron las policies legacy
-- "desarrollo_*" / "acceso_*" / "Usuarios autenticados *" que tenían
-- USING true sobre INSERT/UPDATE/DELETE — anulando el endurecimiento.
--
-- Esta migración elimina esas policies legacy SOLO en las tablas ya
-- auditadas (personas, siniestros y sus relacionadas). Las demás tablas
-- conservan sus policies legacy y se limpiarán cuando se audite cada módulo.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- personas
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "desarrollo_select" ON personas;
DROP POLICY IF EXISTS "desarrollo_insert" ON personas;
DROP POLICY IF EXISTS "desarrollo_update" ON personas;
DROP POLICY IF EXISTS "desarrollo_delete" ON personas;
DROP POLICY IF EXISTS "Usuarios autenticados pueden ver todo" ON personas;

-- Verificar que la policy creada por 026 sigue presente; si no, recrearla.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'personas' AND policyname = 'personas_select_anon'
  ) THEN
    CREATE POLICY "personas_select_anon" ON personas FOR SELECT USING (true);
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- siniestros
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "desarrollo_select" ON siniestros;
DROP POLICY IF EXISTS "desarrollo_insert" ON siniestros;
DROP POLICY IF EXISTS "desarrollo_update" ON siniestros;
DROP POLICY IF EXISTS "desarrollo_delete" ON siniestros;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'siniestros' AND policyname = 'siniestros_select_anon'
  ) THEN
    CREATE POLICY "siniestros_select_anon" ON siniestros FOR SELECT USING (true);
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- siniestro_bitacora
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "acceso_bitacora" ON siniestro_bitacora;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'siniestro_bitacora' AND policyname = 'siniestro_bitacora_select_anon'
  ) THEN
    CREATE POLICY "siniestro_bitacora_select_anon" ON siniestro_bitacora FOR SELECT USING (true);
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- Verificación final (informativa — los SELECT no rompen migración)
-- ────────────────────────────────────────────────────────────

SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('personas', 'siniestros', 'siniestro_bitacora', 'siniestro_archivos', 'persona_bitacora')
ORDER BY tablename, policyname;
