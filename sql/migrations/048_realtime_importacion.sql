-- ============================================================
-- 048 — Habilitar Realtime en tablas del importador
-- ============================================================
-- El flujo del importador tiene 5 pantallas que hoy hacen polling cada 2s:
--   /procesando, /progreso, /importando, /revisar, /completada
-- Cada una usa el hook useImportacionPolling que llama a
-- /api/importar/[id]/estado.
--
-- Esta migración habilita Realtime en las tablas que ese endpoint lee:
--   - importaciones                 (estado de la importación)
--   - importacion_lotes             (progreso por lote)
--   - importacion_jobs              (cola de procesamiento)
--   - importacion_registros_dudosos (dudosos a revisar)
-- ============================================================

DO $$
DECLARE
  tabla TEXT;
  tablas TEXT[] := ARRAY[
    'importaciones',
    'importacion_lotes',
    'importacion_jobs',
    'importacion_registros_dudosos'
  ];
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
