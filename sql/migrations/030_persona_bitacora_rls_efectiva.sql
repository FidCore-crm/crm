-- ============================================================
-- 030_persona_bitacora_rls_efectiva.sql
--
-- Cierra el último gap de RLS en el módulo Personas: la migración 025
-- creó `persona_bitacora` con la policy permisiva "Permitir todo" (ALL
-- USING true). El resto de la familia ya quedó endurecida en 026 y 029.
--
-- Reemplaza por SELECT libre + INSERT/UPDATE/DELETE solo via service_role,
-- igual que el resto.
-- ============================================================

DROP POLICY IF EXISTS "Permitir todo en persona_bitacora" ON persona_bitacora;
DROP POLICY IF EXISTS "persona_bitacora_select_anon" ON persona_bitacora;

CREATE POLICY "persona_bitacora_select_anon" ON persona_bitacora
  FOR SELECT
  USING (true);

-- INSERT/UPDATE/DELETE: sin política explícita = denegado para anon.
-- service_role bypasea RLS por defecto. Los API routes que escriben en
-- esta tabla (bitacora-persona helper) usan getSupabaseAdmin() y siguen
-- funcionando.

-- Verificación final (informativa)
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('personas', 'persona_bitacora', 'siniestros', 'siniestro_bitacora', 'siniestro_archivos')
ORDER BY tablename, policyname;
