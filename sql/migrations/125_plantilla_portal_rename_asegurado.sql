-- Migración 125: rename "Portal del Cliente" → "Portal del Asegurado" en la
-- plantilla portal_cliente_acceso + fix del whitespace antes del botón.
--
-- Contexto: la plantilla decía "Portal del Cliente" en el asunto y en el
-- cuerpo, mientras que el resto del sistema y el propio botón CTA (v1.0.113)
-- ya dicen "Portal del Asegurado". El asegurado veía inconsistencia.
--
-- Además, el cuerpo tenía `\n\n{{boton_accion}}` que sumado al margin:28px de
-- la <table> del botón generaba ~3 líneas en blanco antes del CTA. Se deja un
-- solo `\n` — la tabla ya trae su propio margin.
--
-- Se actualizan cuerpo/asunto solo si coinciden con los defaults previos
-- (heurística: instalaciones donde el PAS no editó la plantilla). El copy
-- custom del PAS se preserva.

-- ---------- Defaults nuevos (siempre se actualizan) ----------

UPDATE plantillas_email
   SET asunto_default = 'Tu acceso al Portal del Asegurado',
       cuerpo_default = 'Te habilitamos el acceso a nuestro Portal del Asegurado donde vas a poder consultar tus pólizas, siniestros y los teléfonos de asistencia 24hs de las compañías en cualquier momento.

Entrá desde este botón. Guardalo en favoritos, el acceso no vence:
{{boton_accion}}'
 WHERE codigo = 'portal_cliente_acceso';

-- ---------- Asunto real ----------
-- Se actualiza solo si coincide con alguno de los defaults previos.

UPDATE plantillas_email
   SET asunto = 'Tu acceso al Portal del Asegurado'
 WHERE codigo = 'portal_cliente_acceso'
   AND asunto IN (
     'Tu acceso al Portal de Clientes',
     'Tu acceso al Portal del Cliente'
   );

-- ---------- Cuerpo real ----------
-- Coincidencia contra el default post-v1.0.112 (migración 124).

UPDATE plantillas_email
   SET cuerpo = 'Te habilitamos el acceso a nuestro Portal del Asegurado donde vas a poder consultar tus pólizas, siniestros y los teléfonos de asistencia 24hs de las compañías en cualquier momento.

Entrá desde este botón. Guardalo en favoritos, el acceso no vence:
{{boton_accion}}'
 WHERE codigo = 'portal_cliente_acceso'
   AND cuerpo IN (
     'Te habilitamos el acceso a nuestro Portal del Cliente donde vas a poder consultar tus pólizas, siniestros y los teléfonos de asistencia 24hs de las compañías en cualquier momento.

Entrá desde este botón. Guardalo en favoritos, el acceso no vence:

{{boton_accion}}',
     -- Variante sin \n\n intermedio (por si algún export/import lo colapsó).
     'Te habilitamos el acceso a nuestro Portal del Cliente donde vas a poder consultar tus pólizas, siniestros y los teléfonos de asistencia 24hs de las compañías en cualquier momento.
Entrá desde este botón. Guardalo en favoritos, el acceso no vence:
{{boton_accion}}'
   );
