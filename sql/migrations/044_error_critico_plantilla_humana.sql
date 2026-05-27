-- Migración 044: Plantilla sistema_error_critico con mensaje humano
--
-- La plantilla original (016) sólo mostraba el mensaje técnico crudo, lo que
-- es difícil de leer para el admin. Esta migración:
--   1. Reemplaza el cuerpo_default con uno que incluye mensaje_humano,
--      sugerencia y categoria_humana (categoría legible).
--   2. Si el cuerpo actual coincide exactamente con el cuerpo_default viejo
--      (PAS no lo editó), también actualiza el cuerpo. Si el PAS lo editó,
--      lo respeta y solo actualiza el default (para que "Restaurar default"
--      llegue a la versión nueva).
--   3. Amplía variables_disponibles con los nombres nuevos.

DO $$
DECLARE
  cuerpo_viejo TEXT := 'Se registró un error crítico en el CRM.

Detalles:
- Código: {{codigo}}
- Módulo: {{modulo}}
- Endpoint: {{endpoint}}
- Mensaje: {{mensaje}}
- Fecha: {{fecha}}

Revisá el panel de errores del sistema (Configuración → Errores del sistema) para más detalles.';
  cuerpo_nuevo TEXT := 'Se registró un error crítico en el CRM.

{{mensaje_humano}}

Sugerencia: {{sugerencia}}

Detalles técnicos:
- Categoría: {{categoria_humana}}
- Código: {{codigo}}
- Módulo: {{modulo}}
- Endpoint: {{endpoint}}
- Fecha: {{fecha}}

Revisá el panel de errores del sistema (Configuración → Errores del sistema) para más detalles, incluyendo el stack trace.';
BEGIN
  -- 1. Actualizar el cuerpo_default siempre (es la base de "Restaurar default")
  UPDATE plantillas_email
     SET cuerpo_default = cuerpo_nuevo,
         variables_disponibles = ARRAY[
           'nombre_admin', 'codigo', 'modulo', 'endpoint', 'mensaje',
           'mensaje_humano', 'sugerencia', 'categoria_humana', 'fecha'
         ]::text[]
   WHERE codigo = 'sistema_error_critico';

  -- 2. Si el cuerpo actual es idéntico al viejo default (PAS no lo editó),
  --    también actualizamos el cuerpo activo.
  UPDATE plantillas_email
     SET cuerpo = cuerpo_nuevo
   WHERE codigo = 'sistema_error_critico'
     AND cuerpo = cuerpo_viejo;
END $$;
