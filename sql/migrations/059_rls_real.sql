-- Migración 059: RLS real (Row Level Security)
--
-- Reemplaza las policies permisivas (`USING (true)`) por policies reales que
-- usan `auth.uid()` y los custom claims del JWT (rol, acceso_cartera).
--
-- DEFENSE IN DEPTH: el frontend sigue aplicando filtros client-side
-- (`.eq('usuario_id', ...)`). Esta migración suma una segunda capa de
-- seguridad a nivel DB. Si una policy falla, el filtro client-side todavía
-- protege; si el cliente intenta evadir el filtro, RLS bloquea.
--
-- Las API routes server-side (con service_role) NO se ven afectadas:
-- service_role bypasea RLS automáticamente. Las queries del browser
-- (con anon_key + JWT del usuario en header Authorization) sí pasan
-- por las policies.
--
-- Categorías de tabla:
--   A) Cartera (filtro por usuario_id directo o indirecto)
--   B) Pública a authenticated (catalogos, configuracion, etc.)
--   C) Admin-only
--   D) Mixta (notificaciones: personales + globales)

BEGIN;

-- ============================================================================
-- Helper: ¿el usuario actual tiene acceso TOTAL? (admin o cartera=TOTAL)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_acceso_total_actual()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.usuarios_perfil
    WHERE id = auth.uid()
      AND activo = true
      AND (rol = 'ADMIN' OR acceso_cartera = 'TOTAL')
  )
$$;

REVOKE ALL ON FUNCTION public.fn_acceso_total_actual FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_acceso_total_actual TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_es_admin_actual TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_acceso_cartera_actual TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rol_actual TO authenticated, anon, service_role;


-- ============================================================================
-- A) Tablas con CARTERA
-- ============================================================================

-- === personas (usuario_id directo) ===
DROP POLICY IF EXISTS "Permitir todo en personas" ON public.personas;
DROP POLICY IF EXISTS "personas_select_anon" ON public.personas;
DROP POLICY IF EXISTS "personas_select" ON public.personas;
DROP POLICY IF EXISTS "personas_insert" ON public.personas;
DROP POLICY IF EXISTS "personas_update" ON public.personas;
DROP POLICY IF EXISTS "personas_delete" ON public.personas;

CREATE POLICY "personas_select" ON public.personas FOR SELECT TO authenticated, anon
  USING (
    fn_acceso_total_actual()
    OR usuario_id = auth.uid()
  );
CREATE POLICY "personas_insert" ON public.personas FOR INSERT TO authenticated
  WITH CHECK (
    fn_acceso_total_actual()
    OR usuario_id = auth.uid()
  );
CREATE POLICY "personas_update" ON public.personas FOR UPDATE TO authenticated
  USING (fn_acceso_total_actual() OR usuario_id = auth.uid())
  WITH CHECK (fn_acceso_total_actual() OR usuario_id = auth.uid());
CREATE POLICY "personas_delete" ON public.personas FOR DELETE TO authenticated
  USING (fn_acceso_total_actual() OR usuario_id = auth.uid());


-- === polizas (via personas.usuario_id por asegurado_id) ===
DROP POLICY IF EXISTS "desarrollo_select" ON public.polizas;
DROP POLICY IF EXISTS "desarrollo_insert" ON public.polizas;
DROP POLICY IF EXISTS "desarrollo_update" ON public.polizas;
DROP POLICY IF EXISTS "desarrollo_delete" ON public.polizas;
DROP POLICY IF EXISTS "polizas_select" ON public.polizas;
DROP POLICY IF EXISTS "polizas_insert" ON public.polizas;
DROP POLICY IF EXISTS "polizas_update" ON public.polizas;
DROP POLICY IF EXISTS "polizas_delete" ON public.polizas;

CREATE POLICY "polizas_select" ON public.polizas FOR SELECT TO authenticated, anon
  USING (
    fn_acceso_total_actual()
    OR EXISTS (SELECT 1 FROM public.personas p WHERE p.id = polizas.asegurado_id AND p.usuario_id = auth.uid())
  );
CREATE POLICY "polizas_insert" ON public.polizas FOR INSERT TO authenticated
  WITH CHECK (
    fn_acceso_total_actual()
    OR EXISTS (SELECT 1 FROM public.personas p WHERE p.id = asegurado_id AND p.usuario_id = auth.uid())
  );
CREATE POLICY "polizas_update" ON public.polizas FOR UPDATE TO authenticated
  USING (fn_acceso_total_actual() OR EXISTS (SELECT 1 FROM public.personas p WHERE p.id = polizas.asegurado_id AND p.usuario_id = auth.uid()))
  WITH CHECK (fn_acceso_total_actual() OR EXISTS (SELECT 1 FROM public.personas p WHERE p.id = asegurado_id AND p.usuario_id = auth.uid()));
CREATE POLICY "polizas_delete" ON public.polizas FOR DELETE TO authenticated
  USING (fn_acceso_total_actual() OR EXISTS (SELECT 1 FROM public.personas p WHERE p.id = polizas.asegurado_id AND p.usuario_id = auth.uid()));


-- === riesgos (via polizas) ===
DROP POLICY IF EXISTS "Permitir todo en riesgos" ON public.riesgos;
DROP POLICY IF EXISTS "desarrollo_select" ON public.riesgos;
DROP POLICY IF EXISTS "desarrollo_insert" ON public.riesgos;
DROP POLICY IF EXISTS "desarrollo_update" ON public.riesgos;
DROP POLICY IF EXISTS "desarrollo_delete" ON public.riesgos;
DROP POLICY IF EXISTS "riesgos_all" ON public.riesgos;

CREATE POLICY "riesgos_all" ON public.riesgos FOR ALL TO authenticated, anon
  USING (
    fn_acceso_total_actual()
    OR EXISTS (
      SELECT 1 FROM public.polizas pol
      JOIN public.personas p ON p.id = pol.asegurado_id
      WHERE pol.id = riesgos.poliza_id AND p.usuario_id = auth.uid()
    )
  )
  WITH CHECK (
    fn_acceso_total_actual()
    OR EXISTS (
      SELECT 1 FROM public.polizas pol
      JOIN public.personas p ON p.id = pol.asegurado_id
      WHERE pol.id = riesgos.poliza_id AND p.usuario_id = auth.uid()
    )
  );


-- === endosos (via polizas) ===
DROP POLICY IF EXISTS "Permitir todo en endosos" ON public.endosos;
DROP POLICY IF EXISTS "endosos_all" ON public.endosos;

CREATE POLICY "endosos_all" ON public.endosos FOR ALL TO authenticated, anon
  USING (
    fn_acceso_total_actual()
    OR EXISTS (
      SELECT 1 FROM public.polizas pol
      JOIN public.personas p ON p.id = pol.asegurado_id
      WHERE pol.id = endosos.poliza_id AND p.usuario_id = auth.uid()
    )
  )
  WITH CHECK (
    fn_acceso_total_actual()
    OR EXISTS (
      SELECT 1 FROM public.polizas pol
      JOIN public.personas p ON p.id = pol.asegurado_id
      WHERE pol.id = endosos.poliza_id AND p.usuario_id = auth.uid()
    )
  );


-- === poliza_archivos (via polizas) ===
DROP POLICY IF EXISTS "Permitir todo en poliza_archivos" ON public.poliza_archivos;
DROP POLICY IF EXISTS "poliza_archivos_all" ON public.poliza_archivos;

CREATE POLICY "poliza_archivos_all" ON public.poliza_archivos FOR ALL TO authenticated, anon
  USING (
    fn_acceso_total_actual()
    OR EXISTS (
      SELECT 1 FROM public.polizas pol
      JOIN public.personas p ON p.id = pol.asegurado_id
      WHERE pol.id = poliza_archivos.poliza_id AND p.usuario_id = auth.uid()
    )
  )
  WITH CHECK (
    fn_acceso_total_actual()
    OR EXISTS (
      SELECT 1 FROM public.polizas pol
      JOIN public.personas p ON p.id = pol.asegurado_id
      WHERE pol.id = poliza_archivos.poliza_id AND p.usuario_id = auth.uid()
    )
  );


-- === poliza_bitacora (via polizas) ===
DROP POLICY IF EXISTS "Permitir todo en poliza_bitacora" ON public.poliza_bitacora;
DROP POLICY IF EXISTS "poliza_bitacora_all" ON public.poliza_bitacora;

CREATE POLICY "poliza_bitacora_all" ON public.poliza_bitacora FOR ALL TO authenticated, anon
  USING (
    fn_acceso_total_actual()
    OR EXISTS (
      SELECT 1 FROM public.polizas pol
      JOIN public.personas p ON p.id = pol.asegurado_id
      WHERE pol.id = poliza_bitacora.poliza_id AND p.usuario_id = auth.uid()
    )
  )
  WITH CHECK (
    fn_acceso_total_actual()
    OR EXISTS (
      SELECT 1 FROM public.polizas pol
      JOIN public.personas p ON p.id = pol.asegurado_id
      WHERE pol.id = poliza_bitacora.poliza_id AND p.usuario_id = auth.uid()
    )
  );


-- === polizas_eliminadas (admin only — auditoría) ===
DROP POLICY IF EXISTS "Permitir todo en polizas_eliminadas" ON public.polizas_eliminadas;
DROP POLICY IF EXISTS "polizas_eliminadas_all" ON public.polizas_eliminadas;

CREATE POLICY "polizas_eliminadas_all" ON public.polizas_eliminadas FOR ALL TO authenticated, anon
  USING (fn_es_admin_actual())
  WITH CHECK (fn_es_admin_actual());


-- === siniestros (via polizas) ===
DROP POLICY IF EXISTS "siniestros_select_anon" ON public.siniestros;
DROP POLICY IF EXISTS "Permitir todo en siniestros" ON public.siniestros;
DROP POLICY IF EXISTS "siniestros_all" ON public.siniestros;

CREATE POLICY "siniestros_all" ON public.siniestros FOR ALL TO authenticated, anon
  USING (
    fn_acceso_total_actual()
    OR EXISTS (
      SELECT 1 FROM public.polizas pol
      JOIN public.personas p ON p.id = pol.asegurado_id
      WHERE pol.id = siniestros.poliza_id AND p.usuario_id = auth.uid()
    )
  )
  WITH CHECK (
    fn_acceso_total_actual()
    OR EXISTS (
      SELECT 1 FROM public.polizas pol
      JOIN public.personas p ON p.id = pol.asegurado_id
      WHERE pol.id = siniestros.poliza_id AND p.usuario_id = auth.uid()
    )
  );


-- === siniestro_bitacora (via siniestros) ===
DROP POLICY IF EXISTS "Permitir todo en siniestro_bitacora" ON public.siniestro_bitacora;
DROP POLICY IF EXISTS "siniestro_bitacora_all" ON public.siniestro_bitacora;

CREATE POLICY "siniestro_bitacora_all" ON public.siniestro_bitacora FOR ALL TO authenticated, anon
  USING (
    fn_acceso_total_actual()
    OR EXISTS (
      SELECT 1 FROM public.siniestros s
      JOIN public.polizas pol ON pol.id = s.poliza_id
      JOIN public.personas p ON p.id = pol.asegurado_id
      WHERE s.id = siniestro_bitacora.siniestro_id AND p.usuario_id = auth.uid()
    )
  )
  WITH CHECK (
    fn_acceso_total_actual()
    OR EXISTS (
      SELECT 1 FROM public.siniestros s
      JOIN public.polizas pol ON pol.id = s.poliza_id
      JOIN public.personas p ON p.id = pol.asegurado_id
      WHERE s.id = siniestro_bitacora.siniestro_id AND p.usuario_id = auth.uid()
    )
  );


-- === siniestro_archivos (via siniestros) ===
DROP POLICY IF EXISTS "Permitir todo en siniestro_archivos" ON public.siniestro_archivos;
DROP POLICY IF EXISTS "siniestro_archivos_all" ON public.siniestro_archivos;

CREATE POLICY "siniestro_archivos_all" ON public.siniestro_archivos FOR ALL TO authenticated, anon
  USING (
    fn_acceso_total_actual()
    OR EXISTS (
      SELECT 1 FROM public.siniestros s
      JOIN public.polizas pol ON pol.id = s.poliza_id
      JOIN public.personas p ON p.id = pol.asegurado_id
      WHERE s.id = siniestro_archivos.siniestro_id AND p.usuario_id = auth.uid()
    )
  )
  WITH CHECK (
    fn_acceso_total_actual()
    OR EXISTS (
      SELECT 1 FROM public.siniestros s
      JOIN public.polizas pol ON pol.id = s.poliza_id
      JOIN public.personas p ON p.id = pol.asegurado_id
      WHERE s.id = siniestro_archivos.siniestro_id AND p.usuario_id = auth.uid()
    )
  );


-- === tareas (usuario_id directo) ===
DROP POLICY IF EXISTS "Permitir todo en tareas" ON public.tareas;
DROP POLICY IF EXISTS "tareas_all" ON public.tareas;

CREATE POLICY "tareas_all" ON public.tareas FOR ALL TO authenticated, anon
  USING (fn_acceso_total_actual() OR usuario_id = auth.uid())
  WITH CHECK (fn_acceso_total_actual() OR usuario_id = auth.uid());


-- === leads (usuario_id directo) ===
DROP POLICY IF EXISTS "Permitir todo en leads" ON public.leads;
DROP POLICY IF EXISTS "leads_all" ON public.leads;

CREATE POLICY "leads_all" ON public.leads FOR ALL TO authenticated, anon
  USING (fn_acceso_total_actual() OR usuario_id = auth.uid())
  WITH CHECK (fn_acceso_total_actual() OR usuario_id = auth.uid());


-- === oportunidades (usuario_id directo) ===
DROP POLICY IF EXISTS "Permitir todo en oportunidades" ON public.oportunidades;
DROP POLICY IF EXISTS "oportunidades_all" ON public.oportunidades;

CREATE POLICY "oportunidades_all" ON public.oportunidades FOR ALL TO authenticated, anon
  USING (fn_acceso_total_actual() OR usuario_id = auth.uid())
  WITH CHECK (fn_acceso_total_actual() OR usuario_id = auth.uid());


-- === cotizaciones (usuario_id directo) ===
DROP POLICY IF EXISTS "Permitir todo en cotizaciones" ON public.cotizaciones;
DROP POLICY IF EXISTS "cotizaciones_all" ON public.cotizaciones;

CREATE POLICY "cotizaciones_all" ON public.cotizaciones FOR ALL TO authenticated, anon
  USING (fn_acceso_total_actual() OR usuario_id = auth.uid())
  WITH CHECK (fn_acceso_total_actual() OR usuario_id = auth.uid());


-- === cotizacion_companias (via cotizaciones) ===
DROP POLICY IF EXISTS "Permitir todo en cotizacion_companias" ON public.cotizacion_companias;
DROP POLICY IF EXISTS "cotizacion_companias_all" ON public.cotizacion_companias;

CREATE POLICY "cotizacion_companias_all" ON public.cotizacion_companias FOR ALL TO authenticated, anon
  USING (
    fn_acceso_total_actual()
    OR EXISTS (SELECT 1 FROM public.cotizaciones c WHERE c.id = cotizacion_companias.cotizacion_id AND c.usuario_id = auth.uid())
  )
  WITH CHECK (
    fn_acceso_total_actual()
    OR EXISTS (SELECT 1 FROM public.cotizaciones c WHERE c.id = cotizacion_companias.cotizacion_id AND c.usuario_id = auth.uid())
  );


-- === interacciones (persona O lead O oportunidad) ===
DROP POLICY IF EXISTS "Permitir todo en interacciones" ON public.interacciones;
DROP POLICY IF EXISTS "interacciones_all" ON public.interacciones;

CREATE POLICY "interacciones_all" ON public.interacciones FOR ALL TO authenticated, anon
  USING (
    fn_acceso_total_actual()
    OR (persona_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.personas p WHERE p.id = interacciones.persona_id AND p.usuario_id = auth.uid()))
    OR (lead_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = interacciones.lead_id AND l.usuario_id = auth.uid()))
    OR (oportunidad_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.oportunidades o WHERE o.id = interacciones.oportunidad_id AND o.usuario_id = auth.uid()))
  )
  WITH CHECK (
    fn_acceso_total_actual()
    OR (persona_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.personas p WHERE p.id = interacciones.persona_id AND p.usuario_id = auth.uid()))
    OR (lead_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = interacciones.lead_id AND l.usuario_id = auth.uid()))
    OR (oportunidad_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.oportunidades o WHERE o.id = interacciones.oportunidad_id AND o.usuario_id = auth.uid()))
  );


-- === persona_bitacora (via persona) ===
DROP POLICY IF EXISTS "Permitir todo en persona_bitacora" ON public.persona_bitacora;
DROP POLICY IF EXISTS "persona_bitacora_all" ON public.persona_bitacora;

CREATE POLICY "persona_bitacora_all" ON public.persona_bitacora FOR ALL TO authenticated, anon
  USING (
    fn_acceso_total_actual()
    OR EXISTS (SELECT 1 FROM public.personas p WHERE p.id = persona_bitacora.persona_id AND p.usuario_id = auth.uid())
  )
  WITH CHECK (
    fn_acceso_total_actual()
    OR EXISTS (SELECT 1 FROM public.personas p WHERE p.id = persona_bitacora.persona_id AND p.usuario_id = auth.uid())
  );


-- === portal_cliente_accesos (via persona) ===
DROP POLICY IF EXISTS "Permitir todo en portal_cliente_accesos" ON public.portal_cliente_accesos;
DROP POLICY IF EXISTS "portal_cliente_accesos_all" ON public.portal_cliente_accesos;

CREATE POLICY "portal_cliente_accesos_all" ON public.portal_cliente_accesos FOR ALL TO authenticated, anon
  USING (
    fn_acceso_total_actual()
    OR EXISTS (SELECT 1 FROM public.personas p WHERE p.id = portal_cliente_accesos.persona_id AND p.usuario_id = auth.uid())
  )
  WITH CHECK (
    fn_acceso_total_actual()
    OR EXISTS (SELECT 1 FROM public.personas p WHERE p.id = portal_cliente_accesos.persona_id AND p.usuario_id = auth.uid())
  );


-- === postits (usuario_id directo + compartido) ===
-- Cada postit pertenece a un usuario; si `compartido=true` lo ven todos.
DROP POLICY IF EXISTS "Permitir todo en postits" ON public.postits;
DROP POLICY IF EXISTS "postits_all" ON public.postits;

CREATE POLICY "postits_all" ON public.postits FOR ALL TO authenticated, anon
  USING (
    fn_es_admin_actual()
    OR usuario_id = auth.uid()
    OR compartido = true
  )
  WITH CHECK (
    fn_es_admin_actual()
    OR usuario_id = auth.uid()
  );


-- ============================================================================
-- D) Notificaciones (mixta)
-- ============================================================================

DROP POLICY IF EXISTS "Permitir todo en notificaciones" ON public.notificaciones;
DROP POLICY IF EXISTS "notificaciones_all" ON public.notificaciones;

-- Cada usuario ve solo sus notificaciones (usuario_id = auth.uid()) + las globales (usuario_id IS NULL).
-- Admin ve todas.
CREATE POLICY "notificaciones_all" ON public.notificaciones FOR ALL TO authenticated, anon
  USING (
    fn_es_admin_actual()
    OR usuario_id = auth.uid()
    OR usuario_id IS NULL
  )
  WITH CHECK (
    fn_es_admin_actual()
    OR usuario_id = auth.uid()
    OR usuario_id IS NULL
  );


-- ============================================================================
-- C) Tablas ADMIN-ONLY
-- ============================================================================

-- usuarios_perfil: cada uno ve su propio perfil, admin ve todo
DROP POLICY IF EXISTS "Permitir todo en usuarios_perfil" ON public.usuarios_perfil;
DROP POLICY IF EXISTS "usuarios_perfil_all" ON public.usuarios_perfil;

CREATE POLICY "usuarios_perfil_all" ON public.usuarios_perfil FOR ALL TO authenticated, anon
  USING (fn_es_admin_actual() OR id = auth.uid())
  WITH CHECK (fn_es_admin_actual() OR id = auth.uid());


-- backups, restauraciones, importaciones, etc. → admin-only
DROP POLICY IF EXISTS "Permitir todo en backups" ON public.backups;
DROP POLICY IF EXISTS "backups_all" ON public.backups;
CREATE POLICY "backups_all" ON public.backups FOR ALL TO authenticated, anon
  USING (fn_es_admin_actual()) WITH CHECK (fn_es_admin_actual());

DROP POLICY IF EXISTS "Permitir todo en configuracion_backups" ON public.configuracion_backups;
DROP POLICY IF EXISTS "configuracion_backups_all" ON public.configuracion_backups;
CREATE POLICY "configuracion_backups_all" ON public.configuracion_backups FOR ALL TO authenticated, anon
  USING (fn_es_admin_actual()) WITH CHECK (fn_es_admin_actual());

DROP POLICY IF EXISTS "Permitir todo en restauraciones" ON public.restauraciones;
DROP POLICY IF EXISTS "restauraciones_all" ON public.restauraciones;
CREATE POLICY "restauraciones_all" ON public.restauraciones FOR ALL TO authenticated, anon
  USING (fn_es_admin_actual()) WITH CHECK (fn_es_admin_actual());

DROP POLICY IF EXISTS "Permitir todo en errores_sistema" ON public.errores_sistema;
DROP POLICY IF EXISTS "errores_sistema_all" ON public.errores_sistema;
CREATE POLICY "errores_sistema_all" ON public.errores_sistema FOR ALL TO authenticated, anon
  USING (fn_es_admin_actual()) WITH CHECK (fn_es_admin_actual());

DROP POLICY IF EXISTS "Permitir todo en facturacion" ON public.facturacion;
DROP POLICY IF EXISTS "facturacion_all" ON public.facturacion;
CREATE POLICY "facturacion_all" ON public.facturacion FOR ALL TO authenticated, anon
  USING (fn_es_admin_actual()) WITH CHECK (fn_es_admin_actual());

-- Importaciones: el usuario que las creó las ve, admin ve todas
DROP POLICY IF EXISTS "Permitir todo en importaciones" ON public.importaciones;
DROP POLICY IF EXISTS "importaciones_all" ON public.importaciones;
CREATE POLICY "importaciones_all" ON public.importaciones FOR ALL TO authenticated, anon
  USING (fn_es_admin_actual() OR usuario_id = auth.uid())
  WITH CHECK (fn_es_admin_actual() OR usuario_id = auth.uid());

DROP POLICY IF EXISTS "Permitir todo en importacion_jobs" ON public.importacion_jobs;
DROP POLICY IF EXISTS "importacion_jobs_all" ON public.importacion_jobs;
CREATE POLICY "importacion_jobs_all" ON public.importacion_jobs FOR ALL TO authenticated, anon
  USING (fn_es_admin_actual()) WITH CHECK (fn_es_admin_actual());

DROP POLICY IF EXISTS "Permitir todo en importacion_lotes" ON public.importacion_lotes;
DROP POLICY IF EXISTS "importacion_lotes_all" ON public.importacion_lotes;
CREATE POLICY "importacion_lotes_all" ON public.importacion_lotes FOR ALL TO authenticated, anon
  USING (fn_es_admin_actual()) WITH CHECK (fn_es_admin_actual());

DROP POLICY IF EXISTS "Permitir todo en importacion_registros_dudosos" ON public.importacion_registros_dudosos;
DROP POLICY IF EXISTS "importacion_registros_dudosos_all" ON public.importacion_registros_dudosos;
CREATE POLICY "importacion_registros_dudosos_all" ON public.importacion_registros_dudosos FOR ALL TO authenticated, anon
  USING (fn_es_admin_actual()) WITH CHECK (fn_es_admin_actual());

DROP POLICY IF EXISTS "Permitir todo en pdf_procesamientos" ON public.pdf_procesamientos;
DROP POLICY IF EXISTS "pdf_procesamientos_all" ON public.pdf_procesamientos;
CREATE POLICY "pdf_procesamientos_all" ON public.pdf_procesamientos FOR ALL TO authenticated, anon
  USING (fn_es_admin_actual() OR usuario_id = auth.uid())
  WITH CHECK (fn_es_admin_actual() OR usuario_id = auth.uid());

-- Email_envios: admin ve todo, usuario ve los que envió o los suyos
DROP POLICY IF EXISTS "Permitir todo en email_envios" ON public.email_envios;
DROP POLICY IF EXISTS "email_envios_all" ON public.email_envios;
CREATE POLICY "email_envios_all" ON public.email_envios FOR ALL TO authenticated, anon
  USING (
    fn_es_admin_actual()
    OR enviado_por_usuario_id = auth.uid()
    OR (persona_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.personas p WHERE p.id = email_envios.persona_id AND p.usuario_id = auth.uid()))
  )
  WITH CHECK (
    fn_es_admin_actual()
    OR enviado_por_usuario_id = auth.uid()
  );

DROP POLICY IF EXISTS "Permitir todo en email_bajas" ON public.email_bajas;
DROP POLICY IF EXISTS "email_bajas_all" ON public.email_bajas;
CREATE POLICY "email_bajas_all" ON public.email_bajas FOR ALL TO authenticated, anon
  USING (fn_es_admin_actual()) WITH CHECK (fn_es_admin_actual());

DROP POLICY IF EXISTS "Permitir todo en email_clicks" ON public.email_clicks;
DROP POLICY IF EXISTS "email_clicks_all" ON public.email_clicks;
CREATE POLICY "email_clicks_all" ON public.email_clicks FOR ALL TO authenticated, anon
  USING (fn_es_admin_actual()) WITH CHECK (fn_es_admin_actual());

DROP POLICY IF EXISTS "Permitir todo en plantillas_email" ON public.plantillas_email;
DROP POLICY IF EXISTS "plantillas_email_all" ON public.plantillas_email;
CREATE POLICY "plantillas_email_all" ON public.plantillas_email FOR ALL TO authenticated, anon
  USING (fn_es_admin_actual()) WITH CHECK (fn_es_admin_actual());

-- Configuración SMTP, formulario público, etc. → admin
DROP POLICY IF EXISTS "Permitir todo en configuracion_comunicaciones" ON public.configuracion_comunicaciones;
DROP POLICY IF EXISTS "configuracion_comunicaciones_all" ON public.configuracion_comunicaciones;
CREATE POLICY "configuracion_comunicaciones_all" ON public.configuracion_comunicaciones FOR ALL TO authenticated, anon
  USING (fn_es_admin_actual()) WITH CHECK (fn_es_admin_actual());

DROP POLICY IF EXISTS "Permitir todo en configuracion_correos" ON public.configuracion_correos;
DROP POLICY IF EXISTS "configuracion_correos_all" ON public.configuracion_correos;
CREATE POLICY "configuracion_correos_all" ON public.configuracion_correos FOR ALL TO authenticated, anon
  USING (fn_es_admin_actual()) WITH CHECK (fn_es_admin_actual());

DROP POLICY IF EXISTS "Permitir todo en configuracion_formulario_publico" ON public.configuracion_formulario_publico;
DROP POLICY IF EXISTS "configuracion_formulario_publico_all" ON public.configuracion_formulario_publico;
CREATE POLICY "configuracion_formulario_publico_all" ON public.configuracion_formulario_publico FOR ALL TO authenticated, anon
  USING (fn_es_admin_actual()) WITH CHECK (fn_es_admin_actual());

-- configuracion_notificaciones: lectura para todos (los crones la leen),
-- modificación solo admin
DROP POLICY IF EXISTS "Permitir todo en configuracion_notificaciones" ON public.configuracion_notificaciones;
DROP POLICY IF EXISTS "configuracion_notificaciones_all" ON public.configuracion_notificaciones;
DROP POLICY IF EXISTS "configuracion_notificaciones_select" ON public.configuracion_notificaciones;
DROP POLICY IF EXISTS "configuracion_notificaciones_modify" ON public.configuracion_notificaciones;
CREATE POLICY "configuracion_notificaciones_select" ON public.configuracion_notificaciones FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "configuracion_notificaciones_modify" ON public.configuracion_notificaciones FOR ALL TO authenticated
  USING (fn_es_admin_actual()) WITH CHECK (fn_es_admin_actual());

DROP POLICY IF EXISTS "Permitir todo en storage_tokens" ON public.storage_tokens;
DROP POLICY IF EXISTS "storage_tokens_all" ON public.storage_tokens;
CREATE POLICY "storage_tokens_all" ON public.storage_tokens FOR ALL TO authenticated, anon
  USING (fn_es_admin_actual() OR creado_por_usuario_id = auth.uid())
  WITH CHECK (fn_es_admin_actual() OR creado_por_usuario_id = auth.uid());

DROP POLICY IF EXISTS "Permitir todo en rate_limit_buckets" ON public.rate_limit_buckets;
DROP POLICY IF EXISTS "rate_limit_buckets_all" ON public.rate_limit_buckets;
CREATE POLICY "rate_limit_buckets_all" ON public.rate_limit_buckets FOR ALL TO authenticated, anon
  USING (fn_es_admin_actual()) WITH CHECK (fn_es_admin_actual());

DROP POLICY IF EXISTS "Permitir todo en siniestros_contador" ON public.siniestros_contador;
DROP POLICY IF EXISTS "siniestros_contador_all" ON public.siniestros_contador;
CREATE POLICY "siniestros_contador_all" ON public.siniestros_contador FOR ALL TO authenticated, anon
  USING (fn_es_admin_actual()) WITH CHECK (fn_es_admin_actual());

DROP POLICY IF EXISTS "Permitir todo en solicitudes_blanqueo_password" ON public.solicitudes_blanqueo_password;
DROP POLICY IF EXISTS "solicitudes_blanqueo_password_all" ON public.solicitudes_blanqueo_password;
CREATE POLICY "solicitudes_blanqueo_password_all" ON public.solicitudes_blanqueo_password FOR ALL TO authenticated, anon
  USING (fn_es_admin_actual() OR usuario_id = auth.uid())
  WITH CHECK (fn_es_admin_actual() OR usuario_id = auth.uid());


-- ============================================================================
-- B) Tablas PÚBLICAS a authenticated
-- ============================================================================

-- catalogos: todos los autenticados pueden leer; solo admin puede modificar
DROP POLICY IF EXISTS "Permitir todo en catalogos" ON public.catalogos;
DROP POLICY IF EXISTS "catalogos_select" ON public.catalogos;
DROP POLICY IF EXISTS "catalogos_select_anon" ON public.catalogos;
DROP POLICY IF EXISTS "catalogos_select_authenticated" ON public.catalogos;
DROP POLICY IF EXISTS "catalogos_modify" ON public.catalogos;

CREATE POLICY "catalogos_select" ON public.catalogos FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "catalogos_modify" ON public.catalogos FOR ALL TO authenticated
  USING (fn_es_admin_actual())
  WITH CHECK (fn_es_admin_actual());

DROP POLICY IF EXISTS "Permitir todo en tipo_catalogo" ON public.tipo_catalogo;
DROP POLICY IF EXISTS "tipo_catalogo_select" ON public.tipo_catalogo;
DROP POLICY IF EXISTS "tipo_catalogo_modify" ON public.tipo_catalogo;

CREATE POLICY "tipo_catalogo_select" ON public.tipo_catalogo FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "tipo_catalogo_modify" ON public.tipo_catalogo FOR ALL TO authenticated
  USING (fn_es_admin_actual())
  WITH CHECK (fn_es_admin_actual());

DROP POLICY IF EXISTS "Permitir todo en configuracion" ON public.configuracion;
DROP POLICY IF EXISTS "configuracion_select" ON public.configuracion;
DROP POLICY IF EXISTS "configuracion_modify" ON public.configuracion;

CREATE POLICY "configuracion_select" ON public.configuracion FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "configuracion_modify" ON public.configuracion FOR ALL TO authenticated
  USING (fn_es_admin_actual())
  WITH CHECK (fn_es_admin_actual());

DROP POLICY IF EXISTS "Permitir todo en telefonos_asistencia_companias" ON public.telefonos_asistencia_companias;
DROP POLICY IF EXISTS "telefonos_asistencia_companias_select" ON public.telefonos_asistencia_companias;
DROP POLICY IF EXISTS "telefonos_asistencia_companias_modify" ON public.telefonos_asistencia_companias;

CREATE POLICY "telefonos_asistencia_companias_select" ON public.telefonos_asistencia_companias FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "telefonos_asistencia_companias_modify" ON public.telefonos_asistencia_companias FOR ALL TO authenticated
  USING (fn_es_admin_actual())
  WITH CHECK (fn_es_admin_actual());

DROP POLICY IF EXISTS "Permitir todo en anthropic_modelos_cache" ON public.anthropic_modelos_cache;
DROP POLICY IF EXISTS "anthropic_modelos_cache_select" ON public.anthropic_modelos_cache;
DROP POLICY IF EXISTS "anthropic_modelos_cache_modify" ON public.anthropic_modelos_cache;

CREATE POLICY "anthropic_modelos_cache_select" ON public.anthropic_modelos_cache FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "anthropic_modelos_cache_modify" ON public.anthropic_modelos_cache FOR ALL TO authenticated
  USING (fn_es_admin_actual())
  WITH CHECK (fn_es_admin_actual());

DROP POLICY IF EXISTS "Permitir todo en configuracion_portal_cliente" ON public.configuracion_portal_cliente;
DROP POLICY IF EXISTS "configuracion_portal_cliente_select" ON public.configuracion_portal_cliente;
DROP POLICY IF EXISTS "configuracion_portal_cliente_modify" ON public.configuracion_portal_cliente;

CREATE POLICY "configuracion_portal_cliente_select" ON public.configuracion_portal_cliente FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "configuracion_portal_cliente_modify" ON public.configuracion_portal_cliente FOR ALL TO authenticated
  USING (fn_es_admin_actual())
  WITH CHECK (fn_es_admin_actual());


-- ============================================================================
-- TABLAS LEGACY (mantienen permisivas porque solo se acceden por service_role)
-- ============================================================================
-- usuarios, sesiones — el código no las usa más para la auth (Supabase Auth
-- las reemplazó). Los pocos accesos restantes son via API routes con
-- service_role que bypasea RLS. Mantenerlas permisivas evita warnings.

-- (No tocamos sus policies — ya están permisivas desde antes)


COMMIT;
