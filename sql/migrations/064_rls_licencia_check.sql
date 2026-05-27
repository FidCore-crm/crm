-- Migración 064: cerrar agujero del modo solo-lectura en escrituras directas a Supabase desde el browser.
--
-- Contexto: el modo solo-lectura del CRM (licencia vencida o sin licencia)
-- está cubierto en API routes via `requireLicenciaActiva()`. PERO los flows
-- comerciales (tareas, leads, oportunidades, cotizaciones, cotizacion_companias,
-- interacciones) escriben DIRECTO desde el browser usando el JWT del usuario.
-- Esas escrituras pasan por RLS, no por API routes, así que el guard de
-- licencia tiene que vivir también acá.
--
-- Estrategia: una función SECURITY DEFINER `fn_licencia_permite_escritura()`
-- que consulta la tabla `licencias` y retorna true si hay una activa o está
-- dentro de la ventana de gracia (7 días). Se agrega al WITH CHECK de las
-- policies de INSERT/UPDATE/DELETE.
--
-- service_role (admin client) bypasea RLS automáticamente, así que los
-- endpoints API siguen funcionando para sus propios checks específicos.

-- ────────────────────────────────────────────────────────────────────────
-- 1) Función helper que se cachea por transacción (STABLE)
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_licencia_permite_escritura()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_activa BOOLEAN;
BEGIN
  -- Devuelve true si existe una licencia ACTIVA cuya fecha_vencimiento no
  -- excedió la ventana de gracia (7 días post-vencimiento). El cron diario
  -- de licencias rota automáticamente las que vencen, pero acá agregamos
  -- gracia por las dudas (consistente con `evaluarEstado` en lib/licencia.ts).
  SELECT EXISTS (
    SELECT 1 FROM public.licencias
    WHERE estado = 'ACTIVA'
      AND fecha_vencimiento >= (CURRENT_DATE - INTERVAL '7 days')
  ) INTO v_activa;

  RETURN v_activa;
END;
$$;

COMMENT ON FUNCTION public.fn_licencia_permite_escritura() IS
  'Retorna true si el CRM tiene una licencia activa (o en gracia ≤7 días). Usada por policies RLS de mutación de tablas comerciales.';

-- ────────────────────────────────────────────────────────────────────────
-- 2) Reemplazar policies de mutación en tablas comerciales
--    Se separa SELECT (siempre permitido) de INSERT/UPDATE/DELETE.
-- ────────────────────────────────────────────────────────────────────────

-- === tareas ===
DROP POLICY IF EXISTS "tareas_all" ON public.tareas;

CREATE POLICY "tareas_select" ON public.tareas FOR SELECT TO authenticated, anon
  USING (fn_acceso_total_actual() OR usuario_id = auth.uid());

CREATE POLICY "tareas_insert" ON public.tareas FOR INSERT TO authenticated
  WITH CHECK (
    fn_licencia_permite_escritura()
    AND (fn_acceso_total_actual() OR usuario_id = auth.uid())
  );

CREATE POLICY "tareas_update" ON public.tareas FOR UPDATE TO authenticated
  USING (fn_acceso_total_actual() OR usuario_id = auth.uid())
  WITH CHECK (
    fn_licencia_permite_escritura()
    AND (fn_acceso_total_actual() OR usuario_id = auth.uid())
  );

CREATE POLICY "tareas_delete" ON public.tareas FOR DELETE TO authenticated
  USING (
    fn_licencia_permite_escritura()
    AND (fn_acceso_total_actual() OR usuario_id = auth.uid())
  );

-- === leads ===
DROP POLICY IF EXISTS "leads_all" ON public.leads;

CREATE POLICY "leads_select" ON public.leads FOR SELECT TO authenticated, anon
  USING (fn_acceso_total_actual() OR usuario_id = auth.uid());

CREATE POLICY "leads_insert" ON public.leads FOR INSERT TO authenticated
  WITH CHECK (
    fn_licencia_permite_escritura()
    AND (fn_acceso_total_actual() OR usuario_id = auth.uid())
  );

CREATE POLICY "leads_update" ON public.leads FOR UPDATE TO authenticated
  USING (fn_acceso_total_actual() OR usuario_id = auth.uid())
  WITH CHECK (
    fn_licencia_permite_escritura()
    AND (fn_acceso_total_actual() OR usuario_id = auth.uid())
  );

CREATE POLICY "leads_delete" ON public.leads FOR DELETE TO authenticated
  USING (
    fn_licencia_permite_escritura()
    AND (fn_acceso_total_actual() OR usuario_id = auth.uid())
  );

-- === oportunidades ===
DROP POLICY IF EXISTS "oportunidades_all" ON public.oportunidades;

CREATE POLICY "oportunidades_select" ON public.oportunidades FOR SELECT TO authenticated, anon
  USING (fn_acceso_total_actual() OR usuario_id = auth.uid());

CREATE POLICY "oportunidades_insert" ON public.oportunidades FOR INSERT TO authenticated
  WITH CHECK (
    fn_licencia_permite_escritura()
    AND (fn_acceso_total_actual() OR usuario_id = auth.uid())
  );

CREATE POLICY "oportunidades_update" ON public.oportunidades FOR UPDATE TO authenticated
  USING (fn_acceso_total_actual() OR usuario_id = auth.uid())
  WITH CHECK (
    fn_licencia_permite_escritura()
    AND (fn_acceso_total_actual() OR usuario_id = auth.uid())
  );

CREATE POLICY "oportunidades_delete" ON public.oportunidades FOR DELETE TO authenticated
  USING (
    fn_licencia_permite_escritura()
    AND (fn_acceso_total_actual() OR usuario_id = auth.uid())
  );

-- === cotizaciones ===
DROP POLICY IF EXISTS "cotizaciones_all" ON public.cotizaciones;

CREATE POLICY "cotizaciones_select" ON public.cotizaciones FOR SELECT TO authenticated, anon
  USING (fn_acceso_total_actual() OR usuario_id = auth.uid());

CREATE POLICY "cotizaciones_insert" ON public.cotizaciones FOR INSERT TO authenticated
  WITH CHECK (
    fn_licencia_permite_escritura()
    AND (fn_acceso_total_actual() OR usuario_id = auth.uid())
  );

CREATE POLICY "cotizaciones_update" ON public.cotizaciones FOR UPDATE TO authenticated
  USING (fn_acceso_total_actual() OR usuario_id = auth.uid())
  WITH CHECK (
    fn_licencia_permite_escritura()
    AND (fn_acceso_total_actual() OR usuario_id = auth.uid())
  );

CREATE POLICY "cotizaciones_delete" ON public.cotizaciones FOR DELETE TO authenticated
  USING (
    fn_licencia_permite_escritura()
    AND (fn_acceso_total_actual() OR usuario_id = auth.uid())
  );

-- === cotizacion_companias ===
DROP POLICY IF EXISTS "cotizacion_companias_all" ON public.cotizacion_companias;

CREATE POLICY "cotizacion_companias_select" ON public.cotizacion_companias FOR SELECT TO authenticated, anon
  USING (
    fn_acceso_total_actual()
    OR EXISTS (SELECT 1 FROM public.cotizaciones c WHERE c.id = cotizacion_companias.cotizacion_id AND c.usuario_id = auth.uid())
  );

CREATE POLICY "cotizacion_companias_insert" ON public.cotizacion_companias FOR INSERT TO authenticated
  WITH CHECK (
    fn_licencia_permite_escritura()
    AND (
      fn_acceso_total_actual()
      OR EXISTS (SELECT 1 FROM public.cotizaciones c WHERE c.id = cotizacion_companias.cotizacion_id AND c.usuario_id = auth.uid())
    )
  );

CREATE POLICY "cotizacion_companias_update" ON public.cotizacion_companias FOR UPDATE TO authenticated
  USING (
    fn_acceso_total_actual()
    OR EXISTS (SELECT 1 FROM public.cotizaciones c WHERE c.id = cotizacion_companias.cotizacion_id AND c.usuario_id = auth.uid())
  )
  WITH CHECK (
    fn_licencia_permite_escritura()
    AND (
      fn_acceso_total_actual()
      OR EXISTS (SELECT 1 FROM public.cotizaciones c WHERE c.id = cotizacion_companias.cotizacion_id AND c.usuario_id = auth.uid())
    )
  );

CREATE POLICY "cotizacion_companias_delete" ON public.cotizacion_companias FOR DELETE TO authenticated
  USING (
    fn_licencia_permite_escritura()
    AND (
      fn_acceso_total_actual()
      OR EXISTS (SELECT 1 FROM public.cotizaciones c WHERE c.id = cotizacion_companias.cotizacion_id AND c.usuario_id = auth.uid())
    )
  );

-- === interacciones ===
DROP POLICY IF EXISTS "interacciones_all" ON public.interacciones;

CREATE POLICY "interacciones_select" ON public.interacciones FOR SELECT TO authenticated, anon
  USING (
    fn_acceso_total_actual()
    OR (persona_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.personas p WHERE p.id = interacciones.persona_id AND p.usuario_id = auth.uid()))
    OR (lead_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = interacciones.lead_id AND l.usuario_id = auth.uid()))
    OR (oportunidad_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.oportunidades o WHERE o.id = interacciones.oportunidad_id AND o.usuario_id = auth.uid()))
  );

CREATE POLICY "interacciones_insert" ON public.interacciones FOR INSERT TO authenticated
  WITH CHECK (
    fn_licencia_permite_escritura()
    AND (
      fn_acceso_total_actual()
      OR (persona_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.personas p WHERE p.id = interacciones.persona_id AND p.usuario_id = auth.uid()))
      OR (lead_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = interacciones.lead_id AND l.usuario_id = auth.uid()))
      OR (oportunidad_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.oportunidades o WHERE o.id = interacciones.oportunidad_id AND o.usuario_id = auth.uid()))
    )
  );

CREATE POLICY "interacciones_update" ON public.interacciones FOR UPDATE TO authenticated
  USING (
    fn_acceso_total_actual()
    OR (persona_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.personas p WHERE p.id = interacciones.persona_id AND p.usuario_id = auth.uid()))
    OR (lead_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = interacciones.lead_id AND l.usuario_id = auth.uid()))
    OR (oportunidad_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.oportunidades o WHERE o.id = interacciones.oportunidad_id AND o.usuario_id = auth.uid()))
  )
  WITH CHECK (
    fn_licencia_permite_escritura()
    AND (
      fn_acceso_total_actual()
      OR (persona_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.personas p WHERE p.id = interacciones.persona_id AND p.usuario_id = auth.uid()))
      OR (lead_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = interacciones.lead_id AND l.usuario_id = auth.uid()))
      OR (oportunidad_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.oportunidades o WHERE o.id = interacciones.oportunidad_id AND o.usuario_id = auth.uid()))
    )
  );

CREATE POLICY "interacciones_delete" ON public.interacciones FOR DELETE TO authenticated
  USING (
    fn_licencia_permite_escritura()
    AND (
      fn_acceso_total_actual()
      OR (persona_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.personas p WHERE p.id = interacciones.persona_id AND p.usuario_id = auth.uid()))
      OR (lead_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = interacciones.lead_id AND l.usuario_id = auth.uid()))
      OR (oportunidad_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.oportunidades o WHERE o.id = interacciones.oportunidad_id AND o.usuario_id = auth.uid()))
    )
  );

-- ────────────────────────────────────────────────────────────────────────
-- Nota: las tablas que solo escribe el admin client (personas, polizas,
-- siniestros, endosos, etc.) NO necesitan esta protección porque service_role
-- bypasea RLS y el guard de licencia ya está en los endpoints API.
-- ────────────────────────────────────────────────────────────────────────
