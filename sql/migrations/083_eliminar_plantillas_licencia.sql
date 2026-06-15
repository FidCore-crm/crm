-- Migración 083 — Eliminar plantillas sistema_licencia_* de plantillas_email.
--
-- Las plantillas relacionadas con avisos de vencimiento de licencia ya NO se
-- editan desde el CRM. Conceptualmente son emails que envía FidCore (la
-- empresa) al admin del PAS (el cliente). El PAS no tiene por qué editar el
-- contenido de un mensaje que la empresa proveedora le manda. Tampoco los
-- datos de contacto (1166794861 / pulzar.crm@gmail.com) deben venir de la
-- configuración del PAS.
--
-- Las plantillas pasan a estar hardcoded en `src/lib/fidcore-emails.ts` y el
-- envío usa el SMTP que el PAS configuró pero con From/Reply-To/firma
-- sobreescritos a los datos de FidCore.
--
-- Detalles:
--   * No se quita SISTEMA_LICENCIA_* del CHECK de email_envios.tipo_envio
--     porque puede haber rows históricos con esos valores (cuando los
--     emails de licencia se procesaban por la cola). Mantener el CHECK
--     evita romper esa data histórica.
--   * El UI de configuración también filtra `sistema_licencia_%` para no
--     mostrarlas si llegan a reaparecer (defense in depth).
--   * Los rows existentes de email_envios con tipo SISTEMA_LICENCIA_* se
--     dejan intactos — son histórico de envíos previos al cambio.

BEGIN;

DELETE FROM public.plantillas_email
WHERE codigo IN (
  'sistema_licencia_por_vencer',
  'sistema_licencia_en_gracia',
  'sistema_licencia_bloqueada'
);

COMMIT;
