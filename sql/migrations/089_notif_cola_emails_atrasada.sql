-- Migración 089 — Agregar tipo COLA_EMAILS_ATRASADA al enum de notificaciones.
--
-- El cron de envío de emails ahora detecta cuando la cola lleva más de 24h
-- atrasada (señal típica de SMTP caído o cron muerto) y dispara esta notif
-- in-app al admin. No mandamos email FidCore porque puede ser justamente el
-- SMTP el que está fallando.

BEGIN;

-- 1) Recrear el CHECK de notificaciones.tipo sumando el nuevo valor
ALTER TABLE public.notificaciones DROP CONSTRAINT IF EXISTS notificaciones_tipo_check;
ALTER TABLE public.notificaciones ADD CONSTRAINT notificaciones_tipo_check CHECK (
  tipo::text = ANY (ARRAY[
    'POLIZA_VENCIDA', 'TAREA_VENCIDA', 'SINIESTRO_30_DIAS', 'SINIESTRO_60_DIAS',
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
    'ACTUALIZACION_FALLIDA'
  ]::text[])
);

-- 2) Hacer lo mismo en configuracion_notificaciones (si tiene el mismo CHECK).
-- Patron defensivo: solo lo aplicamos si la tabla y constraint existen.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'configuracion_notificaciones'
      AND constraint_name = 'configuracion_notificaciones_tipo_check'
  ) THEN
    EXECUTE 'ALTER TABLE public.configuracion_notificaciones DROP CONSTRAINT configuracion_notificaciones_tipo_check';
    EXECUTE $cnst$
      ALTER TABLE public.configuracion_notificaciones ADD CONSTRAINT configuracion_notificaciones_tipo_check CHECK (
        tipo::text = ANY (ARRAY[
          'POLIZA_VENCIDA', 'TAREA_VENCIDA', 'SINIESTRO_30_DIAS', 'SINIESTRO_60_DIAS',
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
          'ACTUALIZACION_FALLIDA'
        ]::text[])
      )
    $cnst$;
  END IF;
END $$;

COMMIT;
