-- ============================================================
-- Migración 112 — corrige plantilla email: riesgo → bien asegurado
-- ============================================================
--
-- Error conceptual: "riesgo" es el evento fortuito (accidente, robo,
-- incendio). "Bien asegurado" es lo que se cubre (auto, casa, moto).
-- La plantilla de renovación de póliza usaba "Riesgo asegurado" cuando en
-- realidad muestra el bien.
--
-- Actualiza el cuerpo de la plantilla `renovacion_poliza` reemplazando
-- "Riesgo asegurado: {{riesgo}}" por "Bien asegurado: {{bien_asegurado}}".
-- La variable `{{riesgo}}` sigue existiendo como alias legacy en el
-- renderizador para no romper plantillas custom que el PAS haya editado.
--
-- Idempotente: solo actualiza si el texto viejo todavía está.
-- ============================================================

UPDATE plantillas_email
SET
  cuerpo = REPLACE(cuerpo, 'Riesgo asegurado: {{riesgo}}', 'Bien asegurado: {{bien_asegurado}}'),
  cuerpo_default = REPLACE(cuerpo_default, 'Riesgo asegurado: {{riesgo}}', 'Bien asegurado: {{bien_asegurado}}')
WHERE codigo = 'renovacion_poliza'
  AND (cuerpo LIKE '%Riesgo asegurado: {{riesgo}}%' OR cuerpo_default LIKE '%Riesgo asegurado: {{riesgo}}%');
