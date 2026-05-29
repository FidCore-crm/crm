-- Migración 088 — Retry automático con backoff para email_envios.
--
-- Hasta ahora un email FALLIDO quedaba colgado para siempre hasta que un
-- admin lo reintentara manualmente. Si el SMTP estaba intermitente, decenas
-- de emails quedaban acumulados sin enviar y nadie se enteraba.
--
-- Ahora cada envío recuerda:
--   * intentos      — cuántas veces ya se trató de enviar
--   * proximo_intento_en — cuándo el cron puede volver a intentar
--   * error_tipo    — TRANSITORIO (vale reintentar) o PERMANENTE (no insistir)
--
-- El cron de envío levanta tanto los ENCOLADO como los FALLIDO TRANSITORIO
-- cuyo `proximo_intento_en <= NOW()` siempre que `intentos < 4`.
-- Backoff: 30 min, 2h, 8h, 24h. Después de 4 intentos queda FALLIDO definitivo.

BEGIN;

ALTER TABLE public.email_envios
  ADD COLUMN IF NOT EXISTS intentos INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS proximo_intento_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_tipo VARCHAR(20)
    CHECK (error_tipo IS NULL OR error_tipo IN ('TRANSITORIO', 'PERMANENTE'));

COMMENT ON COLUMN public.email_envios.intentos IS
  'Cuántos intentos de envío llevamos. Se incrementa cada vez que procesarEmailEncolado corre.';
COMMENT ON COLUMN public.email_envios.proximo_intento_en IS
  'Para FALLIDO TRANSITORIO: cuándo el cron puede reintentar. NULL = no reintentar más.';
COMMENT ON COLUMN public.email_envios.error_tipo IS
  'Clasificación del último error. TRANSITORIO: timeout, 4XX, rate limit (vale reintentar). PERMANENTE: email inválido, dominio caído (no reintentar).';

-- Indice parcial para acelerar la query del cron que busca pendientes.
-- Incluye ENCOLADOS listos para procesar + FALLIDOS TRANSITORIO con backoff cumplido.
CREATE INDEX IF NOT EXISTS idx_email_envios_para_procesar
  ON public.email_envios (prioridad DESC, enviar_despues_de ASC, fecha_creacion ASC)
  WHERE estado = 'ENCOLADO'
     OR (estado = 'FALLIDO' AND error_tipo = 'TRANSITORIO' AND intentos < 4 AND proximo_intento_en IS NOT NULL);

-- Backfill: los emails ENVIADO con éxito tuvieron 1 intento exitoso.
-- Los FALLIDOS previos los marcamos como TRANSITORIO con intentos=4 (sin retry)
-- para que el cron no los toque automáticamente. El admin puede reintentar
-- manualmente desde la UI; ese flow resetea intentos a 0.
UPDATE public.email_envios SET intentos = 1
WHERE estado = 'ENVIADO' AND intentos = 0;

UPDATE public.email_envios SET
  intentos = 4,
  error_tipo = 'TRANSITORIO'
WHERE estado = 'FALLIDO' AND intentos = 0;

COMMIT;
