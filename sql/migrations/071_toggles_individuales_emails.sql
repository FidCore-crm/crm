-- Migración 071: toggles individuales para emails automáticos
--
-- Hasta acá, el admin tenía UN SOLO toggle (`notificar_admin_eventos_informativos`)
-- que controlaba si recibía todos los emails informativos o ninguno. Esa
-- granularidad era insuficiente: a un PAS le puede interesar enterarse de
-- emails fallidos pero no de cada backup exitoso.
--
-- Ahora cada evento informativo tiene su propio switch en
-- `configuracion_comunicaciones`. Los críticos (BACKUP_FALLIDO,
-- RESTAURACION_FALLIDA, ERROR_CRITICO, LICENCIA_*, etc.) NO tienen toggle
-- porque siempre se envían (es de seguridad).
--
-- También agregamos un toggle para el email de confirmación al cliente que
-- termina de cargar el formulario público de denuncia: hasta hoy se enviaba
-- sin opción de desactivarlo.
--
-- Estrategia de migración: el valor inicial de cada columna nueva es lo que
-- tenía el toggle global (`notificar_admin_eventos_informativos`). Si el admin
-- lo tenía OFF, todos los switches arrancan OFF. Si lo tenía ON, todos ON.
-- Excepción: los eventos "informativos pero de fallo" (PDF_FALLIDO,
-- EMAIL_AUTOMATICO_FALLIDO) arrancan ON aunque el toggle global esté OFF —
-- son señales que un PAS razonable querría conocer aunque no quiera el resto.

BEGIN;

-- ─── Toggles individuales por evento al admin ─────────────────────────────

ALTER TABLE configuracion_comunicaciones
  ADD COLUMN IF NOT EXISTS notificar_admin_backup_completado BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notificar_admin_restauracion_iniciada BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notificar_admin_restauracion_completada BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notificar_admin_pdf_procesado BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notificar_admin_pdf_fallido BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notificar_admin_email_automatico_fallido BOOLEAN NOT NULL DEFAULT true;

-- Backfill: si el admin tenía el toggle global ON, prendemos todos.
-- (Si lo tenía OFF, los defaults ya cubren — la mayoría OFF, los de fallo ON.)
UPDATE configuracion_comunicaciones
SET notificar_admin_backup_completado = true,
    notificar_admin_restauracion_iniciada = true,
    notificar_admin_restauracion_completada = true,
    notificar_admin_pdf_procesado = true,
    notificar_admin_pdf_fallido = true,
    notificar_admin_email_automatico_fallido = true
WHERE notificar_admin_eventos_informativos = true;

COMMENT ON COLUMN configuracion_comunicaciones.notificar_admin_backup_completado IS
  'Enviar email al admin cuando termina un backup exitoso. Informativo, default false.';
COMMENT ON COLUMN configuracion_comunicaciones.notificar_admin_restauracion_iniciada IS
  'Enviar email al admin al iniciar una restauración. Informativo, default false.';
COMMENT ON COLUMN configuracion_comunicaciones.notificar_admin_restauracion_completada IS
  'Enviar email al admin al terminar exitosamente una restauración. Informativo, default false.';
COMMENT ON COLUMN configuracion_comunicaciones.notificar_admin_pdf_procesado IS
  'Enviar email al admin cuando el agente IA extrae datos de un PDF y queda listo para revisar. Informativo, default false.';
COMMENT ON COLUMN configuracion_comunicaciones.notificar_admin_pdf_fallido IS
  'Enviar email al admin cuando falla el procesamiento de un PDF por la IA. Informativo (no crítico) pero default true.';
COMMENT ON COLUMN configuracion_comunicaciones.notificar_admin_email_automatico_fallido IS
  'Enviar email al admin cuando un email automático a un cliente falla. Informativo pero default true (no querés tener emails rebotando sin enterarte).';

-- ─── Toggle para confirmación al cliente del formulario público ───────────

ALTER TABLE configuracion_comunicaciones
  ADD COLUMN IF NOT EXISTS envio_automatico_denuncia_publica_cliente BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS envio_automatico_denuncia_publica_pas BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN configuracion_comunicaciones.envio_automatico_denuncia_publica_cliente IS
  'Enviar email automático de confirmación al cliente que carga una denuncia desde el formulario público (con el PDF adjunto). Default true.';
COMMENT ON COLUMN configuracion_comunicaciones.envio_automatico_denuncia_publica_pas IS
  'Enviar email automático al PAS cuando un cliente carga una denuncia desde el formulario público. Default true.';

-- ─── Deprecación suave del toggle global ──────────────────────────────────
-- No lo eliminamos para no romper código viejo, pero queda obsoleto.

COMMENT ON COLUMN configuracion_comunicaciones.notificar_admin_eventos_informativos IS
  'DEPRECADO desde migración 071. Reemplazado por toggles individuales por evento (notificar_admin_*). Se mantiene la columna por compatibilidad pero ya no se usa en el código.';

COMMIT;
