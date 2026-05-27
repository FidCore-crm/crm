-- ============================================================
-- Migración 004: Tabla de interacciones (CRM comercial)
-- ============================================================
-- EJECUTAR MANUALMENTE en entornos nuevos.
-- La tabla ya existe y está en uso por /crm/comercial/leads/[id]
-- y /crm/comercial/oportunidades/[id]. Este archivo es idempotente
-- para restores / fresh setups.
-- ============================================================

CREATE TABLE IF NOT EXISTS interacciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  oportunidad_id UUID REFERENCES oportunidades(id) ON DELETE CASCADE,
  tipo VARCHAR NOT NULL CHECK (tipo IN ('LLAMADA','EMAIL','WHATSAPP','REUNION','NOTA')),
  descripcion TEXT NOT NULL,
  fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interacciones_lead ON interacciones(lead_id);
CREATE INDEX IF NOT EXISTS idx_interacciones_oportunidad ON interacciones(oportunidad_id);
CREATE INDEX IF NOT EXISTS idx_interacciones_fecha ON interacciones(fecha DESC);

ALTER TABLE interacciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir todo en interacciones" ON interacciones;
CREATE POLICY "Permitir todo en interacciones" ON interacciones
  FOR ALL USING (true) WITH CHECK (true);
