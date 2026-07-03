-- ============================================================
-- Migración 110 — comparacion_ia en polizas + tipo notificación
-- ============================================================
--
-- Guarda el resultado del comparador IA de renovaciones. Se llena en background
-- después de que el PAS aprueba una renovación con PDF y comparación pedida.
--
-- Shape del JSONB:
-- {
--   "poliza_origen_id": "uuid",
--   "archivo_viejo_id": "uuid",           -- poliza_archivos.id de la póliza origen
--   "archivo_nuevo_id": "uuid",           -- poliza_archivos.id de esta póliza
--   "estado": "PROCESANDO" | "COMPLETADA" | "FALLIDA",
--   "cambios": [ { categoria, campo, antes, ahora, tipo, severidad, descripcion } ],
--   "resumen": "1-2 líneas de tl;dr",
--   "error": null,
--   "tokens_usados": 0,
--   "costo_usd": 0,
--   "duracion_ms": 0,
--   "creado_en": "iso",
--   "completado_en": "iso"
-- }
--
-- Sólo la póliza NUEVA (la renovación) tiene esto lleno. La póliza origen queda
-- null porque el análisis vive del lado de la renovación.
-- ============================================================

ALTER TABLE polizas
  ADD COLUMN IF NOT EXISTS comparacion_ia JSONB;

-- Notificación nueva: cuando la comparación IA termina, avisamos al PAS.
-- Actualizamos el CHECK constraint de notificaciones.tipo para admitirla.
DO $$
BEGIN
  -- Eliminar el CHECK existente si está.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notificaciones_tipo_check' AND conrelid = 'notificaciones'::regclass
  ) THEN
    ALTER TABLE notificaciones DROP CONSTRAINT notificaciones_tipo_check;
  END IF;
END $$;

-- Recreamos con el tipo nuevo incluido. Lista extraída de las migraciones
-- previas que definen tipos de notificación (mantenemos todos los históricos).
ALTER TABLE notificaciones
  ADD CONSTRAINT notificaciones_tipo_check
  CHECK (tipo IN (
    -- Notificaciones históricas del CRM
    'POLIZA_VENCIDA',
    'POLIZA_REHABILITADA',
    'TAREA_VENCIDA',
    'SINIESTRO_30_DIAS',
    'SINIESTRO_60_DIAS',
    'COTIZACION_SIN_RESPUESTA',
    'COTIZACION_SIN_SEGUIMIENTO',
    'COTIZACION_VENCIENDO_PRONTO',
    'COTIZACION_VENCIDA',
    'OPORTUNIDAD_ESTANCADA',
    -- Importador
    'IMPORTACION_INICIADA',
    'IMPORTACION_ANALIZADA',
    'IMPORTACION_LISTA_REVISION',
    'IMPORTACION_COMPLETADA',
    'IMPORTACION_FALLIDA',
    'IMPORTACION_PAUSADA',
    'IMPORTACION_DESHECHA',
    -- Agente IA de PDFs
    'PDF_LISTO_PARA_REVISAR',
    'PDF_FALLIDO',
    -- Sistema (backups, emails automáticos)
    'BACKUP_FALLIDO',
    'BACKUP_SYNC_FALLIDO',
    'RESTAURACION_INICIADA',
    'RESTAURACION_COMPLETADA',
    'RESTAURACION_FALLIDA',
    'EMAIL_AUTOMATICO_FALLIDO',
    'EMAIL_COLA_ATRASADA',
    -- Licencias
    'LICENCIA_POR_VENCER',
    'LICENCIA_VENCIDA',
    'LICENCIA_EN_GRACIA',
    'LICENCIA_BLOQUEADA',
    'LICENCIA_CARGADA',
    'LICENCIA_PROMOVIDA',
    -- Leads web
    'LEAD_WEB_NUEVO',
    -- NUEVO: comparación IA de renovación completada
    'RENOVACION_COMPARACION_LISTA',
    'RENOVACION_COMPARACION_FALLIDA'
  ));
