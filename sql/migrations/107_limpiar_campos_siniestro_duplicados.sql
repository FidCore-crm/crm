-- Migración 107 — Limpieza de campos de siniestro duplicados en catálogos de ramos.
--
-- Contexto: hasta hoy `tipos-riesgo.ts::campos_siniestro_default` incluía por
-- ramo varios campos que YA existen como campos estructurados del formulario
-- principal de siniestro (lugar_hecho vs lugar_siniestro, acta_policial vs
-- nro_acta, descripcion_hecho vs relato_hechos, etc.). El PAS terminaba
-- llenando la misma info dos veces.
--
-- Después de acordar sacar solo los duplicados reales (opción B: los
-- "aportan info nueva" como descripcion_daños/prestador/tipo_evento se
-- mantienen), esta migración limpia los ramos ya existentes en la DB para
-- que también les caiga la limpieza — sino solo los ramos nuevos que cree
-- el PAS después de esta versión los tendrían limpios.
--
-- Keys que se quitan de `metadata.campos_siniestro`:
--   - lugar_hecho, lugar_accidente, lugar_fecha_hecho   → duplican Lugar del siniestro
--   - acta_policial, acta_denuncia                      → duplican Nro. de acta
--   - fecha_evento, fecha_hora_hecho, fecha_hora_accidente → duplican Fecha
--   - descripcion_hecho, descripcion_accidente          → duplican Relato de los hechos
--   - monto_reclamado                                    → duplica Monto estimado
--   - lesionados                                         → duplica ¿Hubo lesionados?
--   - terceros                                           → duplica bloque tercero
--
-- Idempotencia: es un UPDATE que filtra un array. Correrla dos veces no
-- cambia nada la segunda vez (los duplicados ya no están).

UPDATE catalogos
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{campos_siniestro}',
  COALESCE(
    (
      SELECT jsonb_agg(campo)
      FROM jsonb_array_elements(metadata->'campos_siniestro') AS campo
      WHERE campo->>'key' NOT IN (
        'lugar_hecho', 'lugar_accidente', 'lugar_fecha_hecho',
        'acta_policial', 'acta_denuncia',
        'fecha_evento', 'fecha_hora_hecho', 'fecha_hora_accidente',
        'descripcion_hecho', 'descripcion_accidente',
        'monto_reclamado', 'lesionados', 'terceros'
      )
    ),
    '[]'::jsonb
  )
)
WHERE
  tipo_id = (SELECT id FROM tipo_catalogo WHERE codigo = 'RAMO')
  AND metadata ? 'campos_siniestro'
  AND jsonb_array_length(metadata->'campos_siniestro') > 0;
