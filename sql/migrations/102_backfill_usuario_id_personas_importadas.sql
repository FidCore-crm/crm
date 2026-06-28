-- Migración 102: backfill de usuario_id en personas importadas (v1.0.54).
--
-- El importador de cartera (`ejecutarImportacionFinal`) no estaba propagando
-- el `usuario_id` del PAS que lanzó la importación a las personas creadas.
-- Esto dejó toda la cartera importada con `personas.usuario_id = NULL`, lo
-- que significa que esos clientes no aparecen como "asignados" a ningún
-- usuario — solo los ve el admin y los usuarios con acceso_cartera = TOTAL.
--
-- Esta migración asigna RETROACTIVAMENTE las personas creadas por cada
-- importación al `usuario_id` que la lanzó. Si una persona aparece en
-- múltiples importaciones (raro pero posible), gana la importación más
-- antigua — esa fue la primera que la creó.
--
-- Solo se actualizan personas con `usuario_id IS NULL` para NO pisar
-- asignaciones manuales hechas por el admin con posterioridad.

WITH personas_de_importaciones AS (
  SELECT
    (jsonb_array_elements_text(i.ids_creados->'personas'))::uuid AS persona_id,
    i.usuario_id,
    ROW_NUMBER() OVER (
      PARTITION BY (jsonb_array_elements_text(i.ids_creados->'personas'))::uuid
      ORDER BY i.fecha_inicio ASC NULLS LAST, i.created_at ASC
    ) AS rn
  FROM importaciones i
  WHERE i.usuario_id IS NOT NULL
    AND i.ids_creados IS NOT NULL
    AND i.ids_creados ? 'personas'
    AND jsonb_typeof(i.ids_creados->'personas') = 'array'
    AND jsonb_array_length(i.ids_creados->'personas') > 0
    AND (i.deshecha IS NULL OR i.deshecha = false)
)
UPDATE personas p
SET usuario_id = pdi.usuario_id
FROM personas_de_importaciones pdi
WHERE p.id = pdi.persona_id
  AND pdi.rn = 1
  AND p.usuario_id IS NULL;
