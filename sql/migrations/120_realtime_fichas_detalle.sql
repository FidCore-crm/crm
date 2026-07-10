-- ============================================================
-- 120 — Habilitar Realtime en tablas de detalle (fichas de póliza/persona/siniestro)
-- ============================================================
-- Sumamos a la publicación `supabase_realtime` las tablas hijas que alimentan
-- las fichas detalle. Sin esto, un cambio en un riesgo/endoso/archivo/bitácora
-- desde otra sesión no reflejaba en la ficha abierta hasta hacer F5.
--
-- La filosofía del CRM (documentada en CLAUDE.md sección "Supabase Realtime")
-- es: si el usuario está mirando una ficha y otro usuario/proceso la toca, la
-- ficha se actualiza al instante. Este cambio + el fix del cliente browser
-- (realtime.setAuth con JWT del usuario) cierran el círculo.
--
-- Tablas nuevas en la publicación (con REPLICA IDENTITY FULL):
--   riesgos, endosos, poliza_bitacora, poliza_archivos,
--   siniestro_bitacora, siniestro_archivos, persona_bitacora,
--   cotizaciones, cotizacion_companias, interacciones
-- ============================================================

DO $$
DECLARE
  tabla TEXT;
  tablas TEXT[] := ARRAY[
    'riesgos',
    'endosos',
    'poliza_bitacora',
    'poliza_archivos',
    'siniestro_bitacora',
    'siniestro_archivos',
    'persona_bitacora',
    'cotizaciones',
    'cotizacion_companias',
    'interacciones'
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
