-- ============================================================
-- 050 — Habilitar Realtime en la tabla de restauraciones
-- ============================================================
-- La pantalla /crm/configuracion/backups/restaurar/[id] hoy hace polling cada
-- 2s al endpoint /api/backups/restaurar/[id]/estado para detectar cuando la
-- restauración pasa por sus 10 estados (PENDIENTE → VALIDANDO → PRE_BACKUP →
-- EXTRAYENDO → RESTAURANDO_DB → RESTAURANDO_STORAGE → FINALIZANDO →
-- COMPLETADA | FALLIDA | CANCELADA).
--
-- Esta migración habilita Realtime en `restauraciones` para que el componente
-- pueda suscribirse a cambios filtrados por `id=eq.<restauracion_id>` y
-- redirigir al instante cuando llega al estado final, sin polling.
-- ============================================================

DO $$
DECLARE
  tabla TEXT := 'restauraciones';
BEGIN
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
END $$;
