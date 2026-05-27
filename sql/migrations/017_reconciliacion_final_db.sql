-- ============================================================================
-- 017_reconciliacion_final_db.sql
-- Reconciliación completa del schema de la base de datos.
--
-- Esta migración consolida TODOS los cambios pendientes detectados en la
-- auditoría pre-producción: CHECK constraints, FK faltantes, columnas
-- faltantes/sobrantes, tablas faltantes/muertas, y eliminación de campos
-- financieros por decisión de producto.
--
-- SELF-HEALING: idempotente, segura de ejecutar múltiples veces.
-- EJECUTAR COMO: supabase_admin (dueño de las tablas existentes)
--   docker exec -i supabase-db psql -U supabase_admin postgres < sql/migrations/017_reconciliacion_final_db.sql
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PARTE -1: Transferir ownership de tablas creadas como postgres         ║
-- ║  (tablas de migraciones anteriores creadas con usuario incorrecto)      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tableowner = 'postgres'
  LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO supabase_admin', t);
  END LOOP;
END $$;

-- También funciones
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) as args
    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
  LOOP
    EXECUTE format('ALTER FUNCTION public.%I(%s) OWNER TO supabase_admin', r.proname, r.args);
  END LOOP;
END $$;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PARTE 0: Eliminar vistas que referencian objetos que vamos a cambiar  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- v_siniestros_activos referencia configuracion_sistema (tabla que se elimina)
-- y usa monto_reclamado (columna que se renombra) y estados legacy
DROP VIEW IF EXISTS v_siniestros_activos CASCADE;

-- v_resumen_cartera referencia premio, comision_monto, comision_pct (se eliminan)
DROP VIEW IF EXISTS v_resumen_cartera CASCADE;

-- v_polizas_por_vencer referencia premio (se elimina) — se recrea al final
DROP VIEW IF EXISTS v_polizas_por_vencer CASCADE;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PARTE 1: Eliminar tablas muertas (confirmado 0 datos, 0 referencias)  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- Triggers sobre tablas muertas
DROP TRIGGER IF EXISTS tg_campanas_updated_at ON campanas;
DROP TRIGGER IF EXISTS tg_tracking_envios_updated_at ON tracking_envios;
DROP TRIGGER IF EXISTS tg_tracking_lista_bajas ON tracking_envios;

-- Funciones que solo sirven a tablas muertas
DROP FUNCTION IF EXISTS fn_agregar_lista_bajas_automatica() CASCADE;

DROP TABLE IF EXISTS campanas CASCADE;
DROP TABLE IF EXISTS lista_bajas CASCADE;
DROP TABLE IF EXISTS tracking_envios CASCADE;
DROP TABLE IF EXISTS coberturas_poliza CASCADE;
DROP TABLE IF EXISTS configuracion_sistema CASCADE;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PARTE 2: Backfill y reconciliación de CHECK constraints               ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ── 2a. polizas.estado ──────────────────────────────────────────────────
-- DB actual: COTIZACION/EMITIDA/VIGENTE/CANCELADA/VENCIDA/RENOVADA/ANULADA
-- Código:    PROGRAMADA/RENOVADA/VIGENTE/NO_VIGENTE/CANCELADA/ANULADA

UPDATE polizas SET estado = 'PROGRAMADA' WHERE estado = 'EMITIDA';
UPDATE polizas SET estado = 'NO_VIGENTE' WHERE estado = 'VENCIDA';
UPDATE polizas SET estado = 'NO_VIGENTE' WHERE estado = 'COTIZACION';

ALTER TABLE polizas DROP CONSTRAINT IF EXISTS polizas_estado_check;
ALTER TABLE polizas ADD CONSTRAINT polizas_estado_check
  CHECK (estado IN ('PROGRAMADA','RENOVADA','VIGENTE','NO_VIGENTE','CANCELADA','ANULADA'));

-- ── 2b. siniestros.estado ───────────────────────────────────────────────
-- DB actual: ABIERTO/EN_INVESTIGACION/PENDIENTE_DOCUMENTACION/EN_LIQUIDACION/
--            CERRADO_PAGADO/CERRADO_RECHAZADO/CERRADO_DESISTIDO
-- Código:    DENUNCIADO/INSPECCION/LIQUIDACION/REPARACION/FINALIZADO/RECHAZADO

UPDATE siniestros SET estado = 'DENUNCIADO' WHERE estado = 'ABIERTO';
UPDATE siniestros SET estado = 'INSPECCION' WHERE estado IN ('EN_INVESTIGACION','PENDIENTE_DOCUMENTACION');
UPDATE siniestros SET estado = 'LIQUIDACION' WHERE estado = 'EN_LIQUIDACION';
UPDATE siniestros SET estado = 'FINALIZADO' WHERE estado = 'CERRADO_PAGADO';
UPDATE siniestros SET estado = 'RECHAZADO' WHERE estado IN ('CERRADO_RECHAZADO','CERRADO_DESISTIDO');
UPDATE siniestros SET estado = 'DENUNCIADO'
  WHERE estado NOT IN ('DENUNCIADO','INSPECCION','LIQUIDACION','REPARACION','FINALIZADO','RECHAZADO');

ALTER TABLE siniestros DROP CONSTRAINT IF EXISTS siniestros_estado_check;
ALTER TABLE siniestros ADD CONSTRAINT siniestros_estado_check
  CHECK (estado IN ('DENUNCIADO','INSPECCION','LIQUIDACION','REPARACION','FINALIZADO','RECHAZADO'));

ALTER TABLE siniestros ALTER COLUMN estado SET DEFAULT 'DENUNCIADO';

-- ── 2c. poliza_archivos.categoria ───────────────────────────────────────
ALTER TABLE poliza_archivos DROP CONSTRAINT IF EXISTS poliza_archivos_categoria_check;
ALTER TABLE poliza_archivos ADD CONSTRAINT poliza_archivos_categoria_check
  CHECK (categoria IN ('inspeccion','documentacion','documentacion_renovada','endosos'));

-- ── 2d. notificaciones — renombrar nivel→prioridad, url_accion→url ──────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='notificaciones' AND column_name='nivel')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='notificaciones' AND column_name='prioridad') THEN
    ALTER TABLE notificaciones RENAME COLUMN nivel TO prioridad;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='notificaciones' AND column_name='url_accion')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='notificaciones' AND column_name='url') THEN
    ALTER TABLE notificaciones RENAME COLUMN url_accion TO url;
  END IF;
END $$;

-- Backfill valores de prioridad
UPDATE notificaciones SET prioridad = 'CRITICA' WHERE prioridad = 'ALERTA';
UPDATE notificaciones SET prioridad = 'INFORMATIVA' WHERE prioridad = 'INFO';

-- Ampliar VARCHAR si es muy corto para 'INFORMATIVA' (12 chars)
ALTER TABLE notificaciones ALTER COLUMN prioridad TYPE VARCHAR(20);

ALTER TABLE notificaciones DROP CONSTRAINT IF EXISTS notificaciones_nivel_check;
ALTER TABLE notificaciones DROP CONSTRAINT IF EXISTS notificaciones_prioridad_check;
ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_prioridad_check
  CHECK (prioridad IN ('CRITICA','ADVERTENCIA','INFORMATIVA'));

ALTER TABLE notificaciones ALTER COLUMN prioridad SET DEFAULT 'ADVERTENCIA';

-- ── 2e. notificaciones.tipo — CHECK con TODOS los valores del código ────
ALTER TABLE notificaciones DROP CONSTRAINT IF EXISTS notificaciones_tipo_check;
ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_tipo_check
  CHECK (tipo IN (
    'POLIZA_VENCIDA','TAREA_VENCIDA','SINIESTRO_30_DIAS','SINIESTRO_60_DIAS',
    'COTIZACION_SIN_RESPUESTA','COTIZACION_SIN_SEGUIMIENTO','OPORTUNIDAD_ESTANCADA',
    'COTIZACION_VENCIENDO_PRONTO','COTIZACION_VENCIDA',
    'IMPORTACION_INICIADA','IMPORTACION_ANALIZADA','IMPORTACION_LISTA_REVISION',
    'IMPORTACION_COMPLETADA','IMPORTACION_FALLIDA','IMPORTACION_PAUSADA','IMPORTACION_DESHECHA',
    'PDF_LISTO_PARA_REVISAR','PDF_FALLIDO','POLIZA_REHABILITADA',
    'BACKUP_FALLIDO','BACKUP_SYNC_FALLIDO',
    'RESTAURACION_INICIADA','RESTAURACION_COMPLETADA','RESTAURACION_FALLIDA',
    'EMAIL_AUTOMATICO_FALLIDO'
  ));

ALTER TABLE configuracion_notificaciones DROP CONSTRAINT IF EXISTS configuracion_notificaciones_tipo_check;
ALTER TABLE configuracion_notificaciones ADD CONSTRAINT configuracion_notificaciones_tipo_check
  CHECK (tipo IN (
    'POLIZA_VENCIDA','TAREA_VENCIDA','SINIESTRO_30_DIAS','SINIESTRO_60_DIAS',
    'COTIZACION_SIN_RESPUESTA','COTIZACION_SIN_SEGUIMIENTO','OPORTUNIDAD_ESTANCADA',
    'COTIZACION_VENCIENDO_PRONTO','COTIZACION_VENCIDA',
    'IMPORTACION_INICIADA','IMPORTACION_ANALIZADA','IMPORTACION_LISTA_REVISION',
    'IMPORTACION_COMPLETADA','IMPORTACION_FALLIDA','IMPORTACION_PAUSADA','IMPORTACION_DESHECHA',
    'PDF_LISTO_PARA_REVISAR','PDF_FALLIDO','POLIZA_REHABILITADA',
    'BACKUP_FALLIDO','BACKUP_SYNC_FALLIDO',
    'RESTAURACION_INICIADA','RESTAURACION_COMPLETADA','RESTAURACION_FALLIDA',
    'EMAIL_AUTOMATICO_FALLIDO'
  ));

-- ── 2f. email_envios.tipo_envio — agregar SISTEMA_TEST_SMTP ─────────────
ALTER TABLE email_envios DROP CONSTRAINT IF EXISTS email_envios_tipo_envio_check;
ALTER TABLE email_envios ADD CONSTRAINT email_envios_tipo_envio_check
  CHECK (tipo_envio IN (
    'AUTOMATICO_BIENVENIDA','AUTOMATICO_RENOVACION','AUTOMATICO_PORTAL_CLIENTE',
    'MANUAL','MASIVO','NOTIFICACION_INTERNA',
    'SISTEMA_BACKUP_COMPLETADO','SISTEMA_BACKUP_FALLIDO','SISTEMA_BACKUP_SYNC_FALLIDO',
    'SISTEMA_RESTAURACION_INICIADA','SISTEMA_RESTAURACION_COMPLETADA','SISTEMA_RESTAURACION_FALLIDA',
    'SISTEMA_PDF_PROCESADO','SISTEMA_PDF_FALLIDO','SISTEMA_EMAIL_AUTOMATICO_FALLIDO',
    'SISTEMA_TEST_SMTP','SISTEMA_ERROR_CRITICO'
  ));


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PARTE 3: Agregar/renombrar columnas faltantes                         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ── 3a. siniestros.detalle_siniestro (JSONB, campos dinámicos por ramo) ──
ALTER TABLE siniestros ADD COLUMN IF NOT EXISTS detalle_siniestro JSONB;

-- ── 3b. siniestros: renombrar monto_reclamado → monto_estimado ──────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='siniestros' AND column_name='monto_reclamado')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='siniestros' AND column_name='monto_estimado') THEN
    ALTER TABLE siniestros RENAME COLUMN monto_reclamado TO monto_estimado;
  END IF;
END $$;

-- ── 3c. poliza_archivos.endoso_id ───────────────────────────────────────
ALTER TABLE poliza_archivos ADD COLUMN IF NOT EXISTS endoso_id UUID;

CREATE INDEX IF NOT EXISTS idx_poliza_archivos_endoso
  ON poliza_archivos(endoso_id) WHERE endoso_id IS NOT NULL;

-- ── 3d. configuracion.modulo_ia_pdf_polizas_activo ──────────────────────
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS modulo_ia_pdf_polizas_activo BOOLEAN DEFAULT false;

-- ── 3e. email_bajas.persona_id ──────────────────────────────────────────
ALTER TABLE email_bajas ADD COLUMN IF NOT EXISTS persona_id UUID;

-- ── 3f. email_envios.token_tracking → nullable ──────────────────────────
ALTER TABLE email_envios ALTER COLUMN token_tracking DROP NOT NULL;

-- ── 3g. backups: columnas faltantes del formato .crmbak ─────────────────
ALTER TABLE backups ADD COLUMN IF NOT EXISTS archivo_unico_path TEXT;
ALTER TABLE backups ADD COLUMN IF NOT EXISTS archivo_unico_tamano_bytes BIGINT;
ALTER TABLE backups ADD COLUMN IF NOT EXISTS contenido_incluido JSONB
  DEFAULT '{"database": true, "storage": true}';


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PARTE 4: Eliminar campos financieros de polizas (decisión de producto)║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- CASCADE necesario porque comision_monto tiene dependencia de premio y comision_pct
ALTER TABLE polizas DROP COLUMN IF EXISTS premio CASCADE;
ALTER TABLE polizas DROP COLUMN IF EXISTS prima_neta;
ALTER TABLE polizas DROP COLUMN IF EXISTS comision_pct CASCADE;
ALTER TABLE polizas DROP COLUMN IF EXISTS comision_monto;
ALTER TABLE polizas DROP COLUMN IF EXISTS cuotas;
ALTER TABLE polizas DROP COLUMN IF EXISTS monto_cuota;
ALTER TABLE polizas DROP COLUMN IF EXISTS medio_pago_id;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PARTE 5: Eliminar columnas muertas (confirmado 0 referencias en src/) ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- polizas: columnas legacy sin uso
DROP INDEX IF EXISTS idx_polizas_anterior;
ALTER TABLE polizas DROP COLUMN IF EXISTS poliza_anterior_id;
ALTER TABLE polizas DROP COLUMN IF EXISTS premio_frecuencia;
ALTER TABLE polizas DROP COLUMN IF EXISTS created_by;
ALTER TABLE polizas DROP COLUMN IF EXISTS updated_by;

-- siniestros: columnas sin uso
ALTER TABLE siniestros DROP COLUMN IF EXISTS url_documentos;
ALTER TABLE siniestros DROP COLUMN IF EXISTS created_by;
ALTER TABLE siniestros DROP COLUMN IF EXISTS updated_by;

-- catalogos: audit columns sin writer
ALTER TABLE catalogos DROP COLUMN IF EXISTS created_by;
ALTER TABLE catalogos DROP COLUMN IF EXISTS updated_by;

-- endosos: audit column sin writer
ALTER TABLE endosos DROP COLUMN IF EXISTS created_by;

-- facturacion: audit column sin writer
ALTER TABLE facturacion DROP COLUMN IF EXISTS created_by;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PARTE 6: Crear las 8 tablas faltantes (migraciones 005-012)           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ── 6a. storage_tokens (migración 005) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS storage_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token VARCHAR UNIQUE NOT NULL,
  ruta_archivo VARCHAR NOT NULL,
  fecha_creacion TIMESTAMPTZ DEFAULT NOW(),
  fecha_expiracion TIMESTAMPTZ NOT NULL,
  veces_usado INTEGER DEFAULT 0,
  max_usos INTEGER DEFAULT NULL,
  contexto VARCHAR,
  creado_por_usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_storage_tokens_token ON storage_tokens(token);
CREATE INDEX IF NOT EXISTS idx_storage_tokens_expiracion ON storage_tokens(fecha_expiracion);
ALTER TABLE storage_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo en storage_tokens" ON storage_tokens;
CREATE POLICY "Permitir todo en storage_tokens" ON storage_tokens FOR ALL USING (true) WITH CHECK (true);

-- ── 6b. rate_limit_buckets (migración 006) ──────────────────────────────
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier VARCHAR NOT NULL,
  endpoint VARCHAR NOT NULL,
  count INTEGER DEFAULT 1,
  reset_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT rate_limit_unique UNIQUE(identifier, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_reset ON rate_limit_buckets(reset_at);
ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo en rate_limit_buckets" ON rate_limit_buckets;
CREATE POLICY "Permitir todo en rate_limit_buckets" ON rate_limit_buckets FOR ALL USING (true) WITH CHECK (true);

-- ── 6c. portal_cliente_accesos (migración 007) ─────────────────────────
CREATE TABLE IF NOT EXISTS portal_cliente_accesos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  token VARCHAR UNIQUE NOT NULL,
  fecha_creacion TIMESTAMPTZ DEFAULT NOW(),
  veces_accedido INTEGER DEFAULT 0,
  ultimo_acceso TIMESTAMPTZ,
  ultimo_ip VARCHAR,
  revocado BOOLEAN DEFAULT false,
  fecha_revocacion TIMESTAMPTZ,
  motivo_revocacion TEXT,
  creado_por_usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_portal_accesos_token ON portal_cliente_accesos(token);
CREATE INDEX IF NOT EXISTS idx_portal_accesos_persona ON portal_cliente_accesos(persona_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_accesos_activo_por_persona
  ON portal_cliente_accesos(persona_id) WHERE revocado = false;
ALTER TABLE portal_cliente_accesos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo en portal_cliente_accesos" ON portal_cliente_accesos;
CREATE POLICY "Permitir todo en portal_cliente_accesos" ON portal_cliente_accesos FOR ALL USING (true) WITH CHECK (true);

-- ── 6d. configuracion_portal_cliente (migración 007) ────────────────────
CREATE TABLE IF NOT EXISTS configuracion_portal_cliente (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activo BOOLEAN DEFAULT false,
  texto_bienvenida TEXT DEFAULT 'Bienvenido a tu portal personal',
  mensaje_acceso_revocado TEXT DEFAULT 'Este enlace ya no está disponible. Contactá a tu productor para obtener un nuevo acceso.',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_configuracion_portal_singleton ON configuracion_portal_cliente((true));
ALTER TABLE configuracion_portal_cliente ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo en configuracion_portal_cliente" ON configuracion_portal_cliente;
CREATE POLICY "Permitir todo en configuracion_portal_cliente" ON configuracion_portal_cliente FOR ALL USING (true) WITH CHECK (true);
INSERT INTO configuracion_portal_cliente (activo) VALUES (false) ON CONFLICT DO NOTHING;

-- ── 6e. telefonos_asistencia_companias (migración 007) ──────────────────
CREATE TABLE IF NOT EXISTS telefonos_asistencia_companias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  compania_id UUID NOT NULL REFERENCES catalogos(id) ON DELETE CASCADE,
  telefono VARCHAR NOT NULL,
  nombre_boton VARCHAR DEFAULT 'Asistencia 24hs',
  visible_en_portal BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT telefonos_asistencia_unique UNIQUE(compania_id)
);
ALTER TABLE telefonos_asistencia_companias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo en telefonos_asistencia_companias" ON telefonos_asistencia_companias;
CREATE POLICY "Permitir todo en telefonos_asistencia_companias" ON telefonos_asistencia_companias FOR ALL USING (true) WITH CHECK (true);

-- ── 6f. pdf_procesamientos (migración 008) ──────────────────────────────
CREATE TABLE IF NOT EXISTS pdf_procesamientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_operacion VARCHAR NOT NULL CHECK (tipo_operacion IN ('POLIZA_NUEVA','RENOVACION','ENDOSO')),
  poliza_origen_id UUID REFERENCES polizas(id) ON DELETE SET NULL,
  poliza_creada_id UUID REFERENCES polizas(id) ON DELETE SET NULL,
  endoso_creado_id UUID REFERENCES endosos(id) ON DELETE SET NULL,
  estado VARCHAR NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE','PROCESANDO','EXTRAIDO','APROBADO','CANCELADO','FALLIDO')),
  nombre_archivo VARCHAR NOT NULL,
  tamano_archivo INTEGER,
  ruta_temporal TEXT,
  datos_extraidos JSONB,
  mapeos_catalogos JSONB,
  campos_dudosos JSONB,
  tokens_usados INTEGER,
  costo_estimado DECIMAL(10,4),
  error_mensaje TEXT,
  usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pdf_procesamientos_estado ON pdf_procesamientos(estado);
CREATE INDEX IF NOT EXISTS idx_pdf_procesamientos_usuario ON pdf_procesamientos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_pdf_procesamientos_poliza_origen
  ON pdf_procesamientos(poliza_origen_id) WHERE poliza_origen_id IS NOT NULL;
ALTER TABLE pdf_procesamientos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo en pdf_procesamientos" ON pdf_procesamientos;
CREATE POLICY "Permitir todo en pdf_procesamientos" ON pdf_procesamientos FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION trg_pdf_procesamientos_touch() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tg_pdf_procesamientos_touch ON pdf_procesamientos;
CREATE TRIGGER tg_pdf_procesamientos_touch
  BEFORE UPDATE ON pdf_procesamientos FOR EACH ROW EXECUTE FUNCTION trg_pdf_procesamientos_touch();

-- ── 6g. poliza_bitacora (migración 009) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS poliza_bitacora (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poliza_id UUID NOT NULL REFERENCES polizas(id) ON DELETE CASCADE,
  tipo_evento VARCHAR NOT NULL CHECK (tipo_evento IN (
    'CREACION','CAMBIO_ESTADO','CANCELACION','ANULACION',
    'REHABILITACION','RENOVACION_CREADA','RENOVACION_ACTIVADA'
  )),
  estado_anterior VARCHAR,
  estado_nuevo VARCHAR,
  motivo TEXT,
  observaciones TEXT,
  usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_poliza_bitacora_poliza ON poliza_bitacora(poliza_id);
CREATE INDEX IF NOT EXISTS idx_poliza_bitacora_fecha ON poliza_bitacora(created_at DESC);
ALTER TABLE poliza_bitacora ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo en poliza_bitacora" ON poliza_bitacora;
CREATE POLICY "Permitir todo en poliza_bitacora" ON poliza_bitacora FOR ALL USING (true) WITH CHECK (true);

-- Backfill de eventos históricos (solo si la tabla está vacía)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM poliza_bitacora LIMIT 1) THEN
    INSERT INTO poliza_bitacora (poliza_id, tipo_evento, estado_nuevo, created_at)
    SELECT id, 'CREACION', estado, created_at FROM polizas;

    INSERT INTO poliza_bitacora (poliza_id, tipo_evento, estado_anterior, estado_nuevo, motivo, observaciones, created_at)
    SELECT id, 'CANCELACION', 'VIGENTE', 'CANCELADA', motivo_baja, observaciones_baja,
           COALESCE(fecha_baja::timestamptz, updated_at)
    FROM polizas WHERE estado = 'CANCELADA';

    INSERT INTO poliza_bitacora (poliza_id, tipo_evento, estado_anterior, estado_nuevo, motivo, observaciones, created_at)
    SELECT id, 'ANULACION', 'VIGENTE', 'ANULADA', motivo_baja, observaciones_baja,
           COALESCE(fecha_baja::timestamptz, updated_at)
    FROM polizas WHERE estado = 'ANULADA';
  END IF;
END $$;

-- ── 6h. restauraciones (migraciones 011+012, schema final sin cifrado) ──
CREATE TABLE IF NOT EXISTS restauraciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fuente VARCHAR NOT NULL CHECK (fuente IN ('BACKUP_EXISTENTE','ARCHIVO_SUBIDO')),
  backup_id UUID REFERENCES backups(id) ON DELETE SET NULL,
  nombre_archivo VARCHAR,
  tamano_archivo_bytes BIGINT,
  estado VARCHAR NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN (
    'PENDIENTE','VALIDANDO','PRE_BACKUP','EXTRAYENDO',
    'RESTAURANDO_DB','RESTAURANDO_STORAGE','FINALIZANDO',
    'COMPLETADA','FALLIDA','CANCELADA'
  )),
  paso_actual INTEGER DEFAULT 0,
  total_pasos INTEGER DEFAULT 7,
  mensaje_progreso TEXT,
  porcentaje INTEGER DEFAULT 0,
  restaura_db BOOLEAN DEFAULT true,
  restaura_storage BOOLEAN DEFAULT true,
  crear_pre_backup BOOLEAN DEFAULT true,
  pre_backup_id UUID REFERENCES backups(id) ON DELETE SET NULL,
  metadata_backup JSONB,
  fecha_inicio TIMESTAMPTZ DEFAULT NOW(),
  fecha_fin TIMESTAMPTZ,
  duracion_segundos INTEGER,
  error_mensaje TEXT,
  log_completo TEXT,
  work_dir TEXT,
  usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  ip_origen VARCHAR,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_restauraciones_fecha ON restauraciones(fecha_inicio DESC);
CREATE INDEX IF NOT EXISTS idx_restauraciones_estado ON restauraciones(estado);
CREATE INDEX IF NOT EXISTS idx_restauraciones_usuario ON restauraciones(usuario_id);
ALTER TABLE restauraciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo en restauraciones" ON restauraciones;
CREATE POLICY "Permitir todo en restauraciones" ON restauraciones FOR ALL USING (true) WITH CHECK (true);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PARTE 7: Crear TODAS las FK faltantes                                 ║
-- ║  (la auditoría encontró que solo existe 1 FK en toda la DB)            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- Helper: cada bloque verifica si ya existe una FK en la misma columna (por columna,
-- no por nombre) para evitar crear duplicados si la FK ya existía con otro nombre.
-- El viejo patrón EXCEPTION WHEN duplicate_object solo detectaba por nombre de constraint.

CREATE OR REPLACE FUNCTION _tmp_add_fk_if_not_exists(
  p_tabla TEXT, p_columna TEXT, p_constraint TEXT, p_def TEXT
) RETURNS void AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'f'
      AND c.conrelid = p_tabla::regclass
      AND a.attname = p_columna
  ) THEN
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', p_tabla, p_constraint, p_def);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ── polizas ─────────────────────────────────────────────────────────────
SELECT _tmp_add_fk_if_not_exists('polizas', 'asegurado_id', 'fk_polizas_asegurado',
  'FOREIGN KEY (asegurado_id) REFERENCES personas(id) ON DELETE CASCADE');
SELECT _tmp_add_fk_if_not_exists('polizas', 'tomador_id', 'fk_polizas_tomador',
  'FOREIGN KEY (tomador_id) REFERENCES personas(id) ON DELETE SET NULL');
SELECT _tmp_add_fk_if_not_exists('polizas', 'compania_id', 'fk_polizas_compania',
  'FOREIGN KEY (compania_id) REFERENCES catalogos(id) ON DELETE SET NULL');
SELECT _tmp_add_fk_if_not_exists('polizas', 'ramo_id', 'fk_polizas_ramo',
  'FOREIGN KEY (ramo_id) REFERENCES catalogos(id) ON DELETE SET NULL');
SELECT _tmp_add_fk_if_not_exists('polizas', 'cobertura_id', 'fk_polizas_cobertura',
  'FOREIGN KEY (cobertura_id) REFERENCES catalogos(id) ON DELETE SET NULL');
SELECT _tmp_add_fk_if_not_exists('polizas', 'refacturacion_id', 'fk_polizas_refacturacion',
  'FOREIGN KEY (refacturacion_id) REFERENCES catalogos(id) ON DELETE SET NULL');
SELECT _tmp_add_fk_if_not_exists('polizas', 'vigencia_tipo_id', 'fk_polizas_vigencia_tipo',
  'FOREIGN KEY (vigencia_tipo_id) REFERENCES catalogos(id) ON DELETE SET NULL');
SELECT _tmp_add_fk_if_not_exists('polizas', 'poliza_origen_id', 'fk_polizas_origen',
  'FOREIGN KEY (poliza_origen_id) REFERENCES polizas(id) ON DELETE CASCADE');

-- ── siniestros ──────────────────────────────────────────────────────────
SELECT _tmp_add_fk_if_not_exists('siniestros', 'poliza_id', 'fk_siniestros_poliza',
  'FOREIGN KEY (poliza_id) REFERENCES polizas(id) ON DELETE CASCADE');
SELECT _tmp_add_fk_if_not_exists('siniestros', 'persona_id', 'fk_siniestros_persona',
  'FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE');
SELECT _tmp_add_fk_if_not_exists('siniestros', 'riesgo_id', 'fk_siniestros_riesgo',
  'FOREIGN KEY (riesgo_id) REFERENCES riesgos(id) ON DELETE SET NULL');

-- ── riesgos ─────────────────────────────────────────────────────────────
SELECT _tmp_add_fk_if_not_exists('riesgos', 'poliza_id', 'fk_riesgos_poliza',
  'FOREIGN KEY (poliza_id) REFERENCES polizas(id) ON DELETE CASCADE');

-- ── tareas ──────────────────────────────────────────────────────────────
SELECT _tmp_add_fk_if_not_exists('tareas', 'persona_id', 'fk_tareas_persona',
  'FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE');
SELECT _tmp_add_fk_if_not_exists('tareas', 'poliza_id', 'fk_tareas_poliza',
  'FOREIGN KEY (poliza_id) REFERENCES polizas(id) ON DELETE SET NULL');
SELECT _tmp_add_fk_if_not_exists('tareas', 'siniestro_id', 'fk_tareas_siniestro',
  'FOREIGN KEY (siniestro_id) REFERENCES siniestros(id) ON DELETE SET NULL');

-- ── endosos ─────────────────────────────────────────────────────────────
SELECT _tmp_add_fk_if_not_exists('endosos', 'poliza_id', 'fk_endosos_poliza',
  'FOREIGN KEY (poliza_id) REFERENCES polizas(id) ON DELETE CASCADE');

-- ── poliza_archivos ─────────────────────────────────────────────────────
SELECT _tmp_add_fk_if_not_exists('poliza_archivos', 'poliza_id', 'fk_poliza_archivos_poliza',
  'FOREIGN KEY (poliza_id) REFERENCES polizas(id) ON DELETE CASCADE');
SELECT _tmp_add_fk_if_not_exists('poliza_archivos', 'endoso_id', 'fk_poliza_archivos_endoso',
  'FOREIGN KEY (endoso_id) REFERENCES endosos(id) ON DELETE CASCADE');

-- ── siniestro_bitacora ──────────────────────────────────────────────────
SELECT _tmp_add_fk_if_not_exists('siniestro_bitacora', 'siniestro_id', 'fk_siniestro_bitacora_siniestro',
  'FOREIGN KEY (siniestro_id) REFERENCES siniestros(id) ON DELETE CASCADE');

-- ── siniestro_archivos ──────────────────────────────────────────────────
SELECT _tmp_add_fk_if_not_exists('siniestro_archivos', 'siniestro_id', 'fk_siniestro_archivos_siniestro',
  'FOREIGN KEY (siniestro_id) REFERENCES siniestros(id) ON DELETE CASCADE');

-- ── notificaciones ──────────────────────────────────────────────────────
SELECT _tmp_add_fk_if_not_exists('notificaciones', 'usuario_id', 'fk_notificaciones_usuario',
  'FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE');

-- ── email_envios ────────────────────────────────────────────────────────
SELECT _tmp_add_fk_if_not_exists('email_envios', 'persona_id', 'fk_email_envios_persona',
  'FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE SET NULL');
SELECT _tmp_add_fk_if_not_exists('email_envios', 'poliza_id', 'fk_email_envios_poliza',
  'FOREIGN KEY (poliza_id) REFERENCES polizas(id) ON DELETE SET NULL');

-- ── email_bajas ─────────────────────────────────────────────────────────
SELECT _tmp_add_fk_if_not_exists('email_bajas', 'persona_id', 'fk_email_bajas_persona',
  'FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE SET NULL');

-- ── personas ────────────────────────────────────────────────────────────
SELECT _tmp_add_fk_if_not_exists('personas', 'usuario_id', 'fk_personas_usuario',
  'FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL');

-- ── facturacion ─────────────────────────────────────────────────────────
SELECT _tmp_add_fk_if_not_exists('facturacion', 'compania_id', 'fk_facturacion_compania',
  'FOREIGN KEY (compania_id) REFERENCES catalogos(id) ON DELETE CASCADE');
SELECT _tmp_add_fk_if_not_exists('facturacion', 'ramo_id', 'fk_facturacion_ramo',
  'FOREIGN KEY (ramo_id) REFERENCES catalogos(id) ON DELETE SET NULL');

-- ── postits ─────────────────────────────────────────────────────────────
SELECT _tmp_add_fk_if_not_exists('postits', 'usuario_id', 'fk_postits_usuario',
  'FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE');

-- ── sesiones ────────────────────────────────────────────────────────────
SELECT _tmp_add_fk_if_not_exists('sesiones', 'usuario_id', 'fk_sesiones_usuario',
  'FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE');

-- ── importaciones ───────────────────────────────────────────────────────
SELECT _tmp_add_fk_if_not_exists('importaciones', 'usuario_id', 'fk_importaciones_usuario',
  'FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL');

-- ── leads ───────────────────────────────────────────────────────────────
SELECT _tmp_add_fk_if_not_exists('leads', 'persona_id', 'fk_leads_persona',
  'FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE SET NULL');
SELECT _tmp_add_fk_if_not_exists('leads', 'usuario_id', 'fk_leads_usuario',
  'FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL');

-- ── oportunidades ───────────────────────────────────────────────────────
SELECT _tmp_add_fk_if_not_exists('oportunidades', 'persona_id', 'fk_oportunidades_persona',
  'FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE');
SELECT _tmp_add_fk_if_not_exists('oportunidades', 'usuario_id', 'fk_oportunidades_usuario',
  'FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL');

-- ── cotizaciones ────────────────────────────────────────────────────────
SELECT _tmp_add_fk_if_not_exists('cotizaciones', 'persona_id', 'fk_cotizaciones_persona',
  'FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE SET NULL');
SELECT _tmp_add_fk_if_not_exists('cotizaciones', 'lead_id', 'fk_cotizaciones_lead',
  'FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL');
SELECT _tmp_add_fk_if_not_exists('cotizaciones', 'oportunidad_id', 'fk_cotizaciones_oportunidad',
  'FOREIGN KEY (oportunidad_id) REFERENCES oportunidades(id) ON DELETE SET NULL');
SELECT _tmp_add_fk_if_not_exists('cotizaciones', 'usuario_id', 'fk_cotizaciones_usuario',
  'FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL');

-- ── cotizacion_companias ────────────────────────────────────────────────
SELECT _tmp_add_fk_if_not_exists('cotizacion_companias', 'cotizacion_id', 'fk_cotizacion_companias_cotizacion',
  'FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones(id) ON DELETE CASCADE');
SELECT _tmp_add_fk_if_not_exists('cotizacion_companias', 'compania_id', 'fk_cotizacion_companias_compania',
  'FOREIGN KEY (compania_id) REFERENCES catalogos(id) ON DELETE SET NULL');

-- ── interacciones ───────────────────────────────────────────────────────
SELECT _tmp_add_fk_if_not_exists('interacciones', 'lead_id', 'fk_interacciones_lead',
  'FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE');
SELECT _tmp_add_fk_if_not_exists('interacciones', 'oportunidad_id', 'fk_interacciones_oportunidad',
  'FOREIGN KEY (oportunidad_id) REFERENCES oportunidades(id) ON DELETE CASCADE');

-- ── errores_sistema ─────────────────────────────────────────────────────
SELECT _tmp_add_fk_if_not_exists('errores_sistema', 'usuario_id', 'fk_errores_sistema_usuario',
  'FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL');

-- ── importacion_jobs ────────────────────────────────────────────────────
SELECT _tmp_add_fk_if_not_exists('importacion_jobs', 'importacion_id', 'fk_importacion_jobs_importacion',
  'FOREIGN KEY (importacion_id) REFERENCES importaciones(id) ON DELETE CASCADE');

-- ── importacion_lotes ───────────────────────────────────────────────────
SELECT _tmp_add_fk_if_not_exists('importacion_lotes', 'importacion_id', 'fk_importacion_lotes_importacion',
  'FOREIGN KEY (importacion_id) REFERENCES importaciones(id) ON DELETE CASCADE');

-- ── importacion_registros_dudosos ───────────────────────────────────────
SELECT _tmp_add_fk_if_not_exists('importacion_registros_dudosos', 'importacion_id', 'fk_importacion_dudosos_importacion',
  'FOREIGN KEY (importacion_id) REFERENCES importaciones(id) ON DELETE CASCADE');

-- Limpiar la función temporal
DROP FUNCTION _tmp_add_fk_if_not_exists(TEXT, TEXT, TEXT, TEXT);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PARTE 8: Indexes faltantes y limpieza de indexes obsoletos            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- Index principal faltante: poliza_origen_id (usado en 23 archivos)
CREATE INDEX IF NOT EXISTS idx_polizas_poliza_origen
  ON polizas(poliza_origen_id) WHERE poliza_origen_id IS NOT NULL;

-- Recrear idx_polizas_estado con valores correctos
DROP INDEX IF EXISTS idx_polizas_estado;
CREATE INDEX idx_polizas_estado ON polizas(estado)
  WHERE estado IN ('VIGENTE','PROGRAMADA');

-- Recrear idx_siniestros_estado con valores correctos
DROP INDEX IF EXISTS idx_siniestros_estado;
CREATE INDEX idx_siniestros_estado ON siniestros(estado)
  WHERE estado NOT IN ('FINALIZADO','RECHAZADO');


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PARTE 9: Actualizar funciones que usan valores legacy                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- fn_sincronizar_estado_persona: cambiaba EMITIDA→PROGRAMADA
CREATE OR REPLACE FUNCTION fn_sincronizar_estado_persona()
RETURNS TRIGGER AS $$
DECLARE
    v_tiene_poliza_activa BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM polizas
        WHERE asegurado_id = COALESCE(NEW.asegurado_id, OLD.asegurado_id)
          AND estado IN ('VIGENTE', 'PROGRAMADA')
    ) INTO v_tiene_poliza_activa;

    UPDATE personas
    SET estado = CASE
                    WHEN v_tiene_poliza_activa THEN 'ACTIVO'
                    ELSE 'INACTIVO'
                 END,
        updated_at = NOW()
    WHERE id = COALESCE(NEW.asegurado_id, OLD.asegurado_id)
      AND estado NOT IN ('BLOQUEADO');

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PARTE 10: Recrear vista v_polizas_por_vencer (sin campos financieros) ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE VIEW v_polizas_por_vencer AS
SELECT
  p.id AS poliza_id,
  p.numero_poliza,
  p.fecha_fin,
  (p.fecha_fin - CURRENT_DATE) AS dias_restantes,
  p.estado AS estado_poliza,
  pe.id AS persona_id,
  (pe.apellido || ', ' || COALESCE(pe.nombre, pe.razon_social)) AS nombre_completo,
  pe.dni_cuil,
  pe.email,
  pe.telefono,
  pe.whatsapp,
  comp.nombre AS compania,
  ramo.nombre AS ramo,
  CASE
    WHEN (p.fecha_fin - CURRENT_DATE) < 0 THEN 'VENCIDA'
    WHEN (p.fecha_fin - CURRENT_DATE) <= 7 THEN 'URGENTE'
    WHEN (p.fecha_fin - CURRENT_DATE) <= 15 THEN 'CRITICA'
    WHEN (p.fecha_fin - CURRENT_DATE) <= 30 THEN 'PROXIMA'
    ELSE 'NORMAL'
  END AS prioridad_alerta
FROM polizas p
JOIN personas pe ON pe.id = p.asegurado_id
JOIN catalogos comp ON comp.id = p.compania_id
JOIN catalogos ramo ON ramo.id = p.ramo_id
WHERE p.estado = 'VIGENTE'
  AND p.fecha_fin <= (CURRENT_DATE + INTERVAL '60 days')
ORDER BY p.fecha_fin;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PARTE 11: Habilitar RLS en personas (única tabla sin RLS)             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

ALTER TABLE personas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo en personas" ON personas;
CREATE POLICY "Permitir todo en personas" ON personas FOR ALL USING (true) WITH CHECK (true);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PARTE 12: Eliminar catálogo MEDIO_PAGO (ya no se usa)                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

DELETE FROM catalogos WHERE tipo_id = (
  SELECT id FROM tipo_catalogo WHERE codigo = 'MEDIO_PAGO'
);
DELETE FROM tipo_catalogo WHERE codigo = 'MEDIO_PAGO';


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PARTE 13: Seed plantilla portal_cliente_acceso si no existe           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

INSERT INTO plantillas_email (codigo, nombre, descripcion, asunto_default, contexto, variables_disponibles)
VALUES (
  'portal_cliente_acceso',
  'Acceso al Portal del Cliente',
  'Email con el link de acceso permanente al portal del cliente',
  'Tu acceso al portal de {{productora_nombre}}',
  'CLIENTE',
  ARRAY['nombre','apellido','url_portal','productora_nombre','productora_telefono','productora_email']
) ON CONFLICT (codigo) DO NOTHING;


-- ============================================================================
-- FIN de la migración 017
-- ============================================================================
