-- ============================================================
-- 051 — Habilitar Realtime en tablas centrales para listados
-- ============================================================
-- Los listados /crm/personas y /crm/siniestros hoy hacen fetch único al
-- montar y solo se actualizan cuando el PAS cambia filtros, página o
-- entra/sale de la pantalla. Si otro usuario (o el sistema vía cron, IA,
-- importador) modifica una persona o un siniestro, el listado queda con
-- data stale hasta el próximo refresh manual.
--
-- Esta migración suma `personas` y `siniestros` a la publicación
-- `supabase_realtime` con REPLICA IDENTITY FULL para habilitar suscripción
-- en los listados (pattern: refetch completo con filtros actuales ante
-- cualquier INSERT/UPDATE/DELETE, debounced 300ms).
--
-- La tabla `polizas` ya está en la publicación desde la migración 047
-- (necesaria para el badge de renovaciones del sidebar).
-- ============================================================

DO $$
DECLARE
  tabla TEXT;
  tablas TEXT[] := ARRAY['personas', 'siniestros'];
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
