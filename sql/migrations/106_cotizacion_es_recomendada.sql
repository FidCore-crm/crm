-- Migración 106: campo es_recomendada en cotizacion_companias.
--
-- El PAS puede marcar UNA de las opciones cotizadas como "recomendada"
-- explícitamente (no automático por mejor precio). Esa marca se muestra en
-- la tabla del CRM y viaja al PDF con destaque visual (barra lateral +
-- tag "RECOMENDADA").
--
-- IMPORTANTE: es_recomendada es distinto de seleccionada. seleccionada la
-- setea el sistema cuando la cotización pasa a GANADA (post-hoc, la que el
-- cliente eligió). es_recomendada la setea el PAS antes de enviar/exportar
-- para sugerirle al cliente cuál conviene. Pueden coincidir o no.

ALTER TABLE cotizacion_companias
  ADD COLUMN IF NOT EXISTS es_recomendada BOOLEAN NOT NULL DEFAULT false;

-- Índice parcial para que la query "¿cuál es la recomendada?" sea O(1) y
-- ADEMÁS garantice unicidad: solo puede haber UNA fila con es_recomendada=true
-- por cotización. Si el PAS marca otra, el frontend primero pone en false
-- todas y después setea la nueva.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cotizacion_companias_recomendada
  ON cotizacion_companias (cotizacion_id)
  WHERE es_recomendada = true;

COMMENT ON COLUMN cotizacion_companias.es_recomendada IS
  'Marca puesta por el PAS antes de enviar la cotización para destacar la opción que sugiere al cliente. Solo una por cotización (índice parcial único). Distinta de "seleccionada" que se setea automáticamente cuando la cotización pasa a GANADA.';
