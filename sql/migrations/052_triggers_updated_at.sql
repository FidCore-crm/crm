-- ============================================================
-- 052 — Triggers automáticos para columna updated_at
-- ============================================================
-- Hoy 6 tablas ya tienen trigger (catalogos, facturacion, personas, polizas,
-- riesgos, siniestros). Las otras 17 tablas con columna `updated_at` se
-- mantienen actualizándose manualmente desde el código (cada API route /
-- lib hace `updated_at: new Date().toISOString()` en sus payloads). Eso es:
--   - propenso a olvidos (un UPDATE que omite el campo deja la fecha vieja)
--   - código repetido en docenas de archivos
--   - no protege updates desde otros caminos (Supabase Studio, scripts,
--     funciones de DB, etc.)
--
-- Esta migración suma el trigger BEFORE UPDATE a las 17 tablas faltantes,
-- usando la función existente `fn_actualizar_updated_at()` (declarada en
-- migraciones previas).
--
-- Es idempotente: si el trigger ya existe, se skipea con NOTICE.
-- ============================================================

DO $$
DECLARE
  tabla TEXT;
  nombre_trigger TEXT;
  tablas TEXT[] := ARRAY[
    'configuracion',
    'configuracion_backups',
    'configuracion_comunicaciones',
    'configuracion_correos',
    'configuracion_formulario_publico',
    'configuracion_notificaciones',
    'configuracion_portal_cliente',
    'cotizaciones',
    'leads',
    'oportunidades',
    'pdf_procesamientos',
    'plantillas_email',
    'postits',
    'siniestros_contador',
    'solicitudes_blanqueo_password',
    'telefonos_asistencia_companias',
    'usuarios'
  ];
BEGIN
  FOREACH tabla IN ARRAY tablas LOOP
    nombre_trigger := 'tg_' || tabla || '_updated_at';

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.triggers
      WHERE event_object_schema = 'public'
        AND event_object_table = tabla
        AND triggers.trigger_name = nombre_trigger
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at()',
        nombre_trigger,
        tabla
      );
      RAISE NOTICE 'Trigger % creado', nombre_trigger;
    ELSE
      RAISE NOTICE 'Trigger % ya existía, skip', nombre_trigger;
    END IF;
  END LOOP;
END $$;
