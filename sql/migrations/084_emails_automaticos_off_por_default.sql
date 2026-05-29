-- Migración 084 — Todos los emails automáticos arrancan en OFF.
--
-- Para que cada instalación nueva del CRM no spamee a clientes ni admin
-- desde el día 0, todos los toggles de envío automático y notificaciones
-- al admin pasan a default `false`. El PAS los habilita uno por uno
-- desde Configuración → Comunicaciones cuando esté listo para usarlos.
--
-- Toggles afectados (defaults TRUE → FALSE):
--   * envio_automatico_bienvenida_poliza
--   * envio_automatico_denuncia_publica_cliente
--   * envio_automatico_denuncia_publica_pas
--   * envio_automatico_portal_cliente
--   * notificar_admin_email_automatico_fallido
--   * notificar_admin_pdf_fallido
--
-- Toggles que ya estaban en false (no se tocan):
--   * envio_automatico_renovaciones
--   * notificar_admin_backup_completado
--   * notificar_admin_eventos_informativos
--   * notificar_admin_pdf_procesado
--   * notificar_admin_restauracion_completada
--   * notificar_admin_restauracion_iniciada
--
-- Importante: además del cambio de default (para nuevas instalaciones),
-- también hacemos UPDATE de los rows existentes. Esto afecta a las
-- instalaciones ya corriendo — el admin va a tener que reactivar los
-- toggles que quiera usar. Es intencional: el espíritu del cambio es
-- "todos los avisos automáticos arrancan apagados; el PAS decide".

BEGIN;

ALTER TABLE public.configuracion_comunicaciones
  ALTER COLUMN envio_automatico_bienvenida_poliza        SET DEFAULT false,
  ALTER COLUMN envio_automatico_denuncia_publica_cliente SET DEFAULT false,
  ALTER COLUMN envio_automatico_denuncia_publica_pas     SET DEFAULT false,
  ALTER COLUMN envio_automatico_portal_cliente           SET DEFAULT false,
  ALTER COLUMN notificar_admin_email_automatico_fallido  SET DEFAULT false,
  ALTER COLUMN notificar_admin_pdf_fallido               SET DEFAULT false;

-- Apagamos también la row existente (singleton) — el PAS tendrá que
-- activar manualmente los que quiera usar.
UPDATE public.configuracion_comunicaciones SET
  envio_automatico_bienvenida_poliza        = false,
  envio_automatico_denuncia_publica_cliente = false,
  envio_automatico_denuncia_publica_pas     = false,
  envio_automatico_portal_cliente           = false,
  envio_automatico_renovaciones             = false,
  notificar_admin_backup_completado         = false,
  notificar_admin_email_automatico_fallido  = false,
  notificar_admin_eventos_informativos      = false,
  notificar_admin_pdf_fallido               = false,
  notificar_admin_pdf_procesado             = false,
  notificar_admin_restauracion_completada   = false,
  notificar_admin_restauracion_iniciada     = false;

-- Garantizamos que exista la row singleton aunque nadie haya entrado
-- todavía al módulo de Comunicaciones. El endpoint PATCH falla si el
-- singleton no existe; con esto el PAS puede activar toggles desde la
-- primera vez que abre la pantalla.
-- Idempotente: solo inserta si la tabla está vacía.
-- Forma compatible con SQL estándar (PostgreSQL no acepta `DEFAULT VALUES WHERE`).
INSERT INTO public.configuracion_comunicaciones (activo)
SELECT false
WHERE NOT EXISTS (SELECT 1 FROM public.configuracion_comunicaciones);

COMMIT;
