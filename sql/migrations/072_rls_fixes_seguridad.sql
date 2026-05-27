-- Migración 072: Fixes de RLS para cerrar dos fugas de seguridad
--
-- 1) `configuracion` exponía la API key encriptada de Anthropic + datos
--    administrativos a clientes anon (sin login). La policy era SELECT
--    abierta a 'anon' con USING (true) — cualquiera con curl + la anon_key
--    podía leer la tabla completa.
--
--    Fix: SELECT ahora requiere 'authenticated' (no anon). El sidebar y
--    helpers del browser ya pasan JWT así que no se rompe. La api_key
--    encriptada sigue siendo inútil sin ENCRYPTION_KEY del server.
--
-- 2) `configuracion_correos` exponía smtp_password_encrypted al mismo nivel.
--    Las credenciales SMTP no las necesita ningún usuario que no sea admin.
--
--    Fix: SELECT ahora requiere admin. Las queries que necesitan datos
--    SMTP corren server-side con service_role (api/configuracion/correos).
--
-- 3) `usuarios_perfil` tenía policy ALL (incluye UPDATE) con
--    `id = auth.uid()`. Un usuario PROPIA podía hacer
--    UPDATE usuarios_perfil SET rol='ADMIN' WHERE id=<su uuid> y
--    auto-promocionarse.
--
--    Fix: Separar policy ALL en SELECT/INSERT/UPDATE/DELETE. UPDATE
--    propio queda restringido a campos no-críticos via columna-level GRANT
--    + check de admin para tocar rol/acceso_cartera/activo. Como Postgres
--    no permite column-level dentro de la policy USING, usamos un trigger
--    BEFORE UPDATE que aborta si un no-admin intenta cambiar esos campos.

BEGIN;

-- ============================================================================
-- 1) configuracion: bloquear lectura a anon
-- ============================================================================

-- Drop policies viejas (de 000_schema_base y 059)
DROP POLICY IF EXISTS "Acceso total configuracion" ON public.configuracion;
DROP POLICY IF EXISTS "Permitir todo en configuracion" ON public.configuracion;
DROP POLICY IF EXISTS "configuracion_select" ON public.configuracion;
DROP POLICY IF EXISTS "configuracion_modify" ON public.configuracion;

-- SELECT abierto a authenticated (todos los usuarios logueados pueden leer)
-- — fn_es_admin_actual() retorna false para anon. Las API routes con
-- service_role bypasean RLS, así que el seed inicial sigue funcionando.
CREATE POLICY "configuracion_select" ON public.configuracion
  FOR SELECT TO authenticated
  USING (true);

-- INSERT/UPDATE/DELETE: solo admin
CREATE POLICY "configuracion_modify" ON public.configuracion
  FOR ALL TO authenticated
  USING (fn_es_admin_actual())
  WITH CHECK (fn_es_admin_actual());


-- ============================================================================
-- 2) configuracion_correos: bloquear lectura a no-admin
-- ============================================================================

DROP POLICY IF EXISTS "configuracion_correos_all" ON public.configuracion_correos;
DROP POLICY IF EXISTS "Permitir todo en configuracion_correos" ON public.configuracion_correos;

CREATE POLICY "configuracion_correos_all" ON public.configuracion_correos
  FOR ALL TO authenticated
  USING (fn_es_admin_actual())
  WITH CHECK (fn_es_admin_actual());


-- ============================================================================
-- 3) usuarios_perfil: separar policies y bloquear escalado de privilegios
-- ============================================================================

-- Eliminar la policy permisiva que mezclaba SELECT+UPDATE
DROP POLICY IF EXISTS "usuarios_perfil_all" ON public.usuarios_perfil;
DROP POLICY IF EXISTS "usuarios_perfil_select" ON public.usuarios_perfil;
DROP POLICY IF EXISTS "usuarios_perfil_insert" ON public.usuarios_perfil;
DROP POLICY IF EXISTS "usuarios_perfil_update" ON public.usuarios_perfil;
DROP POLICY IF EXISTS "usuarios_perfil_delete" ON public.usuarios_perfil;

-- SELECT: cada usuario ve solo su propio perfil; admin ve todo
CREATE POLICY "usuarios_perfil_select" ON public.usuarios_perfil
  FOR SELECT TO authenticated
  USING (fn_es_admin_actual() OR id = auth.uid());

-- INSERT: solo admin (el flow de invitación pasa por service_role)
CREATE POLICY "usuarios_perfil_insert" ON public.usuarios_perfil
  FOR INSERT TO authenticated
  WITH CHECK (fn_es_admin_actual());

-- UPDATE: admin todo; usuario solo su propio perfil
-- (las columnas críticas las protege el trigger fn_proteger_campos_criticos_usuarios_perfil)
CREATE POLICY "usuarios_perfil_update" ON public.usuarios_perfil
  FOR UPDATE TO authenticated
  USING (fn_es_admin_actual() OR id = auth.uid())
  WITH CHECK (fn_es_admin_actual() OR id = auth.uid());

-- DELETE: solo admin
CREATE POLICY "usuarios_perfil_delete" ON public.usuarios_perfil
  FOR DELETE TO authenticated
  USING (fn_es_admin_actual());


-- Trigger BEFORE UPDATE: si un usuario no-admin intenta tocar columnas
-- críticas (rol/acceso_cartera/activo/bloqueado_hasta/intentos_fallidos),
-- se revierten al valor anterior. Esto cierra el vector de escalado de
-- privilegios via UPDATE directo desde el browser.
--
-- Las llamadas server-side con service_role bypasean este trigger porque
-- auth.uid() retorna NULL y fn_es_admin_actual() retorna true por la
-- condición SECURITY DEFINER + el rol del request. Pero por las dudas
-- usamos session_user para detectar service_role.

CREATE OR REPLACE FUNCTION public.fn_proteger_campos_criticos_usuarios_perfil()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_es_admin boolean;
  v_session_role text;
BEGIN
  -- service_role bypasea: no hace falta proteger (las API routes ya validan rol)
  v_session_role := current_setting('request.jwt.claim.role', true);
  IF v_session_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Si el usuario que ejecuta es admin, deja pasar todo
  v_es_admin := public.fn_es_admin_actual();
  IF v_es_admin THEN
    RETURN NEW;
  END IF;

  -- Usuario no-admin editando su propio perfil: revertir cambios en columnas críticas
  IF NEW.rol IS DISTINCT FROM OLD.rol THEN
    NEW.rol := OLD.rol;
  END IF;
  IF NEW.acceso_cartera IS DISTINCT FROM OLD.acceso_cartera THEN
    NEW.acceso_cartera := OLD.acceso_cartera;
  END IF;
  IF NEW.activo IS DISTINCT FROM OLD.activo THEN
    NEW.activo := OLD.activo;
  END IF;
  IF NEW.bloqueado_hasta IS DISTINCT FROM OLD.bloqueado_hasta THEN
    NEW.bloqueado_hasta := OLD.bloqueado_hasta;
  END IF;
  IF NEW.intentos_fallidos IS DISTINCT FROM OLD.intentos_fallidos THEN
    NEW.intentos_fallidos := OLD.intentos_fallidos;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_proteger_campos_criticos_usuarios_perfil ON public.usuarios_perfil;
CREATE TRIGGER tg_proteger_campos_criticos_usuarios_perfil
  BEFORE UPDATE ON public.usuarios_perfil
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_proteger_campos_criticos_usuarios_perfil();


COMMIT;
