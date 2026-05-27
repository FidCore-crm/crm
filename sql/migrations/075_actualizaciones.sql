-- Migración 075: Sistema de actualizaciones in-app
--
-- Permite al PAS ver actualizaciones disponibles del CRM, programarlas para
-- una hora específica o aplicarlas inmediatamente, y revisar el historial.
--
-- Arquitectura: el CRM (dentro de Docker) NO se puede actualizar a sí mismo.
-- Cuando el PAS programa o solicita "actualizar ahora", el CRM escribe un
-- archivo trigger (`tmp/updates/pending.json`) bind-mounted al host. Un cron
-- del host revisa cada minuto ese archivo; si la fecha programada ya pasó,
-- ejecuta `scripts/aplicar-actualizacion.sh` que hace backup → git pull →
-- docker compose build → up -d. El script actualiza esta tabla con el
-- progreso.

BEGIN;

-- ============================================================================
-- Tabla: actualizaciones (historial + estado de updates)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.actualizaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Versiones
  version_anterior VARCHAR(20) NOT NULL,
  version_nueva VARCHAR(20) NOT NULL,
  changelog TEXT,                          -- Notas del release de GitHub

  -- Programación / estado
  estado VARCHAR(20) NOT NULL DEFAULT 'PROGRAMADA'
    CHECK (estado IN ('PROGRAMADA', 'EJECUTANDO', 'COMPLETADA', 'FALLIDA', 'CANCELADA')),

  -- Programación temporal
  -- NULL = "actualizar ahora" (ejecutar en el próximo tick del cron host)
  -- TIMESTAMPTZ = fecha/hora específica en la que ejecutar
  programada_para TIMESTAMPTZ,

  -- Tracking de ejecución
  fecha_solicitud TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_inicio_ejecucion TIMESTAMPTZ,       -- Cuando el cron del host empezó
  fecha_fin_ejecucion TIMESTAMPTZ,          -- Cuando terminó (OK o falló)

  -- Backup pre-update (para rollback)
  backup_id UUID REFERENCES public.backups(id) ON DELETE SET NULL,

  -- Errores
  error_mensaje TEXT,                       -- Si estado=FALLIDA, qué pasó
  log_completo TEXT,                        -- stdout/stderr del script

  -- Auditoría
  solicitada_por_usuario_id UUID REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL,
  cancelada_por_usuario_id UUID REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger updated_at automático (patrón estándar del CRM, migración 052)
CREATE TRIGGER tg_actualizaciones_updated_at
  BEFORE UPDATE ON public.actualizaciones
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_actualizar_updated_at();

-- Solo puede haber UNA actualización en estado PROGRAMADA o EJECUTANDO a la vez.
-- Esto previene que el PAS dispare "actualizar ahora" mientras hay una
-- programada para más tarde, o que se solapen dos updates.
CREATE UNIQUE INDEX idx_actualizaciones_una_activa
  ON public.actualizaciones (estado)
  WHERE estado IN ('PROGRAMADA', 'EJECUTANDO');

-- Listado del historial ordenado por fecha
CREATE INDEX idx_actualizaciones_fecha
  ON public.actualizaciones (created_at DESC);


-- ============================================================================
-- configuracion: agregar version_actual y url_repo_updates
-- ============================================================================

-- version_actual: la versión del CRM que está corriendo. Se setea al iniciar
-- (lee de package.json) y se actualiza al completar un update exitoso.
-- url_repo_updates: el repo de GitHub desde donde se descargan los updates.
-- En instalaciones de clientes apunta a Pulzar-crm/crm; en dev puede apuntar
-- a otro fork si se quiere testear.

ALTER TABLE public.configuracion
  ADD COLUMN IF NOT EXISTS version_actual VARCHAR(20) DEFAULT '1.0.0',
  ADD COLUMN IF NOT EXISTS url_repo_updates VARCHAR(200) DEFAULT 'Pulzar-crm/crm',
  ADD COLUMN IF NOT EXISTS verificar_updates_automatico BOOLEAN DEFAULT true;

COMMENT ON COLUMN public.configuracion.version_actual IS
  'Versión del CRM corriendo. Se actualiza tras un update exitoso desde scripts/aplicar-actualizacion.sh.';
COMMENT ON COLUMN public.configuracion.url_repo_updates IS
  'Repo GitHub (formato owner/repo) desde donde se descargan updates. Default Pulzar-crm/crm.';


-- ============================================================================
-- RLS
-- ============================================================================

ALTER TABLE public.actualizaciones ENABLE ROW LEVEL SECURITY;

-- Lectura: admin only
DROP POLICY IF EXISTS "actualizaciones_select" ON public.actualizaciones;
CREATE POLICY "actualizaciones_select" ON public.actualizaciones
  FOR SELECT TO authenticated
  USING (fn_es_admin_actual());

-- Escritura: admin only
DROP POLICY IF EXISTS "actualizaciones_modify" ON public.actualizaciones;
CREATE POLICY "actualizaciones_modify" ON public.actualizaciones
  FOR ALL TO authenticated
  USING (fn_es_admin_actual())
  WITH CHECK (fn_es_admin_actual());


-- ============================================================================
-- Tipos de notificación nuevos
-- ============================================================================

-- Recrear el CHECK constraint de notificaciones.tipo y configuracion_notificaciones.tipo
-- para agregar los tipos del módulo de actualizaciones.

ALTER TABLE public.notificaciones DROP CONSTRAINT IF EXISTS notificaciones_tipo_check;
ALTER TABLE public.notificaciones
  ADD CONSTRAINT notificaciones_tipo_check
  CHECK (tipo::text = ANY (ARRAY[
    'POLIZA_VENCIDA', 'TAREA_VENCIDA', 'SINIESTRO_30_DIAS', 'SINIESTRO_60_DIAS',
    'COTIZACION_SIN_RESPUESTA', 'COTIZACION_SIN_SEGUIMIENTO', 'OPORTUNIDAD_ESTANCADA',
    'COTIZACION_VENCIENDO_PRONTO', 'COTIZACION_VENCIDA',
    'IMPORTACION_INICIADA', 'IMPORTACION_ANALIZADA', 'IMPORTACION_LISTA_REVISION',
    'IMPORTACION_COMPLETADA', 'IMPORTACION_FALLIDA', 'IMPORTACION_PAUSADA', 'IMPORTACION_DESHECHA',
    'PDF_LISTO_PARA_REVISAR', 'PDF_FALLIDO', 'POLIZA_REHABILITADA',
    'BACKUP_FALLIDO', 'BACKUP_SYNC_FALLIDO',
    'RESTAURACION_INICIADA', 'RESTAURACION_COMPLETADA', 'RESTAURACION_FALLIDA',
    'EMAIL_AUTOMATICO_FALLIDO',
    'SINIESTRO_DENUNCIA_PUBLICA',
    'SOLICITUD_BLANQUEO_PASSWORD',
    'BLANQUEO_ABUSO_DETECTADO',
    'LICENCIA_POR_VENCER', 'LICENCIA_VENCIDA', 'LICENCIA_EN_GRACIA',
    'LICENCIA_BLOQUEADA', 'LICENCIA_CARGADA', 'LICENCIA_PROMOVIDA',
    -- nuevos
    'ACTUALIZACION_DISPONIBLE',     -- Hay versión nueva, ver banner
    'ACTUALIZACION_PROGRAMADA',     -- Se programó update para fecha X
    'ACTUALIZACION_COMPLETADA',     -- Update aplicado OK
    'ACTUALIZACION_FALLIDA'         -- Update falló, backup restaurado
  ]::text[]));

ALTER TABLE public.configuracion_notificaciones DROP CONSTRAINT IF EXISTS configuracion_notificaciones_tipo_check;
ALTER TABLE public.configuracion_notificaciones
  ADD CONSTRAINT configuracion_notificaciones_tipo_check
  CHECK (tipo::text = ANY (ARRAY[
    'POLIZA_VENCIDA', 'TAREA_VENCIDA', 'SINIESTRO_30_DIAS', 'SINIESTRO_60_DIAS',
    'COTIZACION_SIN_RESPUESTA', 'COTIZACION_SIN_SEGUIMIENTO', 'OPORTUNIDAD_ESTANCADA',
    'COTIZACION_VENCIENDO_PRONTO', 'COTIZACION_VENCIDA',
    'IMPORTACION_INICIADA', 'IMPORTACION_ANALIZADA', 'IMPORTACION_LISTA_REVISION',
    'IMPORTACION_COMPLETADA', 'IMPORTACION_FALLIDA', 'IMPORTACION_PAUSADA', 'IMPORTACION_DESHECHA',
    'PDF_LISTO_PARA_REVISAR', 'PDF_FALLIDO', 'POLIZA_REHABILITADA',
    'BACKUP_FALLIDO', 'BACKUP_SYNC_FALLIDO',
    'RESTAURACION_INICIADA', 'RESTAURACION_COMPLETADA', 'RESTAURACION_FALLIDA',
    'EMAIL_AUTOMATICO_FALLIDO',
    'SINIESTRO_DENUNCIA_PUBLICA',
    'SOLICITUD_BLANQUEO_PASSWORD',
    'BLANQUEO_ABUSO_DETECTADO',
    'LICENCIA_POR_VENCER', 'LICENCIA_VENCIDA', 'LICENCIA_EN_GRACIA',
    'LICENCIA_BLOQUEADA', 'LICENCIA_CARGADA', 'LICENCIA_PROMOVIDA',
    'ACTUALIZACION_DISPONIBLE',
    'ACTUALIZACION_PROGRAMADA',
    'ACTUALIZACION_COMPLETADA',
    'ACTUALIZACION_FALLIDA'
  ]::text[]));

COMMIT;
