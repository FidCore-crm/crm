-- ============================================================
-- 026_personas_rls_efectiva.sql
--
-- Endurece la RLS de personas: el role `anon` (browser client) puede LEER,
-- pero no puede INSERTAR / ACTUALIZAR / ELIMINAR. Toda modificación tiene
-- que pasar por API routes que usan `service_role` (bypasea RLS).
--
-- Esto cierra el agujero detectado en la auditoría: aunque el frontend ya
-- migró sus mutaciones a `apiCall(...)`, alguien con acceso al token anon
-- (DevTools, scripts) no podía ser bloqueado a nivel app. Ahora la DB
-- también lo bloquea.
-- ============================================================

DROP POLICY IF EXISTS "Permitir todo en personas" ON personas;

-- Lectura libre para anon (el frontend lista, busca y muestra fichas).
CREATE POLICY "personas_select_anon" ON personas
  FOR SELECT
  USING (true);

-- INSERT / UPDATE / DELETE: sin política explícita = denegado para roles que
-- no bypasean RLS. `service_role` (usado por getSupabaseAdmin) tiene bypass
-- automático, así que los API routes siguen funcionando.
--
-- Nota: si en el futuro se necesita permitir alguna mutación desde el
-- browser sin pasar por API, agregar una política explícita acá.
