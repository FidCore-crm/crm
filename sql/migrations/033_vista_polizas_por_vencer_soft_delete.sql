-- ============================================================
-- 033_vista_polizas_por_vencer_soft_delete.sql
--
-- Recrea la vista `v_polizas_por_vencer` agregando el filtro de
-- soft-delete sobre `personas`. Las personas en papelera
-- (deleted_at IS NOT NULL, introducido en migración 025) ya no
-- deben aparecer como asegurados de pólizas por vencer en ningún
-- listado, KPI ni cron que consuma esta vista.
--
-- El resto de las columnas y filtros queda idéntico a la versión
-- creada en la migración 019.
-- ============================================================

BEGIN;

DROP VIEW IF EXISTS v_polizas_por_vencer CASCADE;

CREATE VIEW v_polizas_por_vencer AS
SELECT
  p.id AS poliza_id,
  p.numero_poliza,
  p.fecha_fin,
  (p.fecha_fin - CURRENT_DATE) AS dias_restantes,
  p.estado AS estado_poliza,
  pe.id AS persona_id,
  COALESCE(
    NULLIF(TRIM(CONCAT_WS(', ', pe.apellido, pe.nombre)), ','),
    pe.razon_social,
    pe.apellido
  ) AS nombre_completo,
  pe.dni_cuil,
  pe.email,
  pe.telefono,
  pe.whatsapp,
  COALESCE(c.nombre, '—') AS compania,
  COALESCE(r.nombre, '—') AS ramo,
  CASE
    WHEN p.fecha_fin < CURRENT_DATE THEN 'VENCIDA'
    WHEN p.fecha_fin - CURRENT_DATE <= 7 THEN 'URGENTE'
    WHEN p.fecha_fin - CURRENT_DATE <= 15 THEN 'CRITICA'
    WHEN p.fecha_fin - CURRENT_DATE <= 30 THEN 'PROXIMA'
    ELSE 'NORMAL'
  END AS prioridad_alerta
FROM polizas p
INNER JOIN personas pe
       ON pe.id = p.asegurado_id
      AND pe.deleted_at IS NULL
LEFT JOIN catalogos c ON c.id = p.compania_id
LEFT JOIN catalogos r ON r.id = p.ramo_id
WHERE p.estado = 'VIGENTE';

COMMIT;

NOTIFY pgrst, 'reload schema';
