-- Migración 105: estado del servicio (SaaS-managed) — solo se usa en modo VPS.
--
-- Contexto:
--   En modo VPS (SaaS-managed) el sistema de licencias queda desactivado. El
--   control de pago pasa a ser operativo — vos suspendés el acceso al CRM del
--   cliente desde el panel de administración cuando no paga. Este campo es el
--   flag que el panel setea via POST /api/soporte/estado-servicio y que el CRM
--   lee para decidir si permite el login o muestra la pantalla de "servicio
--   suspendido".
--
--   En modo APPLIANCE esta columna queda en 'ACTIVO' toda la vida y nunca se
--   toca — el control sigue siendo la licencia .lic firmada con Ed25519.

ALTER TABLE configuracion
  ADD COLUMN IF NOT EXISTS estado_servicio VARCHAR(20) NOT NULL DEFAULT 'ACTIVO'
    CHECK (estado_servicio IN ('ACTIVO', 'SUSPENDIDO'));

ALTER TABLE configuracion
  ADD COLUMN IF NOT EXISTS motivo_suspension TEXT;

ALTER TABLE configuracion
  ADD COLUMN IF NOT EXISTS fecha_suspension TIMESTAMPTZ;

COMMENT ON COLUMN configuracion.estado_servicio IS
  'Solo aplica en modo VPS (SaaS-managed). ACTIVO=login permitido, SUSPENDIDO=login bloqueado con pantalla de mensaje. En modo APPLIANCE se ignora, el control es via licencia .lic.';

COMMENT ON COLUMN configuracion.motivo_suspension IS
  'Texto libre visible en la pantalla de suspensión (ej: "Pago pendiente desde 15/06"). Nullable.';

COMMENT ON COLUMN configuracion.fecha_suspension IS
  'Momento en que el panel disparó la suspensión. Sirve para auditoría y para mostrar "suspendido desde..." si querés.';
