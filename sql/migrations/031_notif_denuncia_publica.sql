-- ============================================================
-- 031_notif_denuncia_publica.sql
--
-- Agrega el tipo de notificación `SINIESTRO_DENUNCIA_PUBLICA` al CHECK
-- de `notificaciones.tipo` y `configuracion_notificaciones.tipo`.
--
-- Motivo: el formulario público de denuncia de siniestros
-- (POST /api/publico/siniestros) ahora dispara una notificación in-app
-- al PAS dueño del cliente cuando entra una denuncia. Antes solo se
-- notificaba por email a `configuracion_correos.from_email`, lo que
-- dejaba al PAS sin alerta inmediata si SMTP fallaba o si la
-- productora compartía un inbox.
--
-- Mantiene los tipos existentes (snapshot tomado de la migración 017).
-- ============================================================

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
    'EMAIL_AUTOMATICO_FALLIDO',
    'SINIESTRO_DENUNCIA_PUBLICA'
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
    'EMAIL_AUTOMATICO_FALLIDO',
    'SINIESTRO_DENUNCIA_PUBLICA'
  ));
