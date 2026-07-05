-- ============================================================
-- 113 — Tabla de eventos independientes (agenda personal / equipo)
-- ============================================================
-- Los eventos son ítems del calendario que NO están atados a personas,
-- pólizas ni siniestros. Sirven para que el PAS pueda anotar cosas de
-- agenda personal o del equipo (curso SSN, reunión, cumpleaños,
-- vencimiento fiscal) sin forzarlos a inventar una entidad ficticia.
--
-- Diseño:
-- - Cada evento tiene un dueño (`usuario_id`).
-- - Si `compartido = false`, solo el dueño lo ve.
-- - Si `compartido = true`, todos los usuarios activos lo ven.
-- - Admin ve todos.
-- - Soporta recurrencia con los mismos valores que tareas
--   (NINGUNA/DIARIA/SEMANAL/MENSUAL/ANUAL).
-- - Estado: PROGRAMADO / COMPLETADO / CANCELADO.
-- - Hora de inicio y fin opcionales.
-- - Categoría libre para pintar chips en el calendario.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.eventos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id    UUID NOT NULL REFERENCES public.usuarios_perfil(id) ON DELETE CASCADE,
  titulo        VARCHAR(200) NOT NULL,
  descripcion   TEXT,
  fecha         DATE NOT NULL,
  hora_inicio   TIME,
  hora_fin      TIME,
  categoria     VARCHAR(60),
  recurrencia   VARCHAR(20) NOT NULL DEFAULT 'NINGUNA'
                CHECK (recurrencia IN ('NINGUNA','DIARIA','SEMANAL','MENSUAL','ANUAL')),
  estado        VARCHAR(20) NOT NULL DEFAULT 'PROGRAMADO'
                CHECK (estado IN ('PROGRAMADO','COMPLETADO','CANCELADO')),
  compartido    BOOLEAN NOT NULL DEFAULT false,
  nota_cierre   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eventos_usuario_fecha
  ON public.eventos (usuario_id, fecha);
CREATE INDEX IF NOT EXISTS idx_eventos_fecha
  ON public.eventos (fecha);
CREATE INDEX IF NOT EXISTS idx_eventos_compartido_fecha
  ON public.eventos (compartido, fecha) WHERE compartido = true;

-- Trigger para mantener updated_at (usa la función global existente)
DROP TRIGGER IF EXISTS tg_eventos_updated_at ON public.eventos;
CREATE TRIGGER tg_eventos_updated_at
  BEFORE UPDATE ON public.eventos
  FOR EACH ROW EXECUTE FUNCTION public.fn_actualizar_updated_at();

-- ─────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.eventos ENABLE ROW LEVEL SECURITY;

-- SELECT: dueño, admin/TOTAL, o compartido = true
DROP POLICY IF EXISTS "eventos_select" ON public.eventos;
CREATE POLICY "eventos_select" ON public.eventos FOR SELECT TO authenticated, anon
  USING (
    fn_acceso_total_actual()
    OR usuario_id = auth.uid()
    OR compartido = true
  );

-- INSERT: cualquier usuario autenticado puede crear eventos propios
DROP POLICY IF EXISTS "eventos_insert" ON public.eventos;
CREATE POLICY "eventos_insert" ON public.eventos FOR INSERT TO authenticated
  WITH CHECK (
    fn_acceso_total_actual()
    OR usuario_id = auth.uid()
  );

-- UPDATE: dueño o admin/TOTAL
DROP POLICY IF EXISTS "eventos_update" ON public.eventos;
CREATE POLICY "eventos_update" ON public.eventos FOR UPDATE TO authenticated
  USING (fn_acceso_total_actual() OR usuario_id = auth.uid())
  WITH CHECK (fn_acceso_total_actual() OR usuario_id = auth.uid());

-- DELETE: dueño o admin/TOTAL
DROP POLICY IF EXISTS "eventos_delete" ON public.eventos;
CREATE POLICY "eventos_delete" ON public.eventos FOR DELETE TO authenticated
  USING (fn_acceso_total_actual() OR usuario_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- Realtime
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.eventos REPLICA IDENTITY FULL';
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'eventos'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.eventos';
    RAISE NOTICE 'Tabla eventos agregada a supabase_realtime';
  ELSE
    RAISE NOTICE 'Tabla eventos ya estaba en supabase_realtime';
  END IF;
END $$;
