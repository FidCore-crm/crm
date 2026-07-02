-- Migración 108 — Sacar campo 'taller' del default de ramos automotor.
--
-- Contexto: taller de reparación no va en la carga de denuncia. En el momento
-- de denunciar el siniestro, el asegurado no sabe todavía qué taller va a
-- usar (o si va a haber taller). Ese dato se agrega DESPUÉS, cuando el
-- siniestro ya está en curso, en las observaciones/notas.
--
-- Todos los otros campos "taller" en el sistema (form principal, bloque
-- automotor de la ficha, etc.) fueron auditados antes de aplicar esto —
-- solo estaba como default del catálogo de ramos automotor.
--
-- Idempotencia: el UPDATE filtra por key. Correrla dos veces no cambia nada.

UPDATE catalogos
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{campos_siniestro}',
  COALESCE(
    (
      SELECT jsonb_agg(campo)
      FROM jsonb_array_elements(metadata->'campos_siniestro') AS campo
      WHERE campo->>'key' <> 'taller'
    ),
    '[]'::jsonb
  )
)
WHERE
  tipo_id = (SELECT id FROM tipo_catalogo WHERE codigo = 'RAMO')
  AND metadata ? 'campos_siniestro'
  AND jsonb_array_length(metadata->'campos_siniestro') > 0
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(metadata->'campos_siniestro') AS c
    WHERE c->>'key' = 'taller'
  );
