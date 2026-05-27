-- ============================================================
-- Migración 024 — Vista v_polizas_pendientes_renovar
-- ============================================================
--
-- Centraliza la lógica de "pólizas que merecen aparecer en el
-- listado de Renovaciones": vigentes próximas a vencer, RENOVADAs
-- latentes y NO_VIGENTE-sin-renovar.
--
-- Una "renovación activa" es una hija con estado RENOVADA, VIGENTE
-- o PROGRAMADA. Las CANCELADA/ANULADA no cuentan (deberían haber
-- sido eliminadas, pero por defensiva las excluimos también).
--
-- Esta vista reemplaza la lógica client-side que cargaba todos los
-- IDs con renovación en memoria — escala bien a carteras grandes.
--
-- Idempotente.
-- ============================================================

CREATE OR REPLACE VIEW v_polizas_pendientes_renovar AS
SELECT
  p.id,
  p.numero_poliza,
  p.estado,
  p.fecha_inicio,
  p.fecha_fin,
  p.asegurado_id,
  p.compania_id,
  p.ramo_id,
  p.cobertura_id,
  -- TRUE si la póliza ya tiene una hija "viva" como renovación
  EXISTS (
    SELECT 1 FROM polizas h
    WHERE h.poliza_origen_id = p.id
      AND h.estado IN ('RENOVADA', 'VIGENTE', 'PROGRAMADA')
  ) AS tiene_renovacion_activa,
  -- Días hasta vencer (negativo si ya venció)
  (p.fecha_fin - CURRENT_DATE) AS dias_hasta_fin,
  -- Categoría para que el frontend pueda filtrar fácil sin re-implementar la lógica
  CASE
    WHEN p.estado = 'VIGENTE' AND p.fecha_fin >= CURRENT_DATE AND p.fecha_fin <= CURRENT_DATE + INTERVAL '30 days'
      THEN 'POR_VENCER'
    WHEN p.estado = 'RENOVADA'
      THEN 'RENOVADA_LATENTE'
    WHEN p.estado = 'NO_VIGENTE'
      AND NOT EXISTS (
        SELECT 1 FROM polizas h
        WHERE h.poliza_origen_id = p.id
          AND h.estado IN ('RENOVADA', 'VIGENTE', 'PROGRAMADA')
      )
      THEN 'VENCIDA_SIN_RENOVAR'
    ELSE NULL
  END AS categoria_renovacion
FROM polizas p
WHERE
  -- Solo lo que el listado de renovaciones puede llegar a mostrar
  (p.estado = 'VIGENTE' AND p.fecha_fin <= CURRENT_DATE + INTERVAL '30 days')
  OR p.estado = 'RENOVADA'
  OR p.estado = 'NO_VIGENTE';

COMMENT ON VIEW v_polizas_pendientes_renovar IS
  'Pólizas relevantes para el módulo de Renovaciones. Incluye flag tiene_renovacion_activa para distinguir pólizas vencidas que ya fueron renovadas (no deben aparecer "para renovar") vs. las que faltan renovar.';
