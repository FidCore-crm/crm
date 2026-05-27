-- ============================================================
-- Migración 042: Hash de tokens del Portal del Cliente
-- ============================================================
-- Antes: portal_cliente_accesos.token guardaba el token en plano.
-- Si se filtraba un backup .crmbak, todos los tokens activos quedaban
-- expuestos (los tokens NO expiran por tiempo, solo por revocación).
--
-- Después: solo se guarda sha256(token) en hex. El token plano existe
-- únicamente en el email/WhatsApp que se le envió al cliente cuando se
-- generó. Si el cliente lo pierde, hay que regenerar uno nuevo.
--
-- Idempotente: chequea existencia de columnas antes de cada paso.
-- ============================================================

BEGIN;

-- pgcrypto provee digest(); la extensión ya está instalada en producción.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Agregar columna token_hash si no existe
ALTER TABLE portal_cliente_accesos
  ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64);

-- 2) Backfill de tokens existentes (si hay columna `token` con datos)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portal_cliente_accesos' AND column_name = 'token'
  ) THEN
    UPDATE portal_cliente_accesos
       SET token_hash = encode(digest(token, 'sha256'), 'hex')
     WHERE token_hash IS NULL AND token IS NOT NULL;
  END IF;
END $$;

-- 3) NOT NULL + UNIQUE INDEX (un solo token activo por persona)
ALTER TABLE portal_cliente_accesos
  ALTER COLUMN token_hash SET NOT NULL;

-- Drop constraint UNIQUE de la columna `token` (el constraint asocia un index
-- que protege la columna; al haber cambiado el contrato, sacamos ambos).
ALTER TABLE portal_cliente_accesos DROP CONSTRAINT IF EXISTS portal_cliente_accesos_token_key;
DROP INDEX IF EXISTS idx_portal_cliente_accesos_token_hash_activo;

CREATE UNIQUE INDEX idx_portal_cliente_accesos_token_hash_activo
  ON portal_cliente_accesos(token_hash)
  WHERE revocado = false;

-- 4) Drop columna `token` (los hashes son irreversibles, los tokens planos
-- viajan solo por email/WhatsApp).
ALTER TABLE portal_cliente_accesos
  DROP COLUMN IF EXISTS token;

COMMIT;
