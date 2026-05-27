-- Migración 039: registrar el origen de creación de cada póliza
--
-- Permite distinguir cómo entró cada póliza al sistema:
--   - MANUAL      : alta directa desde /crm/polizas/nueva (default)
--   - AGENTE_PDF  : aplicada via /crm/agente-pdf (extracción IA de PDF)
--   - IMPORTACION : creada por el importador masivo de cartera
--
-- Caso de uso principal: el cron de bienvenida (POLIZA_NUEVA) NO debe
-- enviar email automático de bienvenida a pólizas con origen IMPORTACION,
-- porque al PAS le entran como "ya existentes" (las trae de otra cartera).
-- Sí debe enviarlo a las MANUAL y AGENTE_PDF, que sí son altas reales.
--
-- Default MANUAL para preservar comportamiento de pólizas existentes
-- (que sí recibirían bienvenida si están dentro de la ventana de 7 días).

ALTER TABLE polizas
  ADD COLUMN IF NOT EXISTS origen_creacion VARCHAR(20) NOT NULL DEFAULT 'MANUAL';

ALTER TABLE polizas
  DROP CONSTRAINT IF EXISTS polizas_origen_creacion_check;

ALTER TABLE polizas
  ADD CONSTRAINT polizas_origen_creacion_check
  CHECK (origen_creacion IN ('MANUAL', 'IMPORTACION', 'AGENTE_PDF'));

COMMENT ON COLUMN polizas.origen_creacion IS
  'Cómo entró la póliza al sistema. MANUAL=alta directa, AGENTE_PDF=extraída de PDF, IMPORTACION=cargada via importador masivo. Las IMPORTACION NO disparan email de bienvenida automático (vienen de otra cartera, no son altas reales para el cliente).';
