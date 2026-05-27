-- ============================================================
-- 032_urls_publicas_configuracion.sql
--
-- Agrega 3 columnas en `configuracion` para que el PAS pueda configurar
-- los subdominios de los 3 puntos de entrada del CRM desde la UI:
--
--   url_crm                 → admin/login (ej: https://crm.suempresa.com.ar)
--   url_portal_cliente      → portal del asegurado (ej: https://portal.suempresa.com.ar)
--   url_formulario_publico  → formulario de denuncia (ej: https://siniestros.suempresa.com.ar)
--
-- Reemplaza la dependencia de las env vars `URL_PORTAL_CLIENTE` y
-- `URL_FORMULARIO_PUBLICO` (que requerían acceso al `.env` del server +
-- restart del servicio). El helper `urls-publicas.ts` lee de DB con
-- fallback a env, así no se rompen instalaciones existentes.
--
-- Las 3 columnas son nullable: si están vacías, el helper cae al env.
-- El frontend muestra inputs editables en sus pantallas respectivas.
-- ============================================================

ALTER TABLE configuracion
  ADD COLUMN IF NOT EXISTS url_crm                VARCHAR,
  ADD COLUMN IF NOT EXISTS url_portal_cliente     VARCHAR,
  ADD COLUMN IF NOT EXISTS url_formulario_publico VARCHAR;

COMMENT ON COLUMN configuracion.url_crm
  IS 'URL pública del CRM (admin/login). Editable desde Configuración → Perfil.';
COMMENT ON COLUMN configuracion.url_portal_cliente
  IS 'URL pública del portal del cliente. Editable desde Configuración → Portal del Cliente.';
COMMENT ON COLUMN configuracion.url_formulario_publico
  IS 'URL pública del formulario de denuncia. Editable desde Configuración → Formulario público.';
