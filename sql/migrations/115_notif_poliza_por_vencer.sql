-- ============================================================
-- 115 — Notificación POLIZA_POR_VENCER
-- ============================================================
-- Hasta ahora el sistema notificaba POLIZA_VENCIDA (post facto) pero no
-- había aviso ANTICIPADO. El PAS quiere ver "esta póliza vence en X días"
-- antes de que pase, no después. Sin este aviso, muchas pólizas quedan
-- vencidas sin renovar porque el PAS no se enteró a tiempo.
--
-- Este tipo se dispara cuando una póliza VIGENTE está por vencer y NO
-- tiene renovación creada. Escalado según cercanía:
--   • 30 días → INFORMATIVA
--   • 15 días → ADVERTENCIA
--   • 7  días → ADVERTENCIA
--   • 3  días → CRITICA
-- Anti-spam configurable (default 3 días por póliza).
-- ============================================================

-- 1) notificaciones.tipo
ALTER TABLE public.notificaciones DROP CONSTRAINT IF EXISTS notificaciones_tipo_check;
ALTER TABLE public.notificaciones ADD CONSTRAINT notificaciones_tipo_check CHECK (
  tipo::text = ANY (ARRAY[
    'POLIZA_VENCIDA', 'POLIZA_POR_VENCER',
    'TAREA_VENCIDA', 'SINIESTRO_30_DIAS', 'SINIESTRO_60_DIAS',
    'COTIZACION_SIN_RESPUESTA', 'COTIZACION_SIN_SEGUIMIENTO', 'OPORTUNIDAD_ESTANCADA',
    'COTIZACION_VENCIENDO_PRONTO', 'COTIZACION_VENCIDA',
    'IMPORTACION_INICIADA', 'IMPORTACION_ANALIZADA', 'IMPORTACION_LISTA_REVISION',
    'IMPORTACION_COMPLETADA', 'IMPORTACION_FALLIDA', 'IMPORTACION_PAUSADA', 'IMPORTACION_DESHECHA',
    'PDF_LISTO_PARA_REVISAR', 'PDF_FALLIDO',
    'POLIZA_REHABILITADA',
    'BACKUP_FALLIDO', 'BACKUP_SYNC_FALLIDO',
    'RESTAURACION_INICIADA', 'RESTAURACION_COMPLETADA', 'RESTAURACION_FALLIDA',
    'EMAIL_AUTOMATICO_FALLIDO',
    'COLA_EMAILS_ATRASADA',
    'SINIESTRO_DENUNCIA_PUBLICA',
    'SOLICITUD_BLANQUEO_PASSWORD', 'BLANQUEO_ABUSO_DETECTADO',
    'LICENCIA_POR_VENCER', 'LICENCIA_VENCIDA', 'LICENCIA_EN_GRACIA', 'LICENCIA_BLOQUEADA',
    'LICENCIA_CARGADA', 'LICENCIA_PROMOVIDA',
    'ACTUALIZACION_DISPONIBLE', 'ACTUALIZACION_PROGRAMADA', 'ACTUALIZACION_COMPLETADA',
    'ACTUALIZACION_FALLIDA',
    'LEAD_WEB_NUEVO',
    'RENOVACION_COMPARACION_LISTA', 'RENOVACION_COMPARACION_FALLIDA'
  ]::text[])
);

-- 2) configuracion_notificaciones.tipo (mismo enum)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'configuracion_notificaciones'
      AND constraint_name = 'configuracion_notificaciones_tipo_check'
  ) THEN
    EXECUTE 'ALTER TABLE public.configuracion_notificaciones DROP CONSTRAINT configuracion_notificaciones_tipo_check';
    EXECUTE $cnst$
      ALTER TABLE public.configuracion_notificaciones ADD CONSTRAINT configuracion_notificaciones_tipo_check CHECK (
        tipo::text = ANY (ARRAY[
          'POLIZA_VENCIDA', 'POLIZA_POR_VENCER',
          'TAREA_VENCIDA', 'SINIESTRO_30_DIAS', 'SINIESTRO_60_DIAS',
          'COTIZACION_SIN_RESPUESTA', 'COTIZACION_SIN_SEGUIMIENTO', 'OPORTUNIDAD_ESTANCADA',
          'COTIZACION_VENCIENDO_PRONTO', 'COTIZACION_VENCIDA',
          'IMPORTACION_INICIADA', 'IMPORTACION_ANALIZADA', 'IMPORTACION_LISTA_REVISION',
          'IMPORTACION_COMPLETADA', 'IMPORTACION_FALLIDA', 'IMPORTACION_PAUSADA', 'IMPORTACION_DESHECHA',
          'PDF_LISTO_PARA_REVISAR', 'PDF_FALLIDO',
          'POLIZA_REHABILITADA',
          'BACKUP_FALLIDO', 'BACKUP_SYNC_FALLIDO',
          'RESTAURACION_INICIADA', 'RESTAURACION_COMPLETADA', 'RESTAURACION_FALLIDA',
          'EMAIL_AUTOMATICO_FALLIDO',
          'COLA_EMAILS_ATRASADA',
          'SINIESTRO_DENUNCIA_PUBLICA',
          'SOLICITUD_BLANQUEO_PASSWORD', 'BLANQUEO_ABUSO_DETECTADO',
          'LICENCIA_POR_VENCER', 'LICENCIA_VENCIDA', 'LICENCIA_EN_GRACIA', 'LICENCIA_BLOQUEADA',
          'LICENCIA_CARGADA', 'LICENCIA_PROMOVIDA',
          'ACTUALIZACION_DISPONIBLE', 'ACTUALIZACION_PROGRAMADA', 'ACTUALIZACION_COMPLETADA',
          'ACTUALIZACION_FALLIDA',
          'LEAD_WEB_NUEVO'
        ]::text[])
      );
    $cnst$;
  END IF;
END $$;

-- 3) Seed opcional de configuración por default (si la tabla existe y NO
-- tiene ya un registro para este tipo — idempotente).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'configuracion_notificaciones') THEN
    INSERT INTO public.configuracion_notificaciones (tipo, activa, umbral_dias, antispam_dias)
    VALUES ('POLIZA_POR_VENCER', true, 30, 3)
    ON CONFLICT (tipo) DO NOTHING;
  END IF;
END $$;
