-- ============================================================
-- 035_interacciones_persona_id.sql
--
-- Agrega `persona_id` a `interacciones` y amplía el CHECK
-- `interacciones_origen_check` para permitir 3 modos mutuamente
-- excluyentes:
--    1) lead_id        → interacción durante etapa de lead
--    2) oportunidad_id → interacción durante etapa de oportunidad
--    3) persona_id     → interacción con cliente (post-conversión
--                        o cliente directo sin lead/oportunidad)
--
-- Motivación: al convertir un lead a cliente, las interacciones
-- registradas se quedaban huérfanas en el lead (CONVERTIDO) y el
-- historial no era visible desde la ficha de persona. Ahora la
-- conversión hace `UPDATE interacciones SET persona_id=X,
-- lead_id=NULL WHERE lead_id=Y`, preservando todo el historial.
--
-- FK con ON DELETE CASCADE — coherente con leads y oportunidades.
-- ============================================================

BEGIN;

ALTER TABLE interacciones
  ADD COLUMN IF NOT EXISTS persona_id UUID REFERENCES personas(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_interacciones_persona_id
  ON interacciones(persona_id)
  WHERE persona_id IS NOT NULL;

-- Recreamos el CHECK origen para incluir el nuevo modo persona.
-- Exactamente uno de los tres FKs debe estar seteado.
ALTER TABLE interacciones
  DROP CONSTRAINT IF EXISTS interacciones_origen_check;

ALTER TABLE interacciones
  ADD CONSTRAINT interacciones_origen_check CHECK (
    (lead_id IS NOT NULL AND oportunidad_id IS NULL AND persona_id IS NULL)
    OR (oportunidad_id IS NOT NULL AND lead_id IS NULL AND persona_id IS NULL)
    OR (persona_id IS NOT NULL AND lead_id IS NULL AND oportunidad_id IS NULL)
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
