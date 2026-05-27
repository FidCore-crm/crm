-- ============================================================
-- 028_siniestros_rls_efectiva.sql
--
-- Endurece la RLS de siniestros y siniestro_bitacora.
--   - SELECT libre para `anon` (el frontend lista, busca y muestra fichas).
--   - INSERT / UPDATE / DELETE solo via `service_role` (API routes).
--
-- Esto cierra el agujero detectado en la auditoría: ahora que el frontend
-- migró sus mutaciones a `apiCall(...)`, alguien con el token anon (DevTools,
-- scripts) ya no puede modificar siniestros bypasseando las validaciones.
--
-- Mismo patrón que `personas` (migración 026).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- siniestros
-- ────────────────────────────────────────────────────────────

ALTER TABLE siniestros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir todo en siniestros" ON siniestros;
DROP POLICY IF EXISTS "siniestros_select_anon" ON siniestros;

CREATE POLICY "siniestros_select_anon" ON siniestros
  FOR SELECT
  USING (true);

-- INSERT/UPDATE/DELETE: sin política explícita = denegado para anon.
-- service_role bypasea RLS por defecto.

-- ────────────────────────────────────────────────────────────
-- siniestro_bitacora
-- ────────────────────────────────────────────────────────────

ALTER TABLE siniestro_bitacora ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir todo en siniestro_bitacora" ON siniestro_bitacora;
DROP POLICY IF EXISTS "siniestro_bitacora_select_anon" ON siniestro_bitacora;

CREATE POLICY "siniestro_bitacora_select_anon" ON siniestro_bitacora
  FOR SELECT
  USING (true);

-- ────────────────────────────────────────────────────────────
-- siniestro_archivos
-- ────────────────────────────────────────────────────────────

ALTER TABLE siniestro_archivos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir todo en siniestro_archivos" ON siniestro_archivos;
DROP POLICY IF EXISTS "siniestro_archivos_select_anon" ON siniestro_archivos;

CREATE POLICY "siniestro_archivos_select_anon" ON siniestro_archivos
  FOR SELECT
  USING (true);
