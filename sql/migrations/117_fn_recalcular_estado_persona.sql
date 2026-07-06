-- ============================================================
-- 117 — Función helper `fn_recalcular_estado_persona`
-- ============================================================
-- El trigger `fn_sincronizar_estado_persona` mantiene sincronizado
-- ACTIVO/INACTIVO ante cambios en pólizas, pero NO se puede invocar
-- directamente sin tocar una póliza. Esta función expone la misma
-- lógica para casos donde necesitamos recalcular sin evento de póliza:
--
--   • Desbloqueo manual desde la ficha del cliente (usuario decide
--     quitar el BLOQUEADO y quiere que el sistema decida el estado real).
--   • Backfills / consolidaciones de datos.
--   • Reparaciones tras corrupciones o migraciones raras.
--
-- Reglas idénticas al trigger:
--   • ACTIVO si tiene al menos 1 póliza en VIGENTE o PROGRAMADA.
--   • INACTIVO si no tiene ninguna.
--   • RESPETA BLOQUEADO (no lo toca — para eso está el trigger).
--   • RESPETA PROSPECTO (para eso está el flujo de leads/comercial).
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_recalcular_estado_persona(p_persona_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_tiene_poliza_activa BOOLEAN;
  v_estado_actual TEXT;
  v_nuevo_estado TEXT;
BEGIN
  SELECT estado INTO v_estado_actual FROM personas WHERE id = p_persona_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- No tocamos estados manuales.
  IF v_estado_actual IN ('BLOQUEADO', 'PROSPECTO') THEN
    RETURN v_estado_actual;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM polizas
    WHERE asegurado_id = p_persona_id
      AND estado IN ('VIGENTE', 'PROGRAMADA')
  ) INTO v_tiene_poliza_activa;

  v_nuevo_estado := CASE WHEN v_tiene_poliza_activa THEN 'ACTIVO' ELSE 'INACTIVO' END;

  IF v_nuevo_estado <> v_estado_actual THEN
    UPDATE personas SET estado = v_nuevo_estado WHERE id = p_persona_id;
  END IF;

  RETURN v_nuevo_estado;
END;
$$;

COMMENT ON FUNCTION public.fn_recalcular_estado_persona(UUID) IS
  'Recalcula el estado ACTIVO/INACTIVO de una persona según sus pólizas. Espeja el trigger fn_sincronizar_estado_persona. Respeta BLOQUEADO y PROSPECTO (los deja como están).';
