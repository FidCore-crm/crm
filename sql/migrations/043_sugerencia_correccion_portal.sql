-- Migración 043: Tipo de evento SISTEMA_SUGERENCIA_CORRECCION_PORTAL
-- Migra el endpoint /api/publico/portal-cliente/sugerir-correccion al sistema
-- unificado de comunicaciones (cola en email_envios) en lugar de enviarEmail
-- directo. Permite que la sugerencia quede en historial, se reintente si falla
-- SMTP, y respete el toggle del sistema.

-- ============================================================================
-- 1. Ampliar CHECK de tipo_envio en email_envios
-- ============================================================================
ALTER TABLE email_envios DROP CONSTRAINT IF EXISTS email_envios_tipo_envio_check;
ALTER TABLE email_envios ADD CONSTRAINT email_envios_tipo_envio_check
  CHECK (tipo_envio IN (
    -- Envíos a clientes
    'AUTOMATICO_BIENVENIDA',
    'AUTOMATICO_RENOVACION',
    'AUTOMATICO_PORTAL_CLIENTE',
    'MANUAL',
    'MASIVO',
    'NOTIFICACION_INTERNA',
    -- Notificaciones al admin (SISTEMA)
    'SISTEMA_BACKUP_COMPLETADO',
    'SISTEMA_BACKUP_FALLIDO',
    'SISTEMA_BACKUP_SYNC_FALLIDO',
    'SISTEMA_RESTAURACION_INICIADA',
    'SISTEMA_RESTAURACION_COMPLETADA',
    'SISTEMA_RESTAURACION_FALLIDA',
    'SISTEMA_PDF_PROCESADO',
    'SISTEMA_PDF_FALLIDO',
    'SISTEMA_EMAIL_AUTOMATICO_FALLIDO',
    'SISTEMA_ERROR_CRITICO',
    -- Nuevo en 043
    'SISTEMA_SUGERENCIA_CORRECCION_PORTAL'
  ));

-- ============================================================================
-- 2. Plantilla sistema_sugerencia_correccion_portal
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM plantillas_email WHERE codigo = 'sistema_sugerencia_correccion_portal') THEN
    INSERT INTO plantillas_email
      (codigo, nombre, descripcion, contexto,
       asunto, saludo, cuerpo, cierre,
       asunto_default, saludo_default, cuerpo_default, cierre_default,
       variables_disponibles, activa, es_sistema, editable)
    VALUES
      (
        'sistema_sugerencia_correccion_portal',
        'Sugerencia de corrección desde el portal',
        'Notificación al admin cuando un asegurado sugiere actualizar sus datos desde el portal del cliente.',
        'GENERAL',
        'Sugerencia de datos — {{nombre_asegurado}}',
        'Hola {{nombre_admin}}!',
        '{{nombre_asegurado}} (DNI {{dni}}) sugirió actualizar sus datos desde el portal del asegurado.

DATOS ACTUALES:
- Teléfono: {{telefono_actual}}
- Email: {{email_actual}}
- Dirección: {{direccion_actual}}

CAMBIOS SUGERIDOS:
{{cambios_sugeridos}}

MENSAJE ADICIONAL:
{{mensaje_extra}}

Revisá los datos en la ficha del cliente y aplicá los cambios si correspondiera.',
        'Sistema CRM Seguros',
        'Sugerencia de datos — {{nombre_asegurado}}',
        'Hola {{nombre_admin}}!',
        '{{nombre_asegurado}} (DNI {{dni}}) sugirió actualizar sus datos desde el portal del asegurado.

DATOS ACTUALES:
- Teléfono: {{telefono_actual}}
- Email: {{email_actual}}
- Dirección: {{direccion_actual}}

CAMBIOS SUGERIDOS:
{{cambios_sugeridos}}

MENSAJE ADICIONAL:
{{mensaje_extra}}

Revisá los datos en la ficha del cliente y aplicá los cambios si correspondiera.',
        'Sistema CRM Seguros',
        ARRAY['nombre_admin', 'nombre_asegurado', 'dni', 'telefono_actual', 'email_actual', 'direccion_actual', 'cambios_sugeridos', 'mensaje_extra']::text[],
        true,
        true,
        true
      );
  END IF;
END $$;
