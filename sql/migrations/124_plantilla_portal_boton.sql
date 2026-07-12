-- Migración 124: plantilla portal_cliente_acceso pasa a usar botón CTA.
--
-- Contexto: el cuerpo de la plantilla incluía `{{url_portal}}` como texto
-- crudo. El renderizador lo escapaba y algunos clientes de email lo
-- auto-linkificaban a un <a> subrayado azul; en otros quedaba como URL
-- pelada. El asegurado veía una URL larga sin diseño.
--
-- Cambio: el cuerpo pasa a incluir `{{boton_accion}}` — variable
-- html-segura definida en el renderizador (VARIABLES_HTML_SEGURAS). El
-- endpoint /api/portal-cliente/acceso/[persona_id]/enviar genera el HTML
-- del botón con `generarBotonHtml()` usando el color de marca del PAS y
-- lo pasa como variables_extra al encolar el email.
--
-- Se actualiza el cuerpo real Y el cuerpo_default, para que:
--   - Instalaciones donde el PAS no editó la plantilla, tomen el nuevo
--     texto automáticamente.
--   - Instalaciones donde el PAS SÍ editó la plantilla y aún tiene el
--     texto por defecto (heurística: coincide con el default anterior),
--     también se actualicen.
--   - Instalaciones con texto custom se preservan — el PAS es dueño de su
--     copy.

UPDATE plantillas_email
   SET cuerpo_default = 'Te habilitamos el acceso a nuestro Portal del Cliente donde vas a poder consultar tus pólizas, siniestros y los teléfonos de asistencia 24hs de las compañías en cualquier momento.

Entrá desde este botón. Guardalo en favoritos, el acceso no vence:

{{boton_accion}}'
 WHERE codigo = 'portal_cliente_acceso';

-- Actualizar cuerpo real solo si coincide con el default anterior (sin
-- editar por el PAS). Comparación en dos formas por si hubo normalización
-- de whitespace en algún export/import intermedio.
UPDATE plantillas_email
   SET cuerpo = 'Te habilitamos el acceso a nuestro Portal del Cliente donde vas a poder consultar tus pólizas, siniestros y los teléfonos de asistencia 24hs de las compañías en cualquier momento.

Entrá desde este botón. Guardalo en favoritos, el acceso no vence:

{{boton_accion}}'
 WHERE codigo = 'portal_cliente_acceso'
   AND cuerpo IN (
     'Te habilitamos el acceso a nuestro Portal del Cliente donde vas a poder consultar tus pólizas, siniestros y los teléfonos de asistencia 24hs de las compañías en cualquier momento.

Usá este link para entrar. Guardalo en favoritos:

{{url_portal}}',
     'Te habilitamos el acceso a nuestro Portal del Cliente donde vas a poder consultar tus pólizas, siniestros y los teléfonos de asistencia 24hs de las compañías en cualquier momento.
Usá este link para entrar. Guardalo en favoritos:
{{url_portal}}'
   );
