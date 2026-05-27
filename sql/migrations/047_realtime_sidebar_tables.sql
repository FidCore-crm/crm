-- ============================================================
-- 047 — Habilitar Realtime en tablas que alimentan los badges del sidebar
-- ============================================================
-- El sidebar muestra contadores de:
--   - tareas vencidas         (tabla `tareas`)
--   - renovaciones pendientes (tabla `polizas`)
--   - leads nuevos            (tabla `leads`)
--   - oportunidades activas   (tabla `oportunidades`)
--   - notificaciones no leídas (ya habilitada en 046)
--
-- Esta migración suma las 4 que faltaban a la publicación `supabase_realtime`
-- con REPLICA IDENTITY FULL para que cualquier cambio dispare un refetch
-- de los contadores sin polling.
-- ============================================================

DO $$
DECLARE
  tabla TEXT;
  tablas TEXT[] := ARRAY['tareas', 'polizas', 'leads', 'oportunidades'];
BEGIN
  FOREACH tabla IN ARRAY tablas LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', tabla);

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = tabla
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tabla);
      RAISE NOTICE 'Tabla % agregada a supabase_realtime', tabla;
    ELSE
      RAISE NOTICE 'Tabla % ya estaba en supabase_realtime', tabla;
    END IF;
  END LOOP;
END $$;
