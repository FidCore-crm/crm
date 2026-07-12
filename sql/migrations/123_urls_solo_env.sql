-- Migración 123: URLs públicas quedan solo en env, DB vacía.
--
-- Contexto: hasta esta migración las URLs de CRM/portal/formulario podían
-- vivir en dos lados: (1) columnas `configuracion.url_*` en DB, (2) env vars
-- `URL_CRM_PUBLICA`, `URL_PORTAL_CLIENTE`, `URL_FORMULARIO_PUBLICO`. El
-- resolver leía DB primero y caía al env como fallback.
--
-- Problema del modelo dual:
--   - Un backup restore de otra instalación pisaba las URLs correctas del
--     env con las del PAS anterior. Bug silencioso.
--   - Cambiar el env sin borrar la fila vieja de DB no tenía efecto.
--   - Dos fuentes de verdad para el mismo dato.
--
-- Nueva realidad: env manda siempre. El instalador setea las 3 durante el
-- wizard. El PAS no las puede editar desde el CRM (los inputs de la UI ya
-- fueron removidos en esta misma sesión).
--
-- Esta migración vacía las 3 columnas para dejar la fuente única clara.
-- NO borramos las columnas — quedan como espacio muerto (costo cero,
-- eliminar requeriría lidiar con RLS + tipos generados).

UPDATE configuracion
   SET url_crm                = NULL,
       url_portal_cliente     = NULL,
       url_formulario_publico = NULL;
