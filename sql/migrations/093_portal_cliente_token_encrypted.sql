-- ============================================================
-- Migración 093: Token plano encriptado del Portal del Cliente
-- ============================================================
-- Contexto: la migración 042 movió el token plano a sha256(token) en
-- `token_hash` para proteger backups filtrados. El efecto colateral es
-- que el PAS no puede ver el link generado al volver a la ficha del
-- cliente — pierde la posibilidad de reenviarlo y termina regenerando
-- tokens nuevos cada vez (rompiendo los que el asegurado ya tenía
-- guardados).
--
-- Solución: agregar `token_encrypted` (AES-256-GCM con ENCRYPTION_KEY
-- del .env.local). El hash sigue siendo el índice rápido para validar
-- al cliente; el encrypted permite recuperar el plano para mostrarlo
-- al PAS. Como `.env.local` NO viaja en el `.crmbak`, un backup
-- filtrado sigue siendo inútil sin la key (mismo modelo que
-- smtp_password_encrypted y anthropic_api_key_encrypted).
--
-- Tokens viejos (generados antes de esta migración) quedan con
-- `token_encrypted = NULL` — siguen funcionando pero el PAS no los
-- puede recuperar visualmente hasta regenerarlos.
--
-- Idempotente.
-- ============================================================

BEGIN;

ALTER TABLE portal_cliente_accesos
  ADD COLUMN IF NOT EXISTS token_encrypted TEXT;

COMMENT ON COLUMN portal_cliente_accesos.token_encrypted IS
  'Token plano encriptado con AES-256-GCM (ENCRYPTION_KEY del .env.local). '
  'Permite mostrar el link al PAS sin guardar el token en plano. NULL para '
  'tokens generados antes de la migración 093 — el PAS los ve solo al regenerar.';

COMMIT;
