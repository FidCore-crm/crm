-- ============================================================
-- 037_cotizacion_templates.sql
--
-- Agrega plantillas configurables para los mensajes predefinidos
-- que el PAS usa al enviar cotizaciones por WhatsApp y por email
-- desde la ficha de la cotización.
--
-- Variables disponibles en los templates:
--   {nombre}   → primer nombre del destinatario (persona o lead)
--   {numero}   → número de cotización (ej: COT-0042)
--   {ramo}     → ramo de la cotización (ej: Automotor)
--   {opciones} → cantidad de opciones de compañías
--
-- Si el campo está NULL, el código del CRM usa el texto default
-- hardcodeado para mantener compatibilidad. La migración inicializa
-- los campos con los textos default actuales para que el PAS pueda
-- editarlos sin tener que rearmarlos desde cero.
-- ============================================================

BEGIN;

ALTER TABLE configuracion
  ADD COLUMN IF NOT EXISTS cotizacion_whatsapp_template TEXT,
  ADD COLUMN IF NOT EXISTS cotizacion_email_asunto_template TEXT,
  ADD COLUMN IF NOT EXISTS cotizacion_email_cuerpo_template TEXT;

-- Inicializar con los textos default si están NULL.
-- Idempotente: solo updatea filas con NULL.
UPDATE configuracion SET
  cotizacion_whatsapp_template = COALESCE(
    cotizacion_whatsapp_template,
    'Hola {nombre}, te paso la cotización N° {numero} de {ramo} con {opciones} opciones a comparar. Te adjunto el PDF con el detalle. Cualquier consulta a las órdenes.'
  ),
  cotizacion_email_asunto_template = COALESCE(
    cotizacion_email_asunto_template,
    'Cotización {numero} - {ramo}'
  ),
  cotizacion_email_cuerpo_template = COALESCE(
    cotizacion_email_cuerpo_template,
    'Hola {nombre}, adjuntamos la cotización N° {numero} solicitada para su evaluación. Quedamos a disposición para cualquier consulta.'
  );

COMMIT;
