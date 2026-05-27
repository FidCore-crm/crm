-- ============================================================
-- Migración: Estados de pólizas — ciclo de vida correcto
-- Ejecutar en Supabase Studio → SQL Editor
-- ============================================================

-- 1. Agregar columnas nuevas a polizas
ALTER TABLE polizas ADD COLUMN IF NOT EXISTS poliza_origen_id UUID REFERENCES polizas(id);
ALTER TABLE polizas ADD COLUMN IF NOT EXISTS fecha_renovacion DATE;

-- 2. Migrar estados existentes en la tabla polizas
UPDATE polizas SET estado = 'VIGENTE'     WHERE estado = 'EMITIDA';
UPDATE polizas SET estado = 'NO_VIGENTE'  WHERE estado = 'VENCIDA';
UPDATE polizas SET estado = 'VIGENTE'     WHERE estado = 'COTIZACION';

-- 3. Actualizar el catálogo de estados de póliza
-- Primero obtener el tipo_id de ESTADO_POLIZA
DO $$
DECLARE
  v_tipo_id INT;
BEGIN
  SELECT id INTO v_tipo_id FROM tipo_catalogo WHERE codigo = 'ESTADO_POLIZA';

  IF v_tipo_id IS NULL THEN
    RAISE NOTICE 'No se encontró tipo_catalogo ESTADO_POLIZA — saltando catálogos';
    RETURN;
  END IF;

  -- Desactivar estados viejos que ya no aplican
  UPDATE catalogos SET activo = false
  WHERE tipo_id = v_tipo_id
    AND codigo IN ('EMITIDA', 'VENCIDA', 'COTIZACION');

  -- Insertar los nuevos estados si no existen
  INSERT INTO catalogos (tipo_id, codigo, nombre, activo, orden)
  VALUES
    (v_tipo_id, 'PROGRAMADA',  'Programada',  true, 1),
    (v_tipo_id, 'RENOVADA',    'Renovada',    true, 2),
    (v_tipo_id, 'VIGENTE',     'Vigente',     true, 3),
    (v_tipo_id, 'NO_VIGENTE',  'No Vigente',  true, 4),
    (v_tipo_id, 'CANCELADA',   'Cancelada',   true, 5),
    (v_tipo_id, 'ANULADA',     'Anulada',     true, 6)
  ON CONFLICT (tipo_id, codigo) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    activo = true,
    orden  = EXCLUDED.orden;
END $$;

-- 4. Función para actualización automática de estados
CREATE OR REPLACE FUNCTION actualizar_estados_polizas()
RETURNS void AS $$
BEGIN
  -- Pólizas PROGRAMADA que arrancan hoy → VIGENTE
  UPDATE polizas SET estado = 'VIGENTE'
  WHERE estado = 'PROGRAMADA' AND fecha_inicio <= CURRENT_DATE;

  -- Pólizas RENOVADA que arrancan hoy:
  -- Primero, su póliza origen → NO_VIGENTE
  UPDATE polizas SET estado = 'NO_VIGENTE'
  WHERE id IN (
    SELECT poliza_origen_id FROM polizas
    WHERE estado = 'RENOVADA' AND fecha_inicio <= CURRENT_DATE
    AND poliza_origen_id IS NOT NULL
  );

  -- Luego, la renovación → VIGENTE
  UPDATE polizas SET estado = 'VIGENTE'
  WHERE estado = 'RENOVADA' AND fecha_inicio <= CURRENT_DATE;

  -- Pólizas VIGENTE cuya fecha_fin pasó y no tienen renovación activa → NO_VIGENTE
  UPDATE polizas SET estado = 'NO_VIGENTE'
  WHERE estado = 'VIGENTE'
    AND fecha_fin < CURRENT_DATE
    AND id NOT IN (
      SELECT poliza_origen_id FROM polizas
      WHERE poliza_origen_id IS NOT NULL
        AND estado IN ('RENOVADA', 'VIGENTE')
    );
END;
$$ LANGUAGE plpgsql;

-- 5. Ejecutar una vez para normalizar estados actuales
SELECT actualizar_estados_polizas();

-- 6. Intentar crear job pg_cron (si está disponible)
-- Si pg_cron no está habilitado, esto dará error y se ignora
DO $$
BEGIN
  PERFORM cron.schedule(
    'actualizar-estados-polizas',
    '0 1 * * *',  -- Todos los días a la 1 AM
    'SELECT actualizar_estados_polizas()'
  );
  RAISE NOTICE 'pg_cron job creado correctamente';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron no disponible — usar la API route /api/cron/polizas como alternativa';
END $$;
