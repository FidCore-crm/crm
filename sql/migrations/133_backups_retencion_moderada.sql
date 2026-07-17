-- ============================================================
-- 133 — Retención de backups moderada
-- ============================================================
-- Los defaults originales de retención (7 diarios / 4 semanales /
-- 6 mensuales + PRE_UPDATE 5 mínimos + 30 días) generaban acumulación
-- excesiva. En instalaciones con updates frecuentes (dev del equipo)
-- se llegaba a ~120 backups (1 GB) en 2 meses.
--
-- Nuevos defaults más razonables para un PAS chico:
--   - 3 diarios (rotan cada día)
--   - 2 semanales (cubre las últimas 2 semanas)
--   - 3 mensuales (cubre los últimos 3 meses)
--   - PRE_UPDATE: 2 mínimos + 3 días (rollback puntual, no histórico)
--
-- Se aplica UPDATE en configuracion_backups para instalaciones existentes
-- SOLO SI los valores actuales son los defaults originales — no pisamos
-- valores que el PAS haya customizado a propósito.
-- ============================================================

-- Bajar defaults SOLO si están en los originales (respeta valores custom)
UPDATE public.configuracion_backups
   SET retener_diarios              = 3
 WHERE retener_diarios              = 7;

UPDATE public.configuracion_backups
   SET retener_semanales            = 2
 WHERE retener_semanales            = 4;

UPDATE public.configuracion_backups
   SET retener_mensuales            = 3
 WHERE retener_mensuales            = 6;

UPDATE public.configuracion_backups
   SET retener_pre_update_minimos   = 2
 WHERE retener_pre_update_minimos   = 5;

UPDATE public.configuracion_backups
   SET retener_pre_update_dias      = 3
 WHERE retener_pre_update_dias      = 30;

-- Cambiar defaults de las columnas para futuras instalaciones
ALTER TABLE public.configuracion_backups
  ALTER COLUMN retener_diarios              SET DEFAULT 3,
  ALTER COLUMN retener_semanales            SET DEFAULT 2,
  ALTER COLUMN retener_mensuales            SET DEFAULT 3,
  ALTER COLUMN retener_pre_update_minimos   SET DEFAULT 2,
  ALTER COLUMN retener_pre_update_dias      SET DEFAULT 3;
