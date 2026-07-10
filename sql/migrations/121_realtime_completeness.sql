-- ============================================================
-- 121 — Agregar tablas restantes a la publicación supabase_realtime
-- ============================================================
-- Cierra el checklist de completeness Realtime post-v1.0.97:
--   - facturacion: /crm/facturacion/page.tsx muestra movimientos multi-usuario
--   - catalogos: dropdowns de ramo/compañía/cobertura/etc. deben reflejar en el
--     acto cuando un admin agrega uno nuevo (hoy hay que refrescar).
--   - tipo_catalogo: raramente cambia pero es coherente sumarla.
--   - postits: la sección de post-its del dashboard es colaborativa.
-- ============================================================

DO $$
DECLARE
  tabla TEXT;
  tablas TEXT[] := ARRAY[
    'facturacion',
    'catalogos',
    'tipo_catalogo',
    'postits'
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
