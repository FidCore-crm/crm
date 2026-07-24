-- Migración 141: habilitar Realtime en mailing_campanas.
--
-- v1.0.180: el historial de "Envíos" del CRM (`/crm/comunicaciones` tab Envíos)
-- se actualiza en vivo mientras el cron `enviar-emails-encolados` va procesando
-- los emails de una campaña en curso. Los contadores enviados/fallidos/excluidos
-- de la fila padre y el cambio de estado PROGRAMADA → EJECUTANDO → COMPLETADA
-- se ven al instante sin apretar "Actualizar".
--
-- Requisitos del servicio Realtime de Supabase self-hosted:
--   1. Tabla dentro de la publicación `supabase_realtime`.
--   2. REPLICA IDENTITY FULL para que los eventos UPDATE tengan la fila completa
--      (sino solo llega la PK y no se puede matchear).
--
-- `email_envios` ya está en la publicación desde la migración 054.

BEGIN;

-- Idempotente: solo agregar si no está ya en la publicación.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'mailing_campanas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.mailing_campanas;
  END IF;
END $$;

ALTER TABLE public.mailing_campanas REPLICA IDENTITY FULL;

COMMIT;
