-- Migración 126: Biblioteca de recursos (imágenes) para emails.
--
-- Contexto: el PAS quiere poder insertar imágenes (flyers, banners, logos) en
-- el cuerpo de los emails (plantillas + campañas + envíos manuales). Los
-- recursos se guardan una vez y se reusan entre envíos, organizados en
-- carpetas anidadas.
--
-- Modelo:
-- - biblioteca_carpetas: árbol jerárquico. parent_id NULL = raíz.
-- - biblioteca_archivos: cada archivo pertenece a una carpeta (o NULL = raíz).
--
-- Compartido entre todos los usuarios (regla del sprint). Admin gestiona.
-- Cualquier usuario autenticado puede usar los recursos al enviar mails.

BEGIN;

-- ============================================================================
-- 1. Carpetas (jerárquico)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.biblioteca_carpetas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(120) NOT NULL,
  parent_id UUID REFERENCES public.biblioteca_carpetas(id) ON DELETE CASCADE,
  orden INTEGER NOT NULL DEFAULT 0,
  creado_por_usuario_id UUID REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- No permitir 2 carpetas con el mismo nombre en el mismo nivel.
  -- Índice parcial para raíz (parent_id IS NULL): PostgreSQL trata NULLs como
  -- distintos en UNIQUE estándar, así que usamos un índice parcial + otro
  -- estándar para no-raíz.
  CONSTRAINT biblioteca_carpetas_nombre_no_vacio CHECK (length(trim(nombre)) > 0),
  CONSTRAINT biblioteca_carpetas_no_self_parent CHECK (id <> parent_id)
);

-- Uno para carpetas dentro de otras carpetas.
CREATE UNIQUE INDEX IF NOT EXISTS idx_biblioteca_carpetas_nombre_hijo
  ON public.biblioteca_carpetas (parent_id, nombre)
  WHERE parent_id IS NOT NULL;

-- Uno para carpetas en la raíz.
CREATE UNIQUE INDEX IF NOT EXISTS idx_biblioteca_carpetas_nombre_raiz
  ON public.biblioteca_carpetas (nombre)
  WHERE parent_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_biblioteca_carpetas_parent
  ON public.biblioteca_carpetas (parent_id, orden);

-- Trigger updated_at automático (usa fn_actualizar_updated_at de migración 052)
DROP TRIGGER IF EXISTS tg_actualizar_updated_at_biblioteca_carpetas ON public.biblioteca_carpetas;
CREATE TRIGGER tg_actualizar_updated_at_biblioteca_carpetas
  BEFORE UPDATE ON public.biblioteca_carpetas
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_actualizar_updated_at();

-- ============================================================================
-- 2. Archivos
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.biblioteca_archivos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carpeta_id UUID REFERENCES public.biblioteca_carpetas(id) ON DELETE SET NULL,
  nombre_archivo VARCHAR(255) NOT NULL,
  ruta TEXT NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  tamano_bytes BIGINT NOT NULL,
  subido_por_usuario_id UUID REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL,
  usos_count INTEGER NOT NULL DEFAULT 0,
  ultimo_uso_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT biblioteca_archivos_mime_imagen CHECK (
    mime_type IN ('image/jpeg', 'image/png', 'image/gif', 'image/webp')
  ),
  CONSTRAINT biblioteca_archivos_tamano_positivo CHECK (tamano_bytes > 0)
);

CREATE INDEX IF NOT EXISTS idx_biblioteca_archivos_carpeta
  ON public.biblioteca_archivos (carpeta_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_biblioteca_archivos_recientes
  ON public.biblioteca_archivos (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_biblioteca_archivos_mas_usados
  ON public.biblioteca_archivos (usos_count DESC, ultimo_uso_at DESC);

-- ============================================================================
-- 3. RLS
-- ============================================================================
--
-- Ambas tablas: SELECT libre para authenticated (todos los usuarios ven la
-- biblioteca compartida). Modificaciones solo desde service_role (API routes).
-- Endpoint público de servir imagen usa service_role también.

ALTER TABLE public.biblioteca_carpetas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.biblioteca_archivos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS biblioteca_carpetas_select_authenticated ON public.biblioteca_carpetas;
CREATE POLICY biblioteca_carpetas_select_authenticated
  ON public.biblioteca_carpetas
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS biblioteca_archivos_select_authenticated ON public.biblioteca_archivos;
CREATE POLICY biblioteca_archivos_select_authenticated
  ON public.biblioteca_archivos
  FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================================
-- 4. Realtime
-- ============================================================================

ALTER TABLE public.biblioteca_carpetas REPLICA IDENTITY FULL;
ALTER TABLE public.biblioteca_archivos REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'biblioteca_carpetas'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.biblioteca_carpetas';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'biblioteca_archivos'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.biblioteca_archivos';
  END IF;
END $$;

COMMIT;
