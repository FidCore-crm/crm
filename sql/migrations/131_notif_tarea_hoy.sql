-- ============================================================
-- 131 — Notificaciones: TAREA_HOY nueva + desactivar POLIZA_POR_VENCER
-- ============================================================
-- Feedback del PAS (v1.0.135 dogfooding):
--
-- 1) POLIZA_POR_VENCER genera ruido — el PAS recibe notificaciones de
--    pólizas que aún no vencieron, sin poder actuar. Las páginas
--    /crm/renovaciones y /crm/dashboard ya muestran los KPIs de "vence
--    en X días". Sólo alertar POLIZA_VENCIDA (post facto, requiere
--    acción inmediata).
--
-- 2) TAREA_VENCIDA sólo dispara cuando el día ya pasó. El PAS quiere que
--    el día MISMO le llegue el aviso. Se agrega TAREA_HOY que dispara
--    cuando `fecha_vencimiento = hoy` — aviso PROACTIVO, no reactivo.
--    Anti-spam 1 día para no repetir en cascadas del cron cada 2h.
-- ============================================================

-- 1) notificaciones.tipo — sumar TAREA_HOY
ALTER TABLE public.notificaciones DROP CONSTRAINT IF EXISTS notificaciones_tipo_check;
ALTER TABLE public.notificaciones ADD CONSTRAINT notificaciones_tipo_check CHECK (
  tipo::text = ANY (ARRAY[
    'POLIZA_VENCIDA', 'POLIZA_POR_VENCER',
    'TAREA_VENCIDA', 'TAREA_HOY',
    'SINIESTRO_30_DIAS', 'SINIESTRO_60_DIAS',
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
          'TAREA_VENCIDA', 'TAREA_HOY',
          'SINIESTRO_30_DIAS', 'SINIESTRO_60_DIAS',
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
    $cnst$;
  END IF;
END $$;

-- 3) Seed inicial de TAREA_HOY + desactivar POLIZA_POR_VENCER en instalaciones existentes
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'configuracion_notificaciones') THEN
    -- TAREA_HOY: activa por default, sin umbral (dispara el mismo día), antispam 1 día
    INSERT INTO public.configuracion_notificaciones (tipo, activa, umbral_dias, antispam_dias)
    VALUES ('TAREA_HOY', true, 0, 1)
    ON CONFLICT (tipo) DO NOTHING;

    -- POLIZA_POR_VENCER: forzar activa=false en instalaciones que ya tenían el registro
    UPDATE public.configuracion_notificaciones
      SET activa = false
      WHERE tipo = 'POLIZA_POR_VENCER';
  END IF;
END $$;
