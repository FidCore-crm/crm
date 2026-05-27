-- Migración 065: garantizar que `configuracion` sea singleton (1 sola fila).
--
-- Contexto: el wizard de onboarding y la pantalla de perfil hacen INSERT
-- si no encuentran fila existente. Bajo race condition (dos requests en
-- paralelo) podrían crearse dos filas. El resto del CRM asume implícitamente
-- que la tabla tiene 1 sola fila (`.maybeSingle()`, `.limit(1)`).
--
-- Solución: un índice único parcial sobre una expresión constante. PostgreSQL
-- impide que existan dos filas que cumplan el predicado, garantizando que
-- solo pueda haber UNA fila en la tabla.

-- Antes de crear el constraint: si por casualidad ya hay >1 fila histórica,
-- las consolidamos quedándonos con la más antigua (la primera creada).
DO $$
DECLARE
  v_count INT;
  v_keep_id UUID;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.configuracion;
  IF v_count > 1 THEN
    SELECT id INTO v_keep_id FROM public.configuracion ORDER BY created_at ASC LIMIT 1;
    DELETE FROM public.configuracion WHERE id <> v_keep_id;
    RAISE NOTICE 'configuracion: consolidé % filas en 1 (kept=%)', v_count, v_keep_id;
  END IF;
END $$;

-- El índice único sobre la expresión constante "true" garantiza singleton.
CREATE UNIQUE INDEX IF NOT EXISTS idx_configuracion_singleton
  ON public.configuracion ((true));

COMMENT ON INDEX public.idx_configuracion_singleton IS
  'Garantiza que public.configuracion tenga máximo 1 fila (singleton). Bloquea race conditions del onboarding/perfil al hacer INSERT concurrente.';
