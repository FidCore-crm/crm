-- ============================================================
-- Migración 002: Tabla de facturación mensual por compañía
-- ============================================================
-- EJECUTAR MANUALMENTE.
-- La pantalla /crm/facturacion usa esta tabla para grid pivot
-- (filas = compañías, columnas = meses).
-- ============================================================

CREATE TABLE IF NOT EXISTS facturacion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  compania_id UUID NOT NULL REFERENCES catalogos(id),
  mes INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  anio INTEGER NOT NULL,
  monto DECIMAL(15,2) NOT NULL,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT facturacion_unique UNIQUE(compania_id, mes, anio)
);

CREATE INDEX IF NOT EXISTS idx_facturacion_anio_mes ON facturacion(anio, mes);
CREATE INDEX IF NOT EXISTS idx_facturacion_compania ON facturacion(compania_id);

ALTER TABLE facturacion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir todo en facturacion" ON facturacion;
CREATE POLICY "Permitir todo en facturacion" ON facturacion
  FOR ALL USING (true) WITH CHECK (true);
