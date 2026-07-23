-- Migración 138: agrupamiento de envíos masivos y campañas.
--
-- Objetivo: cuando el PAS manda un email masivo a N destinatarios (o ejecuta
-- una campaña), hoy se generan N filas independientes en `email_envios` sin
-- referencia común. El historial de comunicaciones queda como pared de miles
-- de rows sin agrupación semántica.
--
-- Solución: agregar `email_envios.envio_agrupado_id` (FK opcional a
-- `mailing_campanas`). Reusamos la tabla existente como "envío agrupado" —
-- tanto para campañas del wizard como para envíos masivos simples desde los
-- listados. La UI del historial ofrece una vista agrupada (1 fila por
-- campaña, expandible a los N destinatarios) además de la vista plana actual.
--
-- Retrocompat total:
--   - `envio_agrupado_id` es NULL por default.
--   - Rows viejos con NULL siguen listándose como sueltos.
--   - Backfill por proximidad para envíos masivos históricos (mismo asunto +
--     mismo usuario + ventana temporal ±5 min).
--   - Rows AUTOMATICO_*, MANUAL, NOTIFICACION_INTERNA no se agrupan (son 1-a-1).

BEGIN;

ALTER TABLE public.email_envios
  ADD COLUMN IF NOT EXISTS envio_agrupado_id UUID
  REFERENCES public.mailing_campanas(id) ON DELETE SET NULL;

-- Índice para acelerar el join desde la vista agrupada + el count de
-- destinatarios por campaña.
CREATE INDEX IF NOT EXISTS idx_email_envios_agrupado
  ON public.email_envios (envio_agrupado_id)
  WHERE envio_agrupado_id IS NOT NULL;

COMMENT ON COLUMN public.email_envios.envio_agrupado_id IS
  'FK a mailing_campanas cuando el envío forma parte de una campaña o envío masivo. NULL para envíos individuales (MANUAL, AUTOMATICO_*, NOTIFICACION_INTERNA).';

-- ---------------------------------------------------------------------------
-- Backfill: agrupar rows históricos MASIVO por proximidad.
--
-- Criterio: mismo `enviado_por_usuario_id` + mismo `asunto` + creados dentro
-- de una ventana de 5 minutos → forman parte del mismo envío masivo.
--
-- Genera una fila en `mailing_campanas` por cada grupo detectado, con:
--   - nombre autogenerado ("Envío masivo — {asunto} — {fecha}")
--   - personas_ids = array de persona_ids de los rows
--   - métricas agregadas
--   - estado=COMPLETADA
--   - fechas del primer envío
--
-- Idempotente: solo procesa rows que aún no tienen envio_agrupado_id.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  grupo RECORD;
  nueva_campana_id UUID;
BEGIN
  -- Agrupar por (usuario, asunto, ventana de 5 min desde el primer envío del grupo).
  -- Usamos window functions para calcular el "líder" de cada grupo.
  FOR grupo IN
    WITH candidatos AS (
      SELECT
        id,
        enviado_por_usuario_id,
        asunto,
        persona_id,
        fecha_creacion,
        estado,
        -- floor de tiempo por bucket de 5 min desde epoch
        FLOOR(EXTRACT(EPOCH FROM fecha_creacion) / 300)::BIGINT AS bucket_5min
      FROM public.email_envios
      WHERE tipo_envio = 'MASIVO'
        AND envio_agrupado_id IS NULL
        AND asunto IS NOT NULL
        AND enviado_por_usuario_id IS NOT NULL
    ),
    grupos AS (
      SELECT
        enviado_por_usuario_id,
        asunto,
        bucket_5min,
        MIN(fecha_creacion) AS fecha_grupo,
        ARRAY_AGG(id) AS envio_ids,
        ARRAY_AGG(DISTINCT persona_id) FILTER (WHERE persona_id IS NOT NULL) AS personas_ids,
        COUNT(*) AS total,
        SUM(CASE WHEN estado = 'ENVIADO' THEN 1 ELSE 0 END) AS enviados,
        SUM(CASE WHEN estado = 'FALLIDO' THEN 1 ELSE 0 END) AS fallidos,
        SUM(CASE WHEN estado IN ('EXCLUIDO_BAJA', 'EXCLUIDO_NO_MARKETING') THEN 1 ELSE 0 END) AS excluidos
      FROM candidatos
      GROUP BY enviado_por_usuario_id, asunto, bucket_5min
      -- Solo agrupamos si hay 2+ envíos (grupos de 1 quedan como sueltos).
      HAVING COUNT(*) >= 2
    )
    SELECT * FROM grupos
  LOOP
    -- Crear la campaña padre.
    INSERT INTO public.mailing_campanas (
      nombre,
      descripcion,
      personas_ids,
      asunto_libre,
      cuerpo_libre,
      estado,
      total_destinatarios,
      enviados,
      fallidos,
      excluidos,
      fecha_inicio_ejecucion,
      fecha_fin_ejecucion,
      usuario_creador_id,
      created_at,
      updated_at
    ) VALUES (
      LEFT('Envío masivo — ' || grupo.asunto, 200),
      'Reconstruido automáticamente desde envíos históricos (migración 138).',
      COALESCE(grupo.personas_ids, '{}'::uuid[]),
      grupo.asunto,
      '(reconstruido)',
      'COMPLETADA',
      grupo.total,
      grupo.enviados,
      grupo.fallidos,
      grupo.excluidos,
      grupo.fecha_grupo,
      grupo.fecha_grupo,
      grupo.enviado_por_usuario_id,
      grupo.fecha_grupo,
      grupo.fecha_grupo
    )
    RETURNING id INTO nueva_campana_id;

    -- Linkear todos los email_envios del grupo a la campaña recién creada.
    UPDATE public.email_envios
    SET envio_agrupado_id = nueva_campana_id
    WHERE id = ANY(grupo.envio_ids);
  END LOOP;
END $$;

COMMIT;
