-- Migración 055: Setup de Supabase Auth
--
-- Migra el sistema de autenticación custom (tabla `usuarios` + tabla `sesiones`
-- + bcrypt manual) a Supabase Auth (auth.users + auth.sessions + GoTrue).
--
-- ESTRATEGIA: Modo dual. La tabla `usuarios` original NO se elimina en esta
-- migración — sigue existiendo en paralelo a `auth.users` durante el sprint
-- de refactor. Cuando todo el sprint esté validado, una migración futura
-- consolida y elimina la tabla `usuarios` original.
--
-- IMPORTANTE: Esta migración:
-- 1. NO toca FKs existentes (todas siguen apuntando a `public.usuarios.id`).
--    Como copiamos los mismos UUIDs a auth.users, las FKs quedan válidas.
-- 2. Importa el hash bcrypt directo (GoTrue soporta bcrypt nativamente).
-- 3. Es idempotente: se puede correr varias veces sin romper nada.

BEGIN;

-- ============================================================================
-- 1. Tabla `usuarios_perfil` — extiende auth.users con los campos del CRM
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.usuarios_perfil (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre varchar NOT NULL,
  apellido varchar NOT NULL,
  rol varchar NOT NULL DEFAULT 'USUARIO' CHECK (rol IN ('ADMIN', 'USUARIO')),
  acceso_cartera varchar NOT NULL DEFAULT 'PROPIA' CHECK (acceso_cartera IN ('TOTAL', 'PROPIA')),
  activo boolean DEFAULT true,
  ultimo_acceso timestamptz,
  intentos_fallidos integer DEFAULT 0,
  bloqueado_hasta timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_perfil_activo ON public.usuarios_perfil(activo);
CREATE INDEX IF NOT EXISTS idx_usuarios_perfil_rol ON public.usuarios_perfil(rol);

-- Trigger para mantener updated_at (usa la función existente)
DROP TRIGGER IF EXISTS tg_usuarios_perfil_updated_at ON public.usuarios_perfil;
CREATE TRIGGER tg_usuarios_perfil_updated_at
  BEFORE UPDATE ON public.usuarios_perfil
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();

-- Habilitar RLS (policies se agregan en migración posterior cuando se hace #68)
ALTER TABLE public.usuarios_perfil ENABLE ROW LEVEL SECURITY;

-- Policy permisiva temporal (mismo patrón que el resto del CRM por ahora)
DROP POLICY IF EXISTS "Permitir todo en usuarios_perfil" ON public.usuarios_perfil;
CREATE POLICY "Permitir todo en usuarios_perfil" ON public.usuarios_perfil
  USING (true) WITH CHECK (true);


-- ============================================================================
-- 2. Migración de datos: usuarios → auth.users + usuarios_perfil
-- ============================================================================
-- Para cada usuario activo en public.usuarios:
--   a) Copiar a auth.users con el mismo UUID (preserva FKs).
--   b) Crear usuarios_perfil con los datos custom.
-- Idempotente: si ya existe el usuario en auth.users, se actualiza el perfil.

-- IMPORTANTE: GoTrue espera que las columnas de tipo varchar en auth.users
-- sean string vacío `''`, no NULL. Si quedan NULL, la admin API tira
-- "converting NULL to string is unsupported" al hacer GET /admin/users.
-- Por eso seteamos explícitamente '' en confirmation_token, recovery_token,
-- email_change_token_new, email_change, email_change_token_current y
-- reauthentication_token.

INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  last_sign_in_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  email_change_token_current,
  reauthentication_token
)
SELECT
  u.id,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  u.email,
  u.password_hash, -- bcrypt directo, GoTrue lo entiende
  COALESCE(u.created_at, now()), -- usuarios existentes se marcan como email confirmado
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
  jsonb_build_object(
    'nombre', u.nombre,
    'apellido', u.apellido
  ),
  COALESCE(u.created_at, now()),
  COALESCE(u.updated_at, now()),
  u.ultimo_acceso,
  '', -- confirmation_token
  '', -- recovery_token
  '', -- email_change_token_new
  '', -- email_change
  '', -- email_change_token_current
  ''  -- reauthentication_token
FROM public.usuarios u
WHERE u.activo = true
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  encrypted_password = EXCLUDED.encrypted_password,
  raw_user_meta_data = EXCLUDED.raw_user_meta_data,
  updated_at = EXCLUDED.updated_at,
  confirmation_token = COALESCE(auth.users.confirmation_token, ''),
  recovery_token = COALESCE(auth.users.recovery_token, ''),
  email_change_token_new = COALESCE(auth.users.email_change_token_new, ''),
  email_change = COALESCE(auth.users.email_change, ''),
  email_change_token_current = COALESCE(auth.users.email_change_token_current, ''),
  reauthentication_token = COALESCE(auth.users.reauthentication_token, '');

-- Crear identities (GoTrue requiere una identity por usuario para login con email)
INSERT INTO auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  last_sign_in_at,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email),
  'email',
  u.id::text,
  u.ultimo_acceso,
  COALESCE(u.created_at, now()),
  COALESCE(u.updated_at, now())
FROM public.usuarios u
WHERE u.activo = true
  AND NOT EXISTS (
    SELECT 1 FROM auth.identities i
    WHERE i.user_id = u.id AND i.provider = 'email'
  );

-- Crear usuarios_perfil con los datos custom
INSERT INTO public.usuarios_perfil (
  id,
  nombre,
  apellido,
  rol,
  acceso_cartera,
  activo,
  ultimo_acceso,
  intentos_fallidos,
  bloqueado_hasta,
  created_at,
  updated_at
)
SELECT
  u.id,
  u.nombre,
  u.apellido,
  u.rol,
  u.acceso_cartera,
  u.activo,
  u.ultimo_acceso,
  COALESCE(u.intentos_fallidos, 0),
  u.bloqueado_hasta,
  COALESCE(u.created_at, now()),
  COALESCE(u.updated_at, now())
FROM public.usuarios u
WHERE u.activo = true
ON CONFLICT (id) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  apellido = EXCLUDED.apellido,
  rol = EXCLUDED.rol,
  acceso_cartera = EXCLUDED.acceso_cartera,
  activo = EXCLUDED.activo,
  ultimo_acceso = EXCLUDED.ultimo_acceso,
  intentos_fallidos = EXCLUDED.intentos_fallidos,
  bloqueado_hasta = EXCLUDED.bloqueado_hasta;


-- ============================================================================
-- 3. Trigger: cuando se crea un auth.users, crear su usuarios_perfil
-- ============================================================================
-- Esto permite que `supabase.auth.admin.createUser()` o un signup vía API
-- automáticamente cree el perfil del CRM. Los datos de `nombre`/`apellido`
-- vienen de `raw_user_meta_data`.

CREATE OR REPLACE FUNCTION public.fn_crear_usuarios_perfil()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.usuarios_perfil (id, nombre, apellido, rol, acceso_cartera)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nombre', 'Sin nombre'),
    COALESCE(NEW.raw_user_meta_data->>'apellido', 'Sin apellido'),
    COALESCE(NEW.raw_user_meta_data->>'rol', 'USUARIO'),
    COALESCE(NEW.raw_user_meta_data->>'acceso_cartera', 'PROPIA')
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tg_crear_usuarios_perfil ON auth.users;
CREATE TRIGGER tg_crear_usuarios_perfil
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_crear_usuarios_perfil();


-- ============================================================================
-- 4. JWT Custom Claims Hook — inyecta rol y acceso_cartera en el JWT
-- ============================================================================
-- GoTrue llama a esta función cada vez que emite un access token. Lo que
-- devuelve se mergea en el campo `app_metadata` del JWT.
-- Resultado: el JWT que llega al frontend ya contiene `rol` y `acceso_cartera`,
-- así no hace falta consultar usuarios_perfil en cada request.
-- Resuelve la tarea #97.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims jsonb;
  user_perfil RECORD;
BEGIN
  -- Obtener el perfil del usuario que está logueándose
  SELECT rol, acceso_cartera, activo, nombre, apellido
  INTO user_perfil
  FROM public.usuarios_perfil
  WHERE id = (event->>'user_id')::uuid;

  claims := event->'claims';

  -- Si el usuario está desactivado, no le agregamos claims (login se rechazará downstream)
  IF user_perfil.activo = false THEN
    RETURN event;
  END IF;

  -- Inyectar campos custom en app_metadata
  claims := jsonb_set(claims, '{app_metadata}',
    COALESCE(claims->'app_metadata', '{}'::jsonb) ||
    jsonb_build_object(
      'rol', COALESCE(user_perfil.rol, 'USUARIO'),
      'acceso_cartera', COALESCE(user_perfil.acceso_cartera, 'PROPIA'),
      'nombre', user_perfil.nombre,
      'apellido', user_perfil.apellido
    )
  );

  RETURN jsonb_build_object('claims', claims);
END;
$$;

-- Permisos: GoTrue corre con un rol específico que tiene que poder ejecutar
-- esta función. Le damos permiso explícito.
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
GRANT SELECT ON public.usuarios_perfil TO supabase_auth_admin;


-- ============================================================================
-- 5. Helper para queries que usan auth.uid() — acceso_cartera del usuario actual
-- ============================================================================
-- Función que devuelve el `acceso_cartera` del usuario logueado. Útil para
-- las policies RLS que vamos a crear en migración futura (#68).

CREATE OR REPLACE FUNCTION public.fn_acceso_cartera_actual()
RETURNS varchar
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT acceso_cartera FROM public.usuarios_perfil WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.fn_rol_actual()
RETURNS varchar
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT rol FROM public.usuarios_perfil WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.fn_es_admin_actual()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT rol = 'ADMIN' FROM public.usuarios_perfil WHERE id = auth.uid()
$$;


-- ============================================================================
-- 6. Confirmación post-migración
-- ============================================================================
-- Verificamos que la migración funcionó: cuenta de usuarios y perfiles.

DO $$
DECLARE
  usuarios_count integer;
  auth_users_count integer;
  perfiles_count integer;
BEGIN
  SELECT COUNT(*) INTO usuarios_count FROM public.usuarios WHERE activo = true;
  SELECT COUNT(*) INTO auth_users_count FROM auth.users WHERE id IN (SELECT id FROM public.usuarios WHERE activo = true);
  SELECT COUNT(*) INTO perfiles_count FROM public.usuarios_perfil;

  RAISE NOTICE 'Migración 055: usuarios activos=% | auth.users sincronizados=% | usuarios_perfil=%',
    usuarios_count, auth_users_count, perfiles_count;

  IF usuarios_count > 0 AND auth_users_count != usuarios_count THEN
    RAISE WARNING 'Mismatch: hay % usuarios activos pero solo % en auth.users', usuarios_count, auth_users_count;
  END IF;
END $$;

COMMIT;
