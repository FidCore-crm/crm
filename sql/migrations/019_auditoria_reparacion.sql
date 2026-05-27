-- 019_auditoria_reparacion.sql
-- Reparación integral post-auditoría: reconcilia schema, tipos y código.
-- Idempotente.

BEGIN;

-- ============================================================
-- 1. notificaciones.usuario_id: permitir NULL (notifs globales del sistema)
--    La FK pasa a SET NULL para que borrar un usuario no borre las notifs históricas.
-- ============================================================
ALTER TABLE notificaciones ALTER COLUMN usuario_id DROP NOT NULL;
ALTER TABLE notificaciones DROP CONSTRAINT IF EXISTS fk_notificaciones_usuario;
ALTER TABLE notificaciones DROP CONSTRAINT IF EXISTS notificaciones_usuario_id_fkey;
ALTER TABLE notificaciones
  ADD CONSTRAINT notificaciones_usuario_id_fkey
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL;

-- ============================================================
-- 2. polizas.compania_id / ramo_id: permitir NULL
--    Alinea el NOT NULL con el ON DELETE SET NULL de sus FKs (sino, borrar un
--    catálogo intentaría SET NULL sobre columna NOT NULL y fallaba).
-- ============================================================
ALTER TABLE polizas ALTER COLUMN compania_id DROP NOT NULL;
ALTER TABLE polizas ALTER COLUMN ramo_id DROP NOT NULL;

-- ============================================================
-- 3. riesgos.tipo_riesgo: agregar 'GENERICO' al CHECK
--    El código inserta toUpperCase('generico') = 'GENERICO' y el CHECK lo rechazaba.
-- ============================================================
ALTER TABLE riesgos DROP CONSTRAINT IF EXISTS riesgos_tipo_riesgo_check;
ALTER TABLE riesgos ADD CONSTRAINT riesgos_tipo_riesgo_check CHECK (
  tipo_riesgo IN (
    'AUTOMOTOR','HOGAR','COMERCIO','VIDA','ACCIDENTES_PERSONALES',
    'INTEGRAL_FAMILIA','CAUCION','TRANSPORTE','MOTO','EMBARCACION',
    'TECNOLOGIA','ART','GENERICO','OTRO'
  )
);

-- ============================================================
-- 4. configuracion_notificaciones: drop CHECK duplicado desactualizado
--    Dejaba los constraints `config_notif_tipo_check` (16 tipos, viejo) y
--    `configuracion_notificaciones_tipo_check` (25 tipos, completo). El AND de
--    ambos bloqueaba insertar los tipos nuevos.
-- ============================================================
ALTER TABLE configuracion_notificaciones DROP CONSTRAINT IF EXISTS config_notif_tipo_check;

-- ============================================================
-- 5. Drop columnas muertas (sin consumidor en el código)
-- ============================================================

-- polizas.numero_endoso — la tabla `endosos` maneja los números por póliza.
ALTER TABLE polizas DROP CONSTRAINT IF EXISTS uq_poliza_compania_numero;
ALTER TABLE polizas DROP COLUMN IF EXISTS numero_endoso;
-- Recreo UNIQUE sin numero_endoso, solo cuando compania_id NOT NULL (por si queda null tras 2.).
DROP INDEX IF EXISTS uq_poliza_compania_numero;
CREATE UNIQUE INDEX IF NOT EXISTS uq_poliza_compania_numero
  ON polizas(compania_id, numero_poliza)
  WHERE compania_id IS NOT NULL;

-- personas columnas muertas: productor_id, created_by, updated_by
ALTER TABLE personas DROP COLUMN IF EXISTS productor_id;
ALTER TABLE personas DROP COLUMN IF EXISTS created_by;
ALTER TABLE personas DROP COLUMN IF EXISTS updated_by;

-- siniestros.numero_interno (solo en TS, jamás usado)
ALTER TABLE siniestros DROP COLUMN IF EXISTS numero_interno;

-- tipo_catalogo.activo (sin ningún consumer)
ALTER TABLE tipo_catalogo DROP COLUMN IF EXISTS activo;

-- importaciones.estado legacy (el código usa estado_proceso desde Paso 1 del importador v2)
ALTER TABLE importaciones DROP COLUMN IF EXISTS estado;

-- ============================================================
-- 6. Facturación: agregar columna `monto` y aflojar NOT NULLs
--    El UI sólo trackea un monto simple; el schema rico (premio_total, etc.)
--    queda para un refactor futuro opcional.
-- ============================================================
ALTER TABLE facturacion ADD COLUMN IF NOT EXISTS monto NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE facturacion ALTER COLUMN cantidad_polizas   DROP NOT NULL;
ALTER TABLE facturacion ALTER COLUMN polizas_nuevas     DROP NOT NULL;
ALTER TABLE facturacion ALTER COLUMN polizas_renovadas  DROP NOT NULL;
ALTER TABLE facturacion ALTER COLUMN polizas_canceladas DROP NOT NULL;
ALTER TABLE facturacion ALTER COLUMN premio_total       DROP NOT NULL;
ALTER TABLE facturacion ALTER COLUMN comision_bruta     DROP NOT NULL;
ALTER TABLE facturacion ALTER COLUMN retenciones        DROP NOT NULL;

-- ============================================================
-- 7. UNIQUE sobre (poliza_id, numero_endoso) en endosos
--    Previene duplicados cuando dos inserts concurrentes calculan max+1.
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_endosos_poliza_numero
  ON endosos(poliza_id, numero_endoso);

-- ============================================================
-- 8. CHECKs en tablas que tenían `estado`/`tipo` libre
-- ============================================================

-- importacion_jobs.estado
ALTER TABLE importacion_jobs DROP CONSTRAINT IF EXISTS importacion_jobs_estado_check;
ALTER TABLE importacion_jobs ADD CONSTRAINT importacion_jobs_estado_check
  CHECK (estado IN ('PENDIENTE','EJECUTANDO','COMPLETADO','FALLIDO','REINTENTANDO','CANCELADO'));

-- tareas.tipo
ALTER TABLE tareas DROP CONSTRAINT IF EXISTS tareas_tipo_check;
ALTER TABLE tareas ADD CONSTRAINT tareas_tipo_check CHECK (
  tipo IN (
    'LLAMADA_SEGUIMIENTO','GESTION_RENOVACION','TRAMITE_SINIESTRO','GESTION_COBRANZA',
    'ENVIO_DOCUMENTACION','REUNION_CLIENTE','ALERTA_VENCIMIENTO','TAREA_GENERAL'
  )
);

-- siniestro_bitacora.tipo
ALTER TABLE siniestro_bitacora DROP CONSTRAINT IF EXISTS siniestro_bitacora_tipo_check;
ALTER TABLE siniestro_bitacora ADD CONSTRAINT siniestro_bitacora_tipo_check
  CHECK (tipo IN ('NOTA','ESTADO','ARCHIVO'));

-- ============================================================
-- 9. FKs sin ON DELETE action explícito (default NO ACTION bloquea borrado)
-- ============================================================
ALTER TABLE cotizaciones DROP CONSTRAINT IF EXISTS cotizaciones_compania_ganadora_id_fkey;
ALTER TABLE cotizaciones ADD CONSTRAINT cotizaciones_compania_ganadora_id_fkey
  FOREIGN KEY (compania_ganadora_id) REFERENCES catalogos(id) ON DELETE SET NULL;

ALTER TABLE cotizaciones DROP CONSTRAINT IF EXISTS cotizaciones_ramo_id_fkey;
ALTER TABLE cotizaciones ADD CONSTRAINT cotizaciones_ramo_id_fkey
  FOREIGN KEY (ramo_id) REFERENCES catalogos(id) ON DELETE SET NULL;

ALTER TABLE cotizacion_companias DROP CONSTRAINT IF EXISTS cotizacion_companias_compania_id_fkey;
ALTER TABLE cotizacion_companias ADD CONSTRAINT cotizacion_companias_compania_id_fkey
  FOREIGN KEY (compania_id) REFERENCES catalogos(id) ON DELETE SET NULL;

ALTER TABLE cotizacion_companias DROP CONSTRAINT IF EXISTS cotizacion_companias_cobertura_id_fkey;
ALTER TABLE cotizacion_companias ADD CONSTRAINT cotizacion_companias_cobertura_id_fkey
  FOREIGN KEY (cobertura_id) REFERENCES catalogos(id) ON DELETE SET NULL;

ALTER TABLE importaciones DROP CONSTRAINT IF EXISTS importaciones_compania_id_fkey;
ALTER TABLE importaciones ADD CONSTRAINT importaciones_compania_id_fkey
  FOREIGN KEY (compania_id) REFERENCES catalogos(id) ON DELETE SET NULL;

-- ============================================================
-- 10. Refrescar vista dependiente (por drop de polizas.numero_endoso)
-- ============================================================
-- La vista v_polizas_por_vencer no referenciaba numero_endoso pero por si acaso
-- la re-creamos para evitar dependency issues.

DROP VIEW IF EXISTS v_polizas_por_vencer CASCADE;
CREATE VIEW v_polizas_por_vencer AS
SELECT
  p.id AS poliza_id,
  p.numero_poliza,
  p.fecha_fin,
  (p.fecha_fin - CURRENT_DATE) AS dias_restantes,
  p.estado AS estado_poliza,
  pe.id AS persona_id,
  COALESCE(
    NULLIF(TRIM(CONCAT_WS(', ', pe.apellido, pe.nombre)), ','),
    pe.razon_social,
    pe.apellido
  ) AS nombre_completo,
  pe.dni_cuil,
  pe.email,
  pe.telefono,
  pe.whatsapp,
  COALESCE(c.nombre, '—') AS compania,
  COALESCE(r.nombre, '—') AS ramo,
  CASE
    WHEN p.fecha_fin < CURRENT_DATE THEN 'VENCIDA'
    WHEN p.fecha_fin - CURRENT_DATE <= 7 THEN 'URGENTE'
    WHEN p.fecha_fin - CURRENT_DATE <= 15 THEN 'CRITICA'
    WHEN p.fecha_fin - CURRENT_DATE <= 30 THEN 'PROXIMA'
    ELSE 'NORMAL'
  END AS prioridad_alerta
FROM polizas p
INNER JOIN personas pe ON pe.id = p.asegurado_id
LEFT JOIN catalogos c ON c.id = p.compania_id
LEFT JOIN catalogos r ON r.id = p.ramo_id
WHERE p.estado = 'VIGENTE';

COMMIT;

-- Refrescar cache PostgREST tras los cambios de schema
NOTIFY pgrst, 'reload schema';
