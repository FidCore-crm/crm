-- ============================================================
-- 049 — Habilitar Realtime en la tabla del agente PDF
-- ============================================================
-- El agente PDF (parser de PDFs de pólizas con IA) tiene una máquina de
-- estados async (PENDIENTE → PROCESANDO → EXTRAIDO → APROBADO/FALLIDO/
-- CANCELADO). Hoy las pantallas `/procesando` y `/revisar` polean cada 2s
-- al endpoint `/api/agente-pdf/[id]/estado` para detectar cambios.
--
-- Esta migración habilita Realtime en `pdf_procesamientos` para que el hook
-- `useAgentePDFPolling` pueda suscribirse a cambios filtrados por
-- `id=eq.<procesamiento_id>` y refrescar al instante sin polling.
-- ============================================================

DO $$
DECLARE
  tabla TEXT := 'pdf_procesamientos';
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
