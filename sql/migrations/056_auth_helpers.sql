-- Migración 056: Helpers SQL para auth (complementa 055)
--
-- Agrega funciones helper que el backend Node.js usa durante el login
-- y el blanqueo de password.
--
-- 1. fn_obtener_perfil_por_email: lookup de usuario por email (auth.users
--    no está expuesto por PostgREST por seguridad — usamos una función
--    SECURITY DEFINER restringida a service_role).
-- 2. fn_setear_password_directo: setea encrypted_password directamente
--    sin necesidad de pasar por un token de recovery, para el flow de
--    "blanqueo habilitado por admin".

BEGIN;

-- ============================================================================
-- 1. Buscar perfil por email
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_obtener_perfil_por_email(p_email text)
RETURNS TABLE (
  id uuid,
  email text,
  nombre varchar,
  apellido varchar,
  rol varchar,
  acceso_cartera varchar,
  activo boolean,
  bloqueado_hasta timestamptz,
  intentos_fallidos integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    au.id,
    au.email::text,
    up.nombre,
    up.apellido,
    up.rol,
    up.acceso_cartera,
    up.activo,
    up.bloqueado_hasta,
    COALESCE(up.intentos_fallidos, 0)
  FROM auth.users au
  JOIN public.usuarios_perfil up ON up.id = au.id
  WHERE LOWER(au.email::text) = LOWER(p_email)
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.fn_obtener_perfil_por_email FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_obtener_perfil_por_email TO service_role;


-- ============================================================================
-- 2. Setear password directamente (uso interno del flow de blanqueo)
-- ============================================================================
-- El admin habilita el blanqueo → el usuario define nueva contraseña.
-- Este flujo no pasa por el flow nativo de "recovery token" de GoTrue
-- (que requiere email confirmado y vuelta por mail), así que necesitamos
-- una forma de cambiar el password directamente. SECURITY DEFINER + acceso
-- solo service_role hace que sea segura.
--
-- ACEPTA EL HASH BCRYPT YA CALCULADO — el caller hace el bcrypt en Node.js.

CREATE OR REPLACE FUNCTION public.fn_setear_password_directo(
  p_usuario_id uuid,
  p_password_hash text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  UPDATE auth.users
  SET encrypted_password = p_password_hash,
      updated_at = now()
  WHERE id = p_usuario_id
$$;

REVOKE ALL ON FUNCTION public.fn_setear_password_directo FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_setear_password_directo TO service_role;


-- ============================================================================
-- 3. Cambiar email (uso futuro — por ahora no se expone en UI)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_cambiar_email(
  p_usuario_id uuid,
  p_nuevo_email text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  UPDATE auth.users
  SET email = LOWER(p_nuevo_email),
      email_confirmed_at = COALESCE(email_confirmed_at, now()),
      updated_at = now()
  WHERE id = p_usuario_id
$$;

REVOKE ALL ON FUNCTION public.fn_cambiar_email FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_cambiar_email TO service_role;


-- ============================================================================
-- 4. Invalidar TODAS las sesiones de auth (usado por backup-restore)
-- ============================================================================
-- Después de restaurar la DB, las sesiones del backup podrían tener tokens
-- viejos o usuarios eliminados. Mejor que todos vuelvan a loguearse.

CREATE OR REPLACE FUNCTION public.fn_invalidar_todas_sesiones_auth()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  DELETE FROM auth.refresh_tokens;
  DELETE FROM auth.sessions;
$$;

REVOKE ALL ON FUNCTION public.fn_invalidar_todas_sesiones_auth FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_invalidar_todas_sesiones_auth TO service_role;

COMMIT;
