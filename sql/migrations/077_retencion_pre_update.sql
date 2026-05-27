-- Migración 077: Retención especial para backups PRE_UPDATE
--
-- Los backups PRE_UPDATE (creados antes de aplicar un update del CRM) son
-- diferentes a los backups automáticos:
--   - Están atados a un evento crítico (actualización del sistema).
--   - Permiten "viajar atrás" varias actualizaciones si se detecta un bug.
--   - Son menos frecuentes que los automáticos (1 por update, no 1 por día).
--
-- Por eso necesitan política de retención propia, distinta a la rotación
-- grandfather-father-son (7/4/6) de los backups normales.
--
-- Política nueva por defecto:
--   - Mantener los últimos N PRE_UPDATE siempre (default 5)
--   - Mantener cualquier PRE_UPDATE de menos de M días (default 30)
--   - Quien exceda AMBAS condiciones, se borra.
--
-- Resultado: si hacés 10 updates en 1 mes, mantenés los 10 (los 5 más
-- recientes por la primera regla, más antiguos por la regla de 30 días).
-- Si hacés 2 updates en 6 meses, mantenés los 2.

BEGIN;

ALTER TABLE public.configuracion_backups
  ADD COLUMN IF NOT EXISTS retener_pre_update_minimos INTEGER DEFAULT 5
    CHECK (retener_pre_update_minimos >= 1 AND retener_pre_update_minimos <= 50),
  ADD COLUMN IF NOT EXISTS retener_pre_update_dias INTEGER DEFAULT 30
    CHECK (retener_pre_update_dias >= 1 AND retener_pre_update_dias <= 365);

COMMENT ON COLUMN public.configuracion_backups.retener_pre_update_minimos IS
  'Cantidad mínima de backups PRE_UPDATE a conservar siempre, sin importar antigüedad. Default 5.';
COMMENT ON COLUMN public.configuracion_backups.retener_pre_update_dias IS
  'Días durante los cuales se conservan backups PRE_UPDATE aunque excedan el mínimo. Default 30.';

COMMIT;
