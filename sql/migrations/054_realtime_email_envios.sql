-- ============================================================
-- 054 — Realtime sobre email_envios
-- ============================================================
-- El tab "Comunicaciones" de las fichas de persona y póliza muestra el
-- historial de emails (encolados/enviando/enviados/fallidos). Antes hacía
-- fetch al cargar y al apretar refresh; ahora se suscribe vía Realtime al
-- canal `comunicaciones-{persona|poliza}-{id}` filtrado por persona_id o
-- poliza_id, y refetcha cuando hay cualquier cambio (INSERT del encolado,
-- UPDATE del cron procesando, UPDATE al marcarse ENVIADO, etc.).
--
-- Para que Realtime emita eventos sobre email_envios la tabla tiene que estar
-- en la publicación `supabase_realtime` con `REPLICA IDENTITY FULL` (sino
-- los UPDATEs llegarían sin el old_record, que es lo que el filtro necesita
-- para evaluar las condiciones).
-- ============================================================

ALTER TABLE email_envios REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'email_envios'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.email_envios;
    RAISE NOTICE 'email_envios agregada a supabase_realtime';
  ELSE
    RAISE NOTICE 'email_envios ya estaba en supabase_realtime, skip';
  END IF;
END $$;
