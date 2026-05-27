-- Migración 069: registrar origen de creación de siniestros + flag "revisado por el PAS"
--
-- Permite distinguir cómo entró cada siniestro al sistema:
--   - MANUAL_PAS      : alta directa desde el CRM por el PAS (default)
--   - PORTAL_CLIENTE  : denunciado por el asegurado via el formulario público
--
-- Caso de uso principal: los siniestros denunciados por el cliente requieren
-- atención URGENTE del PAS (tiene que cargarlos en la compañía, contactar al
-- asegurado, etc.). Necesitamos diferenciarlos visualmente del flujo normal.
--
-- `revisado_por_pas` arranca en false para denuncias del portal y en true para
-- altas manuales (el PAS las cargó, ya las "vio"). El PAS marca como revisado
-- desde la ficha cuando ya tomó nota del caso. Las alertas (badge, banner,
-- barra global) cuentan solo los siniestros con `origen='PORTAL_CLIENTE' AND
-- revisado_por_pas=false`.

BEGIN;

-- Origen de creación
ALTER TABLE siniestros
  ADD COLUMN IF NOT EXISTS origen_creacion VARCHAR(20) NOT NULL DEFAULT 'MANUAL_PAS';

ALTER TABLE siniestros
  DROP CONSTRAINT IF EXISTS siniestros_origen_creacion_check;

ALTER TABLE siniestros
  ADD CONSTRAINT siniestros_origen_creacion_check
  CHECK (origen_creacion IN ('MANUAL_PAS', 'PORTAL_CLIENTE'));

COMMENT ON COLUMN siniestros.origen_creacion IS
  'Cómo entró el siniestro al sistema. MANUAL_PAS=cargado por el productor desde el CRM, PORTAL_CLIENTE=denunciado por el asegurado en el formulario público. Los PORTAL_CLIENTE disparan alertas hasta que el PAS los marca como revisados.';

-- Flag de revisión
ALTER TABLE siniestros
  ADD COLUMN IF NOT EXISTS revisado_por_pas BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE siniestros
  ADD COLUMN IF NOT EXISTS fecha_revision TIMESTAMPTZ NULL;

ALTER TABLE siniestros
  ADD COLUMN IF NOT EXISTS revisado_por_usuario_id UUID NULL REFERENCES usuarios_perfil(id) ON DELETE SET NULL;

COMMENT ON COLUMN siniestros.revisado_por_pas IS
  'Indica si el PAS ya revisó este siniestro. Solo es relevante para origen_creacion=PORTAL_CLIENTE: arranca en false y el PAS lo marca true desde la ficha. Para MANUAL_PAS siempre es true (el PAS lo cargó él mismo).';

-- Índice parcial para queries de "denuncias pendientes de revisión"
CREATE INDEX IF NOT EXISTS idx_siniestros_denuncias_pendientes
  ON siniestros(created_at DESC)
  WHERE origen_creacion = 'PORTAL_CLIENTE'
    AND revisado_por_pas = false
    AND deleted_at IS NULL;

COMMIT;
