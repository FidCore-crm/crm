-- ============================================================
-- 046 — Habilitar Realtime en tablas que el cliente escucha
-- ============================================================
-- Supabase Realtime emite eventos solo para tablas incluidas en la
-- publication `supabase_realtime`. Esta migración la prepara para que
-- el navbar y sidebar reciban INSERT/UPDATE/DELETE en vivo.
--
-- Tablas habilitadas en este sprint:
--   - notificaciones (campana del navbar)
--
-- Se agregarán más en migraciones siguientes a medida que se incorpore
-- Realtime a otras pantallas (badges sidebar, importador, agente PDF, etc.).
--
-- Notas:
--   * `ALTER PUBLICATION ... ADD TABLE` es idempotente solo si la tabla
--     no estaba; usamos un DO con chequeo para que la migración pueda
--     correrse varias veces sin tirar.
--   * REPLICA IDENTITY FULL en cada tabla agregada para que el payload
--     de UPDATE/DELETE incluya el row completo (necesario para que el
--     cliente decida si la fila aún cumple sus filtros).
-- ============================================================

DO $$
DECLARE
  tabla TEXT;
  tablas TEXT[] := ARRAY['notificaciones'];
BEGIN
  FOREACH tabla IN ARRAY tablas LOOP
    -- Set REPLICA IDENTITY FULL (idempotente)
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', tabla);

    -- Agregar a la publicación si no estaba
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
