-- Migración 016: Tipo de evento SISTEMA_ERROR_CRITICO
-- Cierra la deuda de Fase 1 del sistema unificado de errores: agrega un tipo_envio
-- dedicado para errores críticos persistidos en errores_sistema, en vez de reusar
-- SISTEMA_EMAIL_AUTOMATICO_FALLIDO como workaround.

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
    -- Nuevo en 016
    'SISTEMA_ERROR_CRITICO'
  ));

-- ============================================================================
-- 2. Plantilla sistema_error_critico
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM plantillas_email WHERE codigo = 'sistema_error_critico') THEN
    INSERT INTO plantillas_email
      (codigo, nombre, descripcion, contexto,
       asunto, saludo, cuerpo, cierre,
       asunto_default, saludo_default, cuerpo_default, cierre_default,
       variables_disponibles, activa, es_sistema, editable)
    VALUES
      (
        'sistema_error_critico',
        'Error crítico del sistema',
        'Notificación al admin cuando ocurre un error crítico persistido en errores_sistema.',
        'GENERAL',
        '⚠ Error crítico: {{codigo}}',
        'Hola {{nombre_admin}}!',
        'Se registró un error crítico en el CRM.

Detalles:
- Código: {{codigo}}
- Módulo: {{modulo}}
- Endpoint: {{endpoint}}
- Mensaje: {{mensaje}}
- Fecha: {{fecha}}

Revisá el panel de errores del sistema (Configuración → Errores del sistema) para más detalles.',
        'Sistema CRM Seguros',
        '⚠ Error crítico: {{codigo}}',
        'Hola {{nombre_admin}}!',
        'Se registró un error crítico en el CRM.

Detalles:
- Código: {{codigo}}
- Módulo: {{modulo}}
- Endpoint: {{endpoint}}
- Mensaje: {{mensaje}}
- Fecha: {{fecha}}

Revisá el panel de errores del sistema (Configuración → Errores del sistema) para más detalles.',
        'Sistema CRM Seguros',
        ARRAY['nombre_admin', 'codigo', 'modulo', 'endpoint', 'mensaje', 'fecha']::text[],
        true,
        true,
        true
      );
  END IF;
END $$;
