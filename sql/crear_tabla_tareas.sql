-- ============================================================
-- Módulo Tareas — Migración
-- Ejecutar en Supabase Studio (SQL Editor)
-- ============================================================

-- Eliminar tabla existente si tiene estructura diferente
DROP TABLE IF EXISTS tareas CASCADE;

-- Crear tabla tareas
CREATE TABLE tareas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo            TEXT NOT NULL,
  tipo              TEXT NOT NULL DEFAULT 'TAREA_GENERAL',
  descripcion       TEXT,
  persona_id        UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  poliza_id         UUID REFERENCES polizas(id) ON DELETE SET NULL,
  siniestro_id      UUID REFERENCES siniestros(id) ON DELETE SET NULL,
  fecha_vencimiento DATE NOT NULL,
  hora_vencimiento  TIME,
  prioridad         TEXT NOT NULL DEFAULT 'MEDIA'
                    CHECK (prioridad IN ('CRITICA','ALTA','MEDIA','BAJA')),
  estado            TEXT NOT NULL DEFAULT 'PENDIENTE'
                    CHECK (estado IN ('PENDIENTE','EN_PROCESO','COMPLETADA','CANCELADA')),
  recurrencia       TEXT NOT NULL DEFAULT 'NINGUNA'
                    CHECK (recurrencia IN ('NINGUNA','DIARIA','SEMANAL','MENSUAL','ANUAL')),
  nota_cierre       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX idx_tareas_persona_id        ON tareas(persona_id);
CREATE INDEX idx_tareas_fecha_vencimiento ON tareas(fecha_vencimiento);
CREATE INDEX idx_tareas_estado            ON tareas(estado);

-- RLS
ALTER TABLE tareas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir todo en tareas" ON tareas
  FOR ALL USING (true) WITH CHECK (true);
