-- ============================================================================
-- Migración 000: Schema base
--
-- Snapshot del schema `public` capturado el 2026-05-06 con pg_dump 15.8.
-- Crea todas las tablas, vistas, funciones, indexes y constraints que las
-- migraciones 001-044 (incrementales) asumen como punto de partida.
--
-- En instalaciones nuevas (DB virgen): se ejecuta primero, después corren
-- las 001-044 en orden.
-- En instalaciones existentes: el script aplicar-migraciones.sh detecta que
-- ya existe la tabla `personas` y marca esta migración como aplicada en
-- modo baseline (sin re-ejecutar).
--
-- IMPORTANTE: si se modifica el schema (alguna nueva tabla agregada por una
-- migración posterior), no hace falta regenerar este archivo — los cambios
-- viven en sus migraciones incrementales propias. Esto es solo un baseline.
-- ============================================================================

--
-- PostgreSQL database dump
--

-- Dumped from database version 15.8
-- Dumped by pg_dump version 15.8

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Extensions requeridas por el schema. En Supabase self-hosted las extensiones
-- viven en distintos schemas:
--   - extensions schema:  uuid-ossp, pgcrypto (provistos por la imagen Supabase)
--   - public schema:      pg_trgm, unaccent, btree_gin (los crea esta migración)
--
-- Si la DB no tiene "extensions" / uuid-ossp configurados (porque no está
-- corriendo bajo Supabase), también los creamos como fallback en public.
--

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;
CREATE EXTENSION IF NOT EXISTS unaccent SCHEMA public;
CREATE EXTENSION IF NOT EXISTS btree_gin SCHEMA public;



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: actualizar_estados_polizas(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.actualizar_estados_polizas() RETURNS void
    LANGUAGE plpgsql
    AS $$
  BEGIN
    -- Pólizas PROGRAMADA que arrancan hoy → VIGENTE
    UPDATE polizas SET estado = 'VIGENTE'
    WHERE estado = 'PROGRAMADA' AND fecha_inicio <= CURRENT_DATE;

    -- Pólizas RENOVADA que arrancan hoy:
    -- Primero, su póliza origen → NO_VIGENTE
    UPDATE polizas SET estado = 'NO_VIGENTE'
    WHERE id IN (
      SELECT poliza_origen_id FROM polizas
      WHERE estado = 'RENOVADA' AND fecha_inicio <= CURRENT_DATE
      AND poliza_origen_id IS NOT NULL
    );

    -- Luego, la renovación → VIGENTE
    UPDATE polizas SET estado = 'VIGENTE'
    WHERE estado = 'RENOVADA' AND fecha_inicio <= CURRENT_DATE;

    -- Pólizas VIGENTE cuya fecha_fin pasó y no tienen renovación activa → NO_VIGENTE
    UPDATE polizas SET estado = 'NO_VIGENTE'
    WHERE estado = 'VIGENTE'
      AND fecha_fin < CURRENT_DATE
      AND id NOT IN (
        SELECT poliza_origen_id FROM polizas
        WHERE poliza_origen_id IS NOT NULL
          AND estado IN ('RENOVADA', 'VIGENTE')
      );
  END;
  $$;


--
-- Name: fn_actualizar_movimiento_siniestro(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_actualizar_movimiento_siniestro() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.fecha_ultimo_movimiento = NOW();
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: fn_actualizar_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_actualizar_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION fn_actualizar_updated_at(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_actualizar_updated_at() IS 'Función universal para triggers de updated_at. Aplicar a todas las tablas con ese campo.';


--
-- Name: fn_sincronizar_estado_persona(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_sincronizar_estado_persona() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_tiene_poliza_activa BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM polizas
        WHERE asegurado_id = COALESCE(NEW.asegurado_id, OLD.asegurado_id)
          AND estado IN ('VIGENTE', 'PROGRAMADA')
    ) INTO v_tiene_poliza_activa;

    UPDATE personas
    SET estado = CASE
                    WHEN v_tiene_poliza_activa THEN 'ACTIVO'
                    ELSE 'INACTIVO'
                 END,
        updated_at = NOW()
    WHERE id = COALESCE(NEW.asegurado_id, OLD.asegurado_id)
      AND estado NOT IN ('BLOQUEADO');

    RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: FUNCTION fn_sincronizar_estado_persona(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_sincronizar_estado_persona() IS 'Mantiene el estado de la persona sincronizado con su cartera. ACTIVO si tiene pólizas vigentes, INACTIVO si no tiene ninguna. Respeta el estado BLOQUEADO.';


--
-- Name: generar_numero_caso(character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generar_numero_caso(prefijo character varying) RETURNS character varying
    LANGUAGE plpgsql
    AS $$
  DECLARE
    anio_actual INTEGER;
    proximo_numero INTEGER;
    numero_formateado VARCHAR;
  BEGIN
    anio_actual := EXTRACT(YEAR FROM NOW())::INTEGER;

    INSERT INTO siniestros_contador (anio, ultimo_numero, updated_at)
    VALUES (anio_actual, 1, NOW())
    ON CONFLICT (anio) DO UPDATE
      SET ultimo_numero = siniestros_contador.ultimo_numero + 1,
          updated_at = NOW()
    RETURNING ultimo_numero INTO proximo_numero;

    numero_formateado := prefijo || '-' || anio_actual::VARCHAR || '-' || LPAD(proximo_numero::VARCHAR, 4, '0');

    RETURN numero_formateado;
  END;
  $$;


--
-- Name: generar_numero_cotizacion(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generar_numero_cotizacion() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
  BEGIN
    IF NEW.numero_cotizacion IS NULL OR NEW.numero_cotizacion = '' THEN
      NEW.numero_cotizacion := 'COT-' || LPAD(nextval('cotizaciones_numero_seq')::TEXT, 4, '0');
    END IF;
    RETURN NEW;
  END;
  $$;


--
-- Name: generar_numero_endoso(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generar_numero_endoso(p_poliza_id uuid) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_max INTEGER;
BEGIN
  -- Lock pesimista en la fila de la póliza para serializar generadores
  -- concurrentes que apunten a la misma póliza. No bloquea otras pólizas.
  PERFORM 1 FROM polizas WHERE id = p_poliza_id FOR UPDATE;

  SELECT COALESCE(MAX(numero_endoso), 0)
    INTO v_max
    FROM endosos
   WHERE poliza_id = p_poliza_id;

  RETURN v_max + 1;
END;
$$;


--
-- Name: trg_pdf_procesamientos_touch(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_pdf_procesamientos_touch() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: anthropic_modelos_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.anthropic_modelos_cache (
    id character varying(100) NOT NULL,
    display_name character varying(200),
    familia character varying(20),
    created_at timestamp with time zone,
    deprecated_at timestamp with time zone,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE anthropic_modelos_cache; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.anthropic_modelos_cache IS 'Cache local de GET https://api.anthropic.com/v1/models. Refrescado por cron semanal (/api/cron/sincronizar-modelos-anthropic) y on-demand cuando una llamada falla con MODEL_DISCONTINUED.';


--
-- Name: backups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.backups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre character varying NOT NULL,
    tipo character varying DEFAULT 'AUTOMATICO'::character varying NOT NULL,
    fecha_inicio timestamp with time zone NOT NULL,
    fecha_fin timestamp with time zone,
    duracion_segundos integer,
    tamano_db_bytes bigint,
    tamano_storage_bytes bigint,
    tamano_total_bytes bigint,
    estado character varying DEFAULT 'EN_PROCESO'::character varying NOT NULL,
    error_mensaje text,
    sync_remoto_intentado boolean DEFAULT false,
    sync_remoto_exitoso boolean,
    sync_remoto_error text,
    ruta_local character varying,
    ruta_remota character varying,
    usuario_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    archivo_unico_path text,
    archivo_unico_tamano_bytes bigint,
    contenido_incluido jsonb DEFAULT '{"storage": true, "database": true}'::jsonb,
    CONSTRAINT backups_estado_check CHECK (((estado)::text = ANY ((ARRAY['EN_PROCESO'::character varying, 'COMPLETADO'::character varying, 'FALLIDO'::character varying, 'COMPLETADO_CON_ERRORES'::character varying])::text[]))),
    CONSTRAINT backups_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['AUTOMATICO'::character varying, 'MANUAL'::character varying, 'PRE_RESTORE'::character varying])::text[])))
);


--
-- Name: catalogos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalogos (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    tipo_id smallint NOT NULL,
    codigo character varying(50) NOT NULL,
    nombre character varying(200) NOT NULL,
    descripcion text,
    parent_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    orden smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE catalogos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.catalogos IS 'Tabla maestra polimórfica unificada. Evita la proliferación de tablas de catálogo independientes. La columna metadata JSONB permite atributos específicos por tipo (logo de compañía, cuotas de medio de pago, etc.).';


--
-- Name: COLUMN catalogos.parent_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.catalogos.parent_id IS 'Relación jerárquica. Ej: una Cobertura (hijo) pertenece a un Ramo (padre).';


--
-- Name: COLUMN catalogos.metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.catalogos.metadata IS 'Atributos variables por tipo. Para COMPANIA: {logo_url, cuit, web}. Para MEDIO_PAGO: {cuotas_max, recargo_pct}.';


--
-- Name: configuracion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.configuracion (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tipo_operacion text DEFAULT 'INDEPENDIENTE'::text NOT NULL,
    nombre text,
    razon_social text,
    cuit text,
    matricula_ssn text,
    logo_path text,
    telefono text,
    whatsapp text,
    email text,
    direccion text,
    sitio_web text,
    instagram text,
    facebook text,
    socios jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    notificaciones_activas boolean DEFAULT true,
    prefijo_casos character varying DEFAULT 'CASO'::character varying,
    anthropic_api_key_encrypted text,
    anthropic_model character varying DEFAULT 'claude-sonnet-4-20250514'::character varying,
    anthropic_ultimo_test timestamp with time zone,
    anthropic_ultimo_test_exitoso boolean,
    anthropic_tokens_usados_mes bigint DEFAULT 0,
    anthropic_llamadas_mes integer DEFAULT 0,
    anthropic_reset_mes date,
    anthropic_uso_total_tokens bigint DEFAULT 0,
    anthropic_uso_total_costo numeric(10,4) DEFAULT 0,
    modulo_ia_pdf_polizas_activo boolean DEFAULT false,
    anthropic_familia character varying(20),
    url_crm character varying,
    url_portal_cliente character varying,
    url_formulario_publico character varying,
    cotizacion_whatsapp_template text,
    cotizacion_email_asunto_template text,
    cotizacion_email_cuerpo_template text,
    color_marca character varying(7) DEFAULT '#0A1628'::character varying NOT NULL,
    CONSTRAINT configuracion_anthropic_familia_check CHECK (((anthropic_familia IS NULL) OR ((anthropic_familia)::text = ANY ((ARRAY['sonnet'::character varying, 'opus'::character varying, 'haiku'::character varying])::text[])))),
    CONSTRAINT configuracion_color_marca_format CHECK (((color_marca)::text ~ '^#[0-9a-fA-F]{6}$'::text))
);


--
-- Name: COLUMN configuracion.anthropic_familia; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.configuracion.anthropic_familia IS 'Familia de modelo que prefiere el admin (sonnet/opus/haiku). El ID concreto se resuelve en tiempo de llamada al modelo más nuevo disponible en esa familia.';


--
-- Name: COLUMN configuracion.url_crm; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.configuracion.url_crm IS 'URL pública del CRM (admin/login). Editable desde Configuración → Perfil.';


--
-- Name: COLUMN configuracion.url_portal_cliente; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.configuracion.url_portal_cliente IS 'URL pública del portal del cliente. Editable desde Configuración → Portal del Cliente.';


--
-- Name: COLUMN configuracion.url_formulario_publico; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.configuracion.url_formulario_publico IS 'URL pública del formulario de denuncia. Editable desde Configuración → Formulario público.';


--
-- Name: COLUMN configuracion.color_marca; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.configuracion.color_marca IS 'Color hex (#RRGGBB) de marca del PAS. Aplica solo a superficies cara al asegurado: PDFs cotización, emails, portal cliente, formulario denuncia. Elegible desde una paleta predefinida en /crm/configuracion/perfil.';


--
-- Name: configuracion_backups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.configuracion_backups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    activo boolean DEFAULT false,
    retener_diarios integer DEFAULT 7,
    retener_semanales integer DEFAULT 4,
    retener_mensuales integer DEFAULT 6,
    sync_remoto_activo boolean DEFAULT false,
    remote_nombre character varying DEFAULT 'gdrive'::character varying,
    carpeta_remota character varying DEFAULT 'Backups-CRM'::character varying,
    hora_backup time without time zone DEFAULT '04:00:00'::time without time zone,
    notificar_exito boolean DEFAULT false,
    notificar_fallos boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: configuracion_comunicaciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.configuracion_comunicaciones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    activo boolean DEFAULT false,
    envio_automatico_renovaciones boolean DEFAULT false,
    adjuntar_docs_renovacion boolean DEFAULT true,
    limite_diario integer DEFAULT 500,
    delay_entre_envios_ms integer DEFAULT 2000,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    notificar_admin_eventos_informativos boolean DEFAULT false NOT NULL,
    envio_automatico_bienvenida_poliza boolean DEFAULT true NOT NULL,
    envio_automatico_portal_cliente boolean DEFAULT true NOT NULL,
    delay_entre_envios_automaticos_seg integer DEFAULT 10 NOT NULL,
    max_adjuntos_mb integer DEFAULT 20 NOT NULL,
    retener_completo_dias integer DEFAULT 90 NOT NULL,
    retener_metadata_meses integer DEFAULT 6 NOT NULL,
    eliminar_despues_meses integer DEFAULT 12 NOT NULL,
    errores_retener_completo_dias integer DEFAULT 30 NOT NULL,
    errores_retener_metadata_dias integer DEFAULT 90 NOT NULL,
    errores_ventana_agregacion_minutos integer DEFAULT 60 NOT NULL
);


--
-- Name: configuracion_correos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.configuracion_correos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    smtp_host character varying,
    smtp_port integer DEFAULT 587,
    smtp_secure boolean DEFAULT false,
    smtp_user character varying,
    smtp_password_encrypted text,
    from_name character varying,
    from_email character varying,
    reply_to character varying,
    firma_html text,
    configurado boolean DEFAULT false,
    ultimo_test timestamp with time zone,
    ultimo_test_exitoso boolean,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: configuracion_formulario_publico; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.configuracion_formulario_publico (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    activo boolean DEFAULT true,
    titulo_hero character varying DEFAULT 'Denunciar Siniestro'::character varying,
    subtitulo_hero text DEFAULT 'Completá los datos de tu siniestro de forma rápida y segura. Te llegará una constancia por email.'::text,
    mensaje_validacion_fallida text DEFAULT 'Los datos ingresados no coinciden con nuestro sistema. Verificá tu DNI, email y número de póliza, o contactá a tu productor.'::text,
    mensaje_fuera_servicio text DEFAULT 'El formulario de denuncias está temporalmente fuera de servicio. Por favor contactá directamente a tu productor asesor.'::text,
    terminos_activos boolean DEFAULT false,
    terminos_titulo character varying DEFAULT 'Términos y Condiciones'::character varying,
    terminos_contenido text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: configuracion_notificaciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.configuracion_notificaciones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tipo character varying NOT NULL,
    activa boolean DEFAULT true,
    umbral_dias integer,
    antispam_dias integer DEFAULT 3 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT configuracion_notificaciones_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['POLIZA_VENCIDA'::character varying, 'TAREA_VENCIDA'::character varying, 'SINIESTRO_30_DIAS'::character varying, 'SINIESTRO_60_DIAS'::character varying, 'COTIZACION_SIN_RESPUESTA'::character varying, 'COTIZACION_SIN_SEGUIMIENTO'::character varying, 'OPORTUNIDAD_ESTANCADA'::character varying, 'COTIZACION_VENCIENDO_PRONTO'::character varying, 'COTIZACION_VENCIDA'::character varying, 'IMPORTACION_INICIADA'::character varying, 'IMPORTACION_ANALIZADA'::character varying, 'IMPORTACION_LISTA_REVISION'::character varying, 'IMPORTACION_COMPLETADA'::character varying, 'IMPORTACION_FALLIDA'::character varying, 'IMPORTACION_PAUSADA'::character varying, 'IMPORTACION_DESHECHA'::character varying, 'PDF_LISTO_PARA_REVISAR'::character varying, 'PDF_FALLIDO'::character varying, 'POLIZA_REHABILITADA'::character varying, 'BACKUP_FALLIDO'::character varying, 'BACKUP_SYNC_FALLIDO'::character varying, 'RESTAURACION_INICIADA'::character varying, 'RESTAURACION_COMPLETADA'::character varying, 'RESTAURACION_FALLIDA'::character varying, 'EMAIL_AUTOMATICO_FALLIDO'::character varying, 'SINIESTRO_DENUNCIA_PUBLICA'::character varying])::text[])))
);


--
-- Name: configuracion_portal_cliente; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.configuracion_portal_cliente (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    activo boolean DEFAULT false,
    texto_bienvenida text DEFAULT 'Bienvenido a tu portal personal'::text,
    mensaje_acceso_revocado text DEFAULT 'Este enlace ya no está disponible. Contactá a tu productor para obtener un nuevo acceso.'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: cotizacion_companias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cotizacion_companias (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cotizacion_id uuid NOT NULL,
    compania_id uuid NOT NULL,
    cobertura_id uuid,
    precio numeric(12,2) NOT NULL,
    detalle text,
    seleccionada boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT cotizacion_companias_precio_check CHECK ((precio >= (0)::numeric))
);


--
-- Name: cotizaciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cotizaciones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    numero_cotizacion character varying NOT NULL,
    persona_id uuid,
    lead_id uuid,
    oportunidad_id uuid,
    ramo_id uuid,
    datos_riesgo jsonb DEFAULT '{}'::jsonb,
    estado character varying DEFAULT 'BORRADOR'::character varying NOT NULL,
    motivo_perdida character varying,
    compania_ganadora_id uuid,
    fecha_envio date,
    fecha_cierre date,
    notas text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    usuario_id uuid,
    poliza_generada_id uuid,
    fecha_vencimiento date,
    CONSTRAINT cotizaciones_estado_check CHECK (((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'ENVIADA'::character varying, 'EN_PROCESO'::character varying, 'GANADA'::character varying, 'PERDIDA'::character varying])::text[]))),
    CONSTRAINT cotizaciones_origen_check CHECK ((((persona_id IS NOT NULL) AND (lead_id IS NULL)) OR ((lead_id IS NOT NULL) AND (persona_id IS NULL)) OR ((persona_id IS NULL) AND (lead_id IS NULL))))
);


--
-- Name: cotizaciones_numero_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cotizaciones_numero_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_bajas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_bajas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying NOT NULL,
    fecha_baja timestamp with time zone DEFAULT now(),
    origen character varying DEFAULT 'unsubscribe_link'::character varying,
    motivo text,
    persona_id uuid
);


--
-- Name: email_clicks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_clicks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    envio_id uuid NOT NULL,
    url_destino text NOT NULL,
    fecha_click timestamp with time zone DEFAULT now(),
    ip_origen character varying
);


--
-- Name: email_envios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_envios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token_tracking character varying,
    plantilla_codigo character varying NOT NULL,
    destinatario_email character varying NOT NULL,
    destinatario_nombre character varying,
    persona_id uuid,
    poliza_id uuid,
    asunto character varying NOT NULL,
    cuerpo_html text,
    variables_usadas jsonb,
    archivos_adjuntos jsonb,
    tipo_envio character varying DEFAULT 'MANUAL'::character varying NOT NULL,
    estado character varying DEFAULT 'PENDIENTE'::character varying NOT NULL,
    error_mensaje text,
    intentos integer DEFAULT 0,
    enviado_por_usuario_id uuid,
    fecha_creacion timestamp with time zone DEFAULT now(),
    fecha_envio timestamp with time zone,
    fecha_apertura timestamp with time zone,
    cantidad_aperturas integer DEFAULT 0,
    fecha_primer_click timestamp with time zone,
    cantidad_clicks integer DEFAULT 0,
    prioridad character varying DEFAULT 'NORMAL'::character varying NOT NULL,
    enviar_despues_de timestamp with time zone DEFAULT now(),
    archivado boolean DEFAULT false NOT NULL,
    CONSTRAINT email_envios_estado_check CHECK (((estado)::text = ANY ((ARRAY['PENDIENTE'::character varying, 'ENCOLADO'::character varying, 'ENVIANDO'::character varying, 'ENVIADO'::character varying, 'FALLIDO'::character varying, 'EXCLUIDO_BAJA'::character varying, 'EXCLUIDO_NO_MARKETING'::character varying])::text[]))),
    CONSTRAINT email_envios_prioridad_check CHECK (((prioridad)::text = ANY ((ARRAY['ALTA'::character varying, 'NORMAL'::character varying])::text[]))),
    CONSTRAINT email_envios_tipo_envio_check CHECK (((tipo_envio)::text = ANY ((ARRAY['AUTOMATICO_BIENVENIDA'::character varying, 'AUTOMATICO_RENOVACION'::character varying, 'AUTOMATICO_PORTAL_CLIENTE'::character varying, 'MANUAL'::character varying, 'MASIVO'::character varying, 'NOTIFICACION_INTERNA'::character varying, 'SISTEMA_BACKUP_COMPLETADO'::character varying, 'SISTEMA_BACKUP_FALLIDO'::character varying, 'SISTEMA_BACKUP_SYNC_FALLIDO'::character varying, 'SISTEMA_RESTAURACION_INICIADA'::character varying, 'SISTEMA_RESTAURACION_COMPLETADA'::character varying, 'SISTEMA_RESTAURACION_FALLIDA'::character varying, 'SISTEMA_PDF_PROCESADO'::character varying, 'SISTEMA_PDF_FALLIDO'::character varying, 'SISTEMA_EMAIL_AUTOMATICO_FALLIDO'::character varying, 'SISTEMA_ERROR_CRITICO'::character varying, 'SISTEMA_SUGERENCIA_CORRECCION_PORTAL'::character varying])::text[])))
);


--
-- Name: endosos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.endosos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    poliza_id uuid NOT NULL,
    numero_endoso integer DEFAULT 1 NOT NULL,
    fecha date DEFAULT CURRENT_DATE NOT NULL,
    motivo text NOT NULL,
    observaciones text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: errores_sistema; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.errores_sistema (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    codigo character varying NOT NULL,
    mensaje text NOT NULL,
    modulo character varying,
    endpoint character varying,
    metodo character varying,
    stack_trace text,
    request_body jsonb,
    request_headers jsonb,
    contexto_extra jsonb,
    usuario_id uuid,
    correlation_id character varying,
    contador integer DEFAULT 1 NOT NULL,
    primera_aparicion timestamp with time zone DEFAULT now() NOT NULL,
    ultima_aparicion timestamp with time zone DEFAULT now() NOT NULL,
    archivado boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: facturacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facturacion (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    anio smallint NOT NULL,
    mes smallint NOT NULL,
    periodo date GENERATED ALWAYS AS (make_date((anio)::integer, (mes)::integer, 1)) STORED,
    compania_id uuid NOT NULL,
    ramo_id uuid,
    cantidad_polizas integer DEFAULT 0,
    polizas_nuevas integer DEFAULT 0,
    polizas_renovadas integer DEFAULT 0,
    polizas_canceladas integer DEFAULT 0,
    premio_total numeric(18,2) DEFAULT 0,
    comision_bruta numeric(18,2) DEFAULT 0,
    retenciones numeric(18,2) DEFAULT 0,
    comision_neta numeric(18,2) GENERATED ALWAYS AS ((comision_bruta - retenciones)) STORED,
    estado_liquidacion character varying(20) DEFAULT 'ESTIMADO'::character varying NOT NULL,
    fecha_liquidacion date,
    fecha_cobro date,
    numero_liquidacion character varying(50),
    url_liquidacion_pdf text,
    notas text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    monto numeric(18,2) DEFAULT 0 NOT NULL,
    CONSTRAINT facturacion_anio_check CHECK (((anio >= 2000) AND (anio <= 2100))),
    CONSTRAINT facturacion_estado_liquidacion_check CHECK (((estado_liquidacion)::text = ANY ((ARRAY['ESTIMADO'::character varying, 'LIQUIDADO'::character varying, 'COBRADO'::character varying, 'AUDITADO'::character varying])::text[]))),
    CONSTRAINT facturacion_mes_check CHECK (((mes >= 1) AND (mes <= 12))),
    CONSTRAINT facturacion_monto_check CHECK ((monto >= (0)::numeric))
);


--
-- Name: TABLE facturacion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.facturacion IS 'Dashboard financiero del PAS. Registro mensual de producción por compañía y ramo. Incluye comisiones brutas, retenciones y comisión neta calculada. El estado de liquidación rastrea el ciclo de cobro.';


--
-- Name: importacion_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.importacion_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    importacion_id uuid NOT NULL,
    tipo character varying NOT NULL,
    estado character varying DEFAULT 'PENDIENTE'::character varying,
    prioridad integer DEFAULT 5,
    intentos integer DEFAULT 0,
    max_intentos integer DEFAULT 3,
    payload jsonb,
    resultado jsonb,
    error text,
    fecha_creacion timestamp with time zone DEFAULT now(),
    fecha_inicio timestamp with time zone,
    fecha_fin timestamp with time zone,
    worker_id character varying,
    CONSTRAINT importacion_jobs_estado_check CHECK (((estado)::text = ANY ((ARRAY['PENDIENTE'::character varying, 'EJECUTANDO'::character varying, 'COMPLETADO'::character varying, 'FALLIDO'::character varying, 'REINTENTANDO'::character varying, 'CANCELADO'::character varying])::text[])))
);


--
-- Name: importacion_lotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.importacion_lotes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    importacion_id uuid NOT NULL,
    numero_lote integer NOT NULL,
    estado character varying DEFAULT 'PENDIENTE'::character varying,
    registros_total integer NOT NULL,
    registros_procesados integer DEFAULT 0,
    registros_listos integer DEFAULT 0,
    registros_dudosos integer DEFAULT 0,
    registros_originales jsonb,
    registros_procesados_data jsonb,
    intentos integer DEFAULT 0,
    fecha_inicio timestamp with time zone,
    fecha_fin timestamp with time zone
);


--
-- Name: importacion_registros_dudosos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.importacion_registros_dudosos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    importacion_id uuid NOT NULL,
    lote_id uuid,
    tipo_entidad character varying NOT NULL,
    tipo_problema character varying NOT NULL,
    descripcion_problema text,
    datos_originales jsonb,
    datos_propuestos jsonb,
    sugerencia_ia text,
    numero_fila_archivo integer,
    archivo_origen character varying,
    estado_resolucion character varying DEFAULT 'PENDIENTE'::character varying,
    resolucion_datos jsonb,
    resolucion_accion character varying,
    fecha_resolucion timestamp with time zone,
    resuelto_por_usuario_id uuid
);


--
-- Name: importaciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.importaciones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    usuario_id uuid NOT NULL,
    compania_id uuid,
    nombre_archivo character varying NOT NULL,
    total_filas integer DEFAULT 0 NOT NULL,
    clientes_creados integer DEFAULT 0 NOT NULL,
    clientes_existentes integer DEFAULT 0 NOT NULL,
    polizas_creadas integer DEFAULT 0 NOT NULL,
    errores integer DEFAULT 0 NOT NULL,
    detalle_errores jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    tipo character varying DEFAULT 'INICIAL'::character varying,
    estado_proceso character varying DEFAULT 'PENDIENTE'::character varying,
    plan_importacion jsonb,
    estadisticas jsonb,
    archivos_metadata jsonb,
    ids_creados jsonb,
    ids_actualizados jsonb,
    fecha_inicio timestamp with time zone,
    fecha_fin timestamp with time zone,
    notas text,
    deshecha boolean DEFAULT false,
    fecha_deshecha timestamp with time zone
);


--
-- Name: interacciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.interacciones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_id uuid,
    oportunidad_id uuid,
    tipo character varying NOT NULL,
    descripcion text NOT NULL,
    fecha timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    persona_id uuid,
    CONSTRAINT interacciones_origen_check CHECK ((((lead_id IS NOT NULL) AND (oportunidad_id IS NULL) AND (persona_id IS NULL)) OR ((oportunidad_id IS NOT NULL) AND (lead_id IS NULL) AND (persona_id IS NULL)) OR ((persona_id IS NOT NULL) AND (lead_id IS NULL) AND (oportunidad_id IS NULL)))),
    CONSTRAINT interacciones_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['LLAMADA'::character varying, 'EMAIL'::character varying, 'WHATSAPP'::character varying, 'REUNION'::character varying, 'NOTA'::character varying])::text[])))
);


--
-- Name: leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre character varying NOT NULL,
    apellido character varying NOT NULL,
    dni character varying,
    telefono character varying,
    email character varying,
    empresa character varying,
    cargo character varying,
    fuente character varying DEFAULT 'OTRO'::character varying NOT NULL,
    canal character varying,
    nivel_interes character varying DEFAULT 'MEDIO'::character varying NOT NULL,
    productos_interes text,
    estado character varying DEFAULT 'NUEVO'::character varying NOT NULL,
    motivo_descarte character varying,
    notas text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    usuario_id uuid,
    persona_id uuid,
    fecha_conversion timestamp with time zone,
    CONSTRAINT leads_canal_check CHECK (((canal IS NULL) OR ((canal)::text = ANY ((ARRAY['WHATSAPP'::character varying, 'TELEFONO'::character varying, 'EMAIL'::character varying, 'PRESENCIAL'::character varying])::text[])))),
    CONSTRAINT leads_estado_check CHECK (((estado)::text = ANY ((ARRAY['NUEVO'::character varying, 'CONTACTADO'::character varying, 'CONVERTIDO'::character varying, 'DESCARTADO'::character varying])::text[]))),
    CONSTRAINT leads_fuente_check CHECK (((fuente)::text = ANY ((ARRAY['REFERIDO'::character varying, 'WEB'::character varying, 'REDES_SOCIALES'::character varying, 'LLAMADA_ENTRANTE'::character varying, 'EVENTO'::character varying, 'OTRO'::character varying])::text[]))),
    CONSTRAINT leads_nivel_interes_check CHECK (((nivel_interes)::text = ANY ((ARRAY['ALTO'::character varying, 'MEDIO'::character varying, 'BAJO'::character varying])::text[])))
);


--
-- Name: migraciones_aplicadas; Type: TABLE; Schema: public; Owner: -
-- (excluida del schema base — la crea aplicar-migraciones.sh con IF NOT EXISTS
-- antes de aplicar nada para evitar el chicken-and-egg)
--


--
-- Name: notificaciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notificaciones (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    usuario_id uuid,
    tipo character varying(50) NOT NULL,
    titulo character varying(300) NOT NULL,
    mensaje text NOT NULL,
    prioridad character varying(20) DEFAULT 'ADVERTENCIA'::character varying NOT NULL,
    entidad_tipo character varying(30),
    entidad_id uuid,
    url text,
    leida boolean DEFAULT false NOT NULL,
    fecha_lectura timestamp with time zone,
    descartada boolean DEFAULT false NOT NULL,
    generada_por character varying(20) DEFAULT 'SISTEMA'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notificaciones_generada_por_check CHECK (((generada_por)::text = ANY ((ARRAY['SISTEMA'::character varying, 'USUARIO'::character varying])::text[]))),
    CONSTRAINT notificaciones_prioridad_check CHECK (((prioridad)::text = ANY (ARRAY[('CRITICA'::character varying)::text, ('ADVERTENCIA'::character varying)::text, ('INFORMATIVA'::character varying)::text]))),
    CONSTRAINT notificaciones_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['POLIZA_VENCIDA'::character varying, 'TAREA_VENCIDA'::character varying, 'SINIESTRO_30_DIAS'::character varying, 'SINIESTRO_60_DIAS'::character varying, 'COTIZACION_SIN_RESPUESTA'::character varying, 'COTIZACION_SIN_SEGUIMIENTO'::character varying, 'OPORTUNIDAD_ESTANCADA'::character varying, 'COTIZACION_VENCIENDO_PRONTO'::character varying, 'COTIZACION_VENCIDA'::character varying, 'IMPORTACION_INICIADA'::character varying, 'IMPORTACION_ANALIZADA'::character varying, 'IMPORTACION_LISTA_REVISION'::character varying, 'IMPORTACION_COMPLETADA'::character varying, 'IMPORTACION_FALLIDA'::character varying, 'IMPORTACION_PAUSADA'::character varying, 'IMPORTACION_DESHECHA'::character varying, 'PDF_LISTO_PARA_REVISAR'::character varying, 'PDF_FALLIDO'::character varying, 'POLIZA_REHABILITADA'::character varying, 'BACKUP_FALLIDO'::character varying, 'BACKUP_SYNC_FALLIDO'::character varying, 'RESTAURACION_INICIADA'::character varying, 'RESTAURACION_COMPLETADA'::character varying, 'RESTAURACION_FALLIDA'::character varying, 'EMAIL_AUTOMATICO_FALLIDO'::character varying, 'SINIESTRO_DENUNCIA_PUBLICA'::character varying])::text[])))
);


--
-- Name: TABLE notificaciones; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.notificaciones IS 'Centro de alertas del sistema. Almacena todas las notificaciones generadas por el motor de reglas (pólizas por vencer, siniestros estancados) y por los propios usuarios. Optimizado para el indicador de badge de no-leídas.';


--
-- Name: oportunidades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oportunidades (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    persona_id uuid NOT NULL,
    tipo character varying NOT NULL,
    fuente character varying DEFAULT 'MANUAL'::character varying NOT NULL,
    descripcion text,
    estado character varying DEFAULT 'DETECTADA'::character varying NOT NULL,
    motivo_perdida character varying,
    fecha_proximo_contacto date,
    notas text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    usuario_id uuid,
    monto_estimado numeric(15,2),
    probabilidad_cierre integer,
    fecha_estimada_cierre date,
    CONSTRAINT oportunidades_estado_check CHECK (((estado)::text = ANY ((ARRAY['DETECTADA'::character varying, 'CONTACTADO'::character varying, 'NEGOCIACION'::character varying, 'GANADA'::character varying, 'PERDIDA'::character varying])::text[]))),
    CONSTRAINT oportunidades_fuente_check CHECK (((fuente)::text = ANY ((ARRAY['AUTOMATICA'::character varying, 'MANUAL'::character varying])::text[]))),
    CONSTRAINT oportunidades_probabilidad_cierre_check CHECK (((probabilidad_cierre >= 0) AND (probabilidad_cierre <= 100))),
    CONSTRAINT oportunidades_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['CROSS_SELL'::character varying, 'RECUPERACION'::character varying, 'NUEVA_VENTA'::character varying])::text[])))
);


--
-- Name: pdf_procesamientos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pdf_procesamientos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tipo_operacion character varying NOT NULL,
    poliza_origen_id uuid,
    poliza_creada_id uuid,
    endoso_creado_id uuid,
    estado character varying DEFAULT 'PENDIENTE'::character varying NOT NULL,
    nombre_archivo character varying NOT NULL,
    tamano_archivo integer,
    ruta_temporal text,
    datos_extraidos jsonb,
    mapeos_catalogos jsonb,
    campos_dudosos jsonb,
    tokens_usados integer,
    costo_estimado numeric(10,4),
    error_mensaje text,
    usuario_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT pdf_procesamientos_estado_check CHECK (((estado)::text = ANY ((ARRAY['PENDIENTE'::character varying, 'PROCESANDO'::character varying, 'EXTRAIDO'::character varying, 'APROBADO'::character varying, 'CANCELADO'::character varying, 'FALLIDO'::character varying])::text[]))),
    CONSTRAINT pdf_procesamientos_tipo_operacion_check CHECK (((tipo_operacion)::text = ANY ((ARRAY['POLIZA_NUEVA'::character varying, 'RENOVACION'::character varying, 'ENDOSO'::character varying])::text[])))
);


--
-- Name: persona_bitacora; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.persona_bitacora (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    persona_id uuid NOT NULL,
    tipo_evento character varying NOT NULL,
    estado_anterior character varying,
    estado_nuevo character varying,
    campos_modificados jsonb,
    motivo text,
    observaciones text,
    usuario_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT persona_bitacora_tipo_evento_check CHECK (((tipo_evento)::text = ANY ((ARRAY['CREACION'::character varying, 'EDICION'::character varying, 'CAMBIO_ESTADO'::character varying, 'ELIMINACION'::character varying, 'RESTAURACION'::character varying, 'PURGA_DEFINITIVA'::character varying])::text[])))
);


--
-- Name: personas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.personas (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    tipo_persona character varying(10) DEFAULT 'FISICA'::character varying NOT NULL,
    dni_cuil character varying(20) NOT NULL,
    cuil_formateado character varying(13) GENERATED ALWAYS AS (
CASE
    WHEN (length(regexp_replace((dni_cuil)::text, '[^0-9]'::text, ''::text, 'g'::text)) = 11) THEN ((((("substring"(regexp_replace((dni_cuil)::text, '[^0-9]'::text, ''::text, 'g'::text), 1, 2) || '-'::text) || "substring"(regexp_replace((dni_cuil)::text, '[^0-9]'::text, ''::text, 'g'::text), 3, 8)) || '-'::text) || "substring"(regexp_replace((dni_cuil)::text, '[^0-9]'::text, ''::text, 'g'::text), 11, 1)))::character varying
    ELSE dni_cuil
END) STORED,
    apellido character varying(100) NOT NULL,
    nombre character varying(100),
    razon_social character varying(200),
    email character varying(254),
    email_secundario character varying(254),
    telefono character varying(30),
    telefono_secundario character varying(30),
    whatsapp character varying(30),
    calle character varying(200),
    numero character varying(10),
    piso_depto character varying(30),
    barrio character varying(100),
    localidad character varying(100),
    provincia character varying(100),
    codigo_postal character varying(10),
    pais character varying(50) DEFAULT 'Argentina'::character varying NOT NULL,
    estado character varying(20) DEFAULT 'PROSPECTO'::character varying NOT NULL,
    origen character varying(50),
    segmento character varying(50),
    fecha_alta date DEFAULT CURRENT_DATE NOT NULL,
    fecha_baja date,
    datos_extra jsonb DEFAULT '{}'::jsonb NOT NULL,
    acepta_marketing boolean DEFAULT true NOT NULL,
    canal_preferido character varying(20) DEFAULT 'EMAIL'::character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    usuario_id uuid,
    deleted_at timestamp with time zone,
    deleted_by_usuario_id uuid,
    CONSTRAINT personas_canal_preferido_check CHECK (((canal_preferido)::text = ANY ((ARRAY['EMAIL'::character varying, 'WHATSAPP'::character varying, 'TELEFONO'::character varying, 'CORREO'::character varying])::text[]))),
    CONSTRAINT personas_estado_check CHECK (((estado)::text = ANY ((ARRAY['PROSPECTO'::character varying, 'ACTIVO'::character varying, 'INACTIVO'::character varying, 'BLOQUEADO'::character varying])::text[]))),
    CONSTRAINT personas_tipo_persona_check CHECK (((tipo_persona)::text = ANY ((ARRAY['FISICA'::character varying, 'JURIDICA'::character varying])::text[])))
);


--
-- Name: TABLE personas; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.personas IS 'RLS habilitado. Política base: usuarios autenticados ven todos los registros. Para multi-tenant, agregar columna org_id y filtrar por auth.jwt()->>''org_id''.';


--
-- Name: COLUMN personas.estado; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.personas.estado IS 'PROSPECTO: Lead sin póliza. ACTIVO: Cliente con al menos una póliza vigente. INACTIVO: Sin pólizas activas. BLOQUEADO: Suspendido por deuda o fraude.';


--
-- Name: COLUMN personas.datos_extra; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.personas.datos_extra IS 'Atributos variables: {"fecha_nacimiento":"1985-03-15", "profesion":"Medico", "estado_civil":"Casado", "score_crediticio": 750}';


--
-- Name: plantillas_email; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plantillas_email (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    codigo character varying NOT NULL,
    nombre character varying NOT NULL,
    descripcion text,
    asunto_default character varying NOT NULL,
    contexto character varying NOT NULL,
    variables_disponibles text[],
    activa boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    asunto character varying,
    saludo text,
    cuerpo text,
    cierre text,
    saludo_default text,
    cuerpo_default text,
    cierre_default text,
    es_sistema boolean DEFAULT true NOT NULL,
    editable boolean DEFAULT true NOT NULL,
    CONSTRAINT plantillas_email_contexto_check CHECK (((contexto)::text = ANY ((ARRAY['PERSONA'::character varying, 'POLIZA'::character varying, 'PORTAL_CLIENTE'::character varying, 'GENERAL'::character varying, 'CLIENTE'::character varying, 'RENOVACION'::character varying])::text[])))
);


--
-- Name: poliza_archivos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.poliza_archivos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    poliza_id uuid NOT NULL,
    categoria character varying(20) NOT NULL,
    nombre text NOT NULL,
    ruta text NOT NULL,
    mime_type text,
    tamano integer,
    created_at timestamp with time zone DEFAULT now(),
    endoso_id uuid,
    CONSTRAINT poliza_archivos_categoria_check CHECK (((categoria)::text = ANY ((ARRAY['inspeccion'::character varying, 'documentacion'::character varying, 'documentacion_renovada'::character varying, 'endosos'::character varying])::text[])))
);


--
-- Name: poliza_bitacora; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.poliza_bitacora (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    poliza_id uuid NOT NULL,
    tipo_evento character varying NOT NULL,
    estado_anterior character varying,
    estado_nuevo character varying,
    motivo text,
    observaciones text,
    usuario_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT poliza_bitacora_tipo_evento_check CHECK (((tipo_evento)::text = ANY ((ARRAY['CREACION'::character varying, 'CAMBIO_ESTADO'::character varying, 'CANCELACION'::character varying, 'ANULACION'::character varying, 'REHABILITACION'::character varying, 'RENOVACION_CREADA'::character varying, 'RENOVACION_ACTIVADA'::character varying, 'EDICION'::character varying])::text[])))
);


--
-- Name: polizas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.polizas (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    numero_poliza character varying(50) NOT NULL,
    numero_certificado character varying(30),
    asegurado_id uuid NOT NULL,
    tomador_id uuid,
    compania_id uuid,
    ramo_id uuid,
    fecha_inicio date NOT NULL,
    fecha_fin date NOT NULL,
    vigencia_tipo_id uuid,
    moneda character varying(3) DEFAULT 'ARS'::character varying NOT NULL,
    suma_asegurada numeric(18,2),
    estado character varying(20) DEFAULT 'VIGENTE'::character varying NOT NULL,
    motivo_baja text,
    url_poliza_pdf text,
    notas text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    observaciones text,
    cobertura_id uuid,
    refacturacion_id uuid,
    fecha_baja date,
    observaciones_baja text,
    poliza_origen_id uuid,
    fecha_renovacion date,
    origen_creacion character varying(20) DEFAULT 'MANUAL'::character varying NOT NULL,
    CONSTRAINT chk_poliza_fechas CHECK ((fecha_fin > fecha_inicio)),
    CONSTRAINT polizas_estado_check CHECK (((estado)::text = ANY ((ARRAY['PROGRAMADA'::character varying, 'RENOVADA'::character varying, 'VIGENTE'::character varying, 'NO_VIGENTE'::character varying, 'CANCELADA'::character varying, 'ANULADA'::character varying])::text[]))),
    CONSTRAINT polizas_origen_creacion_check CHECK (((origen_creacion)::text = ANY ((ARRAY['MANUAL'::character varying, 'IMPORTACION'::character varying, 'AGENTE_PDF'::character varying])::text[])))
);


--
-- Name: TABLE polizas; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.polizas IS 'Núcleo de la cartera. Cada fila es una póliza o endoso. La cadena de renovaciones se rastrea mediante poliza_anterior_id. El campo comision_monto es calculado automáticamente.';


--
-- Name: COLUMN polizas.origen_creacion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.polizas.origen_creacion IS 'Cómo entró la póliza al sistema. MANUAL=alta directa, AGENTE_PDF=extraída de PDF, IMPORTACION=cargada via importador masivo. Las IMPORTACION NO disparan email de bienvenida automático (vienen de otra cartera, no son altas reales para el cliente).';


--
-- Name: polizas_eliminadas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.polizas_eliminadas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    poliza_id uuid NOT NULL,
    numero_poliza character varying NOT NULL,
    asegurado_id uuid,
    asegurado_nombre character varying,
    compania_id uuid,
    compania_nombre character varying,
    ramo_id uuid,
    ramo_nombre character varying,
    estado character varying,
    fecha_inicio date,
    fecha_fin date,
    poliza_origen_id uuid,
    cant_polizas_hijas integer DEFAULT 0,
    cant_riesgos integer DEFAULT 0,
    cant_siniestros integer DEFAULT 0,
    cant_endosos integer DEFAULT 0,
    cant_archivos integer DEFAULT 0,
    eliminada_por_usuario_id uuid,
    eliminada_por_email character varying,
    motivo text,
    fecha_eliminacion timestamp with time zone DEFAULT now()
);


--
-- Name: portal_cliente_accesos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_cliente_accesos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    persona_id uuid NOT NULL,
    fecha_creacion timestamp with time zone DEFAULT now(),
    veces_accedido integer DEFAULT 0,
    ultimo_acceso timestamp with time zone,
    ultimo_ip character varying,
    revocado boolean DEFAULT false,
    fecha_revocacion timestamp with time zone,
    motivo_revocacion text,
    creado_por_usuario_id uuid,
    token_hash character varying(64) NOT NULL
);


--
-- Name: postits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.postits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    usuario_id uuid NOT NULL,
    texto text NOT NULL,
    color character varying DEFAULT 'amarillo'::character varying NOT NULL,
    compartido boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT postits_color_check CHECK (((color)::text = ANY ((ARRAY['amarillo'::character varying, 'rosa'::character varying, 'verde'::character varying, 'azul'::character varying, 'naranja'::character varying])::text[])))
);


--
-- Name: rate_limit_buckets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limit_buckets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    identifier character varying NOT NULL,
    endpoint character varying NOT NULL,
    count integer DEFAULT 1,
    reset_at timestamp with time zone NOT NULL
);


--
-- Name: restauraciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restauraciones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fuente character varying NOT NULL,
    backup_id uuid,
    nombre_archivo character varying,
    tamano_archivo_bytes bigint,
    estado character varying DEFAULT 'PENDIENTE'::character varying NOT NULL,
    paso_actual integer DEFAULT 0,
    total_pasos integer DEFAULT 7,
    mensaje_progreso text,
    porcentaje integer DEFAULT 0,
    restaura_db boolean DEFAULT true,
    restaura_storage boolean DEFAULT true,
    crear_pre_backup boolean DEFAULT true,
    pre_backup_id uuid,
    metadata_backup jsonb,
    fecha_inicio timestamp with time zone DEFAULT now(),
    fecha_fin timestamp with time zone,
    duracion_segundos integer,
    error_mensaje text,
    log_completo text,
    work_dir text,
    usuario_id uuid,
    ip_origen character varying,
    user_agent text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT restauraciones_estado_check CHECK (((estado)::text = ANY ((ARRAY['PENDIENTE'::character varying, 'VALIDANDO'::character varying, 'PRE_BACKUP'::character varying, 'EXTRAYENDO'::character varying, 'RESTAURANDO_DB'::character varying, 'RESTAURANDO_STORAGE'::character varying, 'FINALIZANDO'::character varying, 'COMPLETADA'::character varying, 'FALLIDA'::character varying, 'CANCELADA'::character varying])::text[]))),
    CONSTRAINT restauraciones_fuente_check CHECK (((fuente)::text = ANY ((ARRAY['BACKUP_EXISTENTE'::character varying, 'ARCHIVO_SUBIDO'::character varying])::text[])))
);


--
-- Name: riesgos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.riesgos (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    poliza_id uuid NOT NULL,
    tipo_riesgo character varying(50) NOT NULL,
    descripcion_corta character varying(200),
    detalle_tecnico jsonb DEFAULT '{}'::jsonb NOT NULL,
    suma_asegurada numeric(18,2),
    numero_item smallint DEFAULT 1 NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE riesgos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.riesgos IS 'Objeto asegurado vinculado a la póliza. El campo detalle_tecnico JSONB es el corazón dinámico: almacena patente/motor para autos, dirección para hogares, beneficiarios para vida, etc. Permite agregar nuevos ramos sin migraciones de schema.';


--
-- Name: COLUMN riesgos.tipo_riesgo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.riesgos.tipo_riesgo IS 'Tipo de riesgo dictado por el catálogo RAMO del PAS (ramo.metadata.tipo_riesgo). Sin CHECK constraint: acepta cualquier valor para soportar ramos custom agregados por el PAS desde la UI (ej: MASCOTAS, DRONES). Los índices parciales con valores clásicos (AUTOMOTOR, MOTO, HOGAR, COMERCIO) siguen funcionando pero no cubren tipos custom.';


--
-- Name: COLUMN riesgos.detalle_tecnico; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.riesgos.detalle_tecnico IS 'JSONB con los datos técnicos del riesgo. Schema varía por tipo_riesgo. Automotor: {patente, marca, modelo, año, motor, chasis}. Hogar: {direccion, m2, tipo, material}. Vida: {beneficiarios: [{nombre, parentesco, pct}]}.';


--
-- Name: sesiones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sesiones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    usuario_id uuid NOT NULL,
    token character varying NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: siniestro_archivos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.siniestro_archivos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    siniestro_id uuid NOT NULL,
    categoria text NOT NULL,
    nombre text NOT NULL,
    ruta text NOT NULL,
    mime_type text,
    tamano integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT siniestro_archivos_categoria_check CHECK ((categoria = ANY (ARRAY['fotos'::text, 'documentacion'::text])))
);


--
-- Name: siniestro_bitacora; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.siniestro_bitacora (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    siniestro_id uuid NOT NULL,
    tipo character varying(20) DEFAULT 'NOTA'::character varying NOT NULL,
    texto text,
    estado_anterior character varying(30),
    estado_nuevo character varying(30),
    monto_actualizado numeric(12,2),
    created_at timestamp with time zone DEFAULT now(),
    usuario_id uuid,
    campos_modificados jsonb,
    CONSTRAINT siniestro_bitacora_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['NOTA'::character varying, 'ESTADO'::character varying, 'ARCHIVO'::character varying, 'CREACION'::character varying, 'EDICION'::character varying, 'ELIMINACION'::character varying, 'RESTAURACION'::character varying, 'PURGA_DEFINITIVA'::character varying])::text[])))
);


--
-- Name: siniestros; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.siniestros (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    numero_siniestro character varying(50),
    poliza_id uuid NOT NULL,
    riesgo_id uuid,
    persona_id uuid NOT NULL,
    fecha_ocurrencia date NOT NULL,
    fecha_denuncia date DEFAULT CURRENT_DATE NOT NULL,
    fecha_cierre date,
    fecha_ultimo_movimiento timestamp with time zone DEFAULT now() NOT NULL,
    tipo_siniestro character varying(100),
    descripcion text NOT NULL,
    estado character varying(30) DEFAULT 'DENUNCIADO'::character varying NOT NULL,
    motivo_rechazo text,
    monto_estimado numeric(18,2),
    monto_liquidado numeric(18,2),
    franquicia_aplicada numeric(18,2),
    monto_cobrado numeric(18,2),
    tercero_nombre character varying(200),
    tercero_dni character varying(20),
    tercero_telefono character varying(30),
    tercero_patente character varying(15),
    notas text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    hora_siniestro time without time zone,
    lugar_siniestro text,
    localidad_siniestro text,
    numero_caso character varying,
    detalle_siniestro jsonb,
    deleted_at timestamp with time zone,
    deleted_by_usuario_id uuid,
    CONSTRAINT chk_siniestro_fechas CHECK ((fecha_ocurrencia <= fecha_denuncia)),
    CONSTRAINT siniestros_estado_check CHECK (((estado)::text = ANY (ARRAY[('DENUNCIADO'::character varying)::text, ('EN_TRAMITE'::character varying)::text, ('INSPECCION'::character varying)::text, ('LIQUIDACION'::character varying)::text, ('REPARACION'::character varying)::text, ('FINALIZADO'::character varying)::text, ('RECHAZADO'::character varying)::text])))
);


--
-- Name: TABLE siniestros; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.siniestros IS 'Registro completo del ciclo de vida de un siniestro: desde la denuncia hasta el cierre. El campo fecha_ultimo_movimiento permite detectar siniestros estancados para alertas automáticas.';


--
-- Name: COLUMN siniestros.fecha_ultimo_movimiento; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.siniestros.fecha_ultimo_movimiento IS 'Se actualiza en cada cambio de estado. El sistema de alertas usa esta fecha para detectar siniestros sin movimiento pasado N días (configurable en configuracion_sistema).';


--
-- Name: siniestros_contador; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.siniestros_contador (
    anio integer NOT NULL,
    ultimo_numero integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: storage_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storage_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token character varying NOT NULL,
    ruta_archivo character varying NOT NULL,
    fecha_creacion timestamp with time zone DEFAULT now(),
    fecha_expiracion timestamp with time zone NOT NULL,
    veces_usado integer DEFAULT 0,
    max_usos integer,
    contexto character varying,
    creado_por_usuario_id uuid
);


--
-- Name: tareas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tareas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    titulo text NOT NULL,
    tipo text DEFAULT 'TAREA_GENERAL'::text NOT NULL,
    descripcion text,
    persona_id uuid NOT NULL,
    poliza_id uuid,
    siniestro_id uuid,
    fecha_vencimiento date NOT NULL,
    hora_vencimiento time without time zone,
    prioridad text DEFAULT 'MEDIA'::text NOT NULL,
    estado text DEFAULT 'PENDIENTE'::text NOT NULL,
    recurrencia text DEFAULT 'NINGUNA'::text NOT NULL,
    nota_cierre text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    usuario_id uuid,
    oportunidad_id uuid,
    cotizacion_id uuid,
    lead_id uuid,
    CONSTRAINT tareas_estado_check CHECK ((estado = ANY (ARRAY['PENDIENTE'::text, 'EN_PROCESO'::text, 'COMPLETADA'::text, 'CANCELADA'::text]))),
    CONSTRAINT tareas_prioridad_check CHECK ((prioridad = ANY (ARRAY['CRITICA'::text, 'ALTA'::text, 'MEDIA'::text, 'BAJA'::text]))),
    CONSTRAINT tareas_recurrencia_check CHECK ((recurrencia = ANY (ARRAY['NINGUNA'::text, 'DIARIA'::text, 'SEMANAL'::text, 'MENSUAL'::text, 'ANUAL'::text]))),
    CONSTRAINT tareas_tipo_check CHECK ((tipo = ANY (ARRAY['LLAMADA_SEGUIMIENTO'::text, 'GESTION_RENOVACION'::text, 'TRAMITE_SINIESTRO'::text, 'GESTION_COBRANZA'::text, 'ENVIO_DOCUMENTACION'::text, 'REUNION_CLIENTE'::text, 'ALERTA_VENCIMIENTO'::text, 'TAREA_GENERAL'::text])))
);


--
-- Name: telefonos_asistencia_companias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telefonos_asistencia_companias (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    compania_id uuid NOT NULL,
    telefono character varying NOT NULL,
    nombre_boton character varying DEFAULT 'Asistencia 24hs'::character varying,
    visible_en_portal boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: tipo_catalogo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tipo_catalogo (
    id smallint NOT NULL,
    codigo character varying(50) NOT NULL,
    descripcion text NOT NULL
);


--
-- Name: TABLE tipo_catalogo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tipo_catalogo IS 'Registro maestro de categorías de catálogo. Permite agregar nuevos tipos sin migraciones.';


--
-- Name: tipo_catalogo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tipo_catalogo_id_seq
    AS smallint
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tipo_catalogo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tipo_catalogo_id_seq OWNED BY public.tipo_catalogo.id;


--
-- Name: usuarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usuarios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre character varying NOT NULL,
    apellido character varying NOT NULL,
    email character varying NOT NULL,
    password_hash character varying NOT NULL,
    rol character varying DEFAULT 'USUARIO'::character varying NOT NULL,
    acceso_cartera character varying DEFAULT 'PROPIA'::character varying NOT NULL,
    activo boolean DEFAULT true,
    ultimo_acceso timestamp with time zone,
    intentos_fallidos integer DEFAULT 0,
    bloqueado_hasta timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT usuarios_acceso_check CHECK (((acceso_cartera)::text = ANY ((ARRAY['TOTAL'::character varying, 'PROPIA'::character varying])::text[]))),
    CONSTRAINT usuarios_rol_check CHECK (((rol)::text = ANY ((ARRAY['ADMIN'::character varying, 'USUARIO'::character varying])::text[])))
);


--
-- Name: v_polizas_pendientes_renovar; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_polizas_pendientes_renovar AS
 SELECT p.id,
    p.numero_poliza,
    p.estado,
    p.fecha_inicio,
    p.fecha_fin,
    p.asegurado_id,
    p.compania_id,
    p.ramo_id,
    p.cobertura_id,
    (EXISTS ( SELECT 1
           FROM public.polizas h
          WHERE ((h.poliza_origen_id = p.id) AND ((h.estado)::text = ANY ((ARRAY['RENOVADA'::character varying, 'VIGENTE'::character varying, 'PROGRAMADA'::character varying])::text[]))))) AS tiene_renovacion_activa,
    (p.fecha_fin - CURRENT_DATE) AS dias_hasta_fin,
        CASE
            WHEN (((p.estado)::text = 'VIGENTE'::text) AND (p.fecha_fin >= CURRENT_DATE) AND (p.fecha_fin <= (CURRENT_DATE + '30 days'::interval))) THEN 'POR_VENCER'::text
            WHEN ((p.estado)::text = 'RENOVADA'::text) THEN 'RENOVADA_LATENTE'::text
            WHEN (((p.estado)::text = 'NO_VIGENTE'::text) AND (NOT (EXISTS ( SELECT 1
               FROM public.polizas h
              WHERE ((h.poliza_origen_id = p.id) AND ((h.estado)::text = ANY ((ARRAY['RENOVADA'::character varying, 'VIGENTE'::character varying, 'PROGRAMADA'::character varying])::text[]))))))) THEN 'VENCIDA_SIN_RENOVAR'::text
            ELSE NULL::text
        END AS categoria_renovacion
   FROM public.polizas p
  WHERE ((((p.estado)::text = 'VIGENTE'::text) AND (p.fecha_fin <= (CURRENT_DATE + '30 days'::interval))) OR ((p.estado)::text = 'RENOVADA'::text) OR ((p.estado)::text = 'NO_VIGENTE'::text));


--
-- Name: VIEW v_polizas_pendientes_renovar; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_polizas_pendientes_renovar IS 'Pólizas relevantes para el módulo de Renovaciones. Incluye flag tiene_renovacion_activa para distinguir pólizas vencidas que ya fueron renovadas (no deben aparecer "para renovar") vs. las que faltan renovar.';


--
-- Name: v_polizas_por_vencer; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_polizas_por_vencer AS
 SELECT p.id AS poliza_id,
    p.numero_poliza,
    p.fecha_fin,
    (p.fecha_fin - CURRENT_DATE) AS dias_restantes,
    p.estado AS estado_poliza,
    pe.id AS persona_id,
    COALESCE(NULLIF(TRIM(BOTH FROM concat_ws(', '::text, pe.apellido, pe.nombre)), ','::text), (pe.razon_social)::text, (pe.apellido)::text) AS nombre_completo,
    pe.dni_cuil,
    pe.email,
    pe.telefono,
    pe.whatsapp,
    COALESCE(c.nombre, '—'::character varying) AS compania,
    COALESCE(r.nombre, '—'::character varying) AS ramo,
        CASE
            WHEN (p.fecha_fin < CURRENT_DATE) THEN 'VENCIDA'::text
            WHEN ((p.fecha_fin - CURRENT_DATE) <= 7) THEN 'URGENTE'::text
            WHEN ((p.fecha_fin - CURRENT_DATE) <= 15) THEN 'CRITICA'::text
            WHEN ((p.fecha_fin - CURRENT_DATE) <= 30) THEN 'PROXIMA'::text
            ELSE 'NORMAL'::text
        END AS prioridad_alerta
   FROM (((public.polizas p
     JOIN public.personas pe ON (((pe.id = p.asegurado_id) AND (pe.deleted_at IS NULL))))
     LEFT JOIN public.catalogos c ON ((c.id = p.compania_id)))
     LEFT JOIN public.catalogos r ON ((r.id = p.ramo_id)))
  WHERE ((p.estado)::text = 'VIGENTE'::text);


--
-- Name: tipo_catalogo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_catalogo ALTER COLUMN id SET DEFAULT nextval('public.tipo_catalogo_id_seq'::regclass);


--
-- Name: anthropic_modelos_cache anthropic_modelos_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anthropic_modelos_cache
    ADD CONSTRAINT anthropic_modelos_cache_pkey PRIMARY KEY (id);


--
-- Name: backups backups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backups
    ADD CONSTRAINT backups_pkey PRIMARY KEY (id);


--
-- Name: catalogos catalogos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalogos
    ADD CONSTRAINT catalogos_pkey PRIMARY KEY (id);


--
-- Name: configuracion_backups configuracion_backups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configuracion_backups
    ADD CONSTRAINT configuracion_backups_pkey PRIMARY KEY (id);


--
-- Name: configuracion_comunicaciones configuracion_comunicaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configuracion_comunicaciones
    ADD CONSTRAINT configuracion_comunicaciones_pkey PRIMARY KEY (id);


--
-- Name: configuracion_correos configuracion_correos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configuracion_correos
    ADD CONSTRAINT configuracion_correos_pkey PRIMARY KEY (id);


--
-- Name: configuracion_formulario_publico configuracion_formulario_publico_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configuracion_formulario_publico
    ADD CONSTRAINT configuracion_formulario_publico_pkey PRIMARY KEY (id);


--
-- Name: configuracion_notificaciones configuracion_notificaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configuracion_notificaciones
    ADD CONSTRAINT configuracion_notificaciones_pkey PRIMARY KEY (id);


--
-- Name: configuracion_notificaciones configuracion_notificaciones_tipo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configuracion_notificaciones
    ADD CONSTRAINT configuracion_notificaciones_tipo_key UNIQUE (tipo);


--
-- Name: configuracion configuracion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configuracion
    ADD CONSTRAINT configuracion_pkey PRIMARY KEY (id);


--
-- Name: configuracion_portal_cliente configuracion_portal_cliente_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configuracion_portal_cliente
    ADD CONSTRAINT configuracion_portal_cliente_pkey PRIMARY KEY (id);


--
-- Name: cotizacion_companias cotizacion_companias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizacion_companias
    ADD CONSTRAINT cotizacion_companias_pkey PRIMARY KEY (id);


--
-- Name: cotizaciones cotizaciones_numero_cotizacion_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizaciones
    ADD CONSTRAINT cotizaciones_numero_cotizacion_key UNIQUE (numero_cotizacion);


--
-- Name: cotizaciones cotizaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizaciones
    ADD CONSTRAINT cotizaciones_pkey PRIMARY KEY (id);


--
-- Name: email_bajas email_bajas_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_bajas
    ADD CONSTRAINT email_bajas_email_key UNIQUE (email);


--
-- Name: email_bajas email_bajas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_bajas
    ADD CONSTRAINT email_bajas_pkey PRIMARY KEY (id);


--
-- Name: email_clicks email_clicks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_clicks
    ADD CONSTRAINT email_clicks_pkey PRIMARY KEY (id);


--
-- Name: email_envios email_envios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_envios
    ADD CONSTRAINT email_envios_pkey PRIMARY KEY (id);


--
-- Name: email_envios email_envios_token_tracking_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_envios
    ADD CONSTRAINT email_envios_token_tracking_key UNIQUE (token_tracking);


--
-- Name: endosos endosos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.endosos
    ADD CONSTRAINT endosos_pkey PRIMARY KEY (id);


--
-- Name: errores_sistema errores_sistema_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.errores_sistema
    ADD CONSTRAINT errores_sistema_pkey PRIMARY KEY (id);


--
-- Name: facturacion facturacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facturacion
    ADD CONSTRAINT facturacion_pkey PRIMARY KEY (id);


--
-- Name: importacion_jobs importacion_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.importacion_jobs
    ADD CONSTRAINT importacion_jobs_pkey PRIMARY KEY (id);


--
-- Name: importacion_lotes importacion_lotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.importacion_lotes
    ADD CONSTRAINT importacion_lotes_pkey PRIMARY KEY (id);


--
-- Name: importacion_lotes importacion_lotes_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.importacion_lotes
    ADD CONSTRAINT importacion_lotes_unique UNIQUE (importacion_id, numero_lote);


--
-- Name: importacion_registros_dudosos importacion_registros_dudosos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.importacion_registros_dudosos
    ADD CONSTRAINT importacion_registros_dudosos_pkey PRIMARY KEY (id);


--
-- Name: importaciones importaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.importaciones
    ADD CONSTRAINT importaciones_pkey PRIMARY KEY (id);


--
-- Name: interacciones interacciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interacciones
    ADD CONSTRAINT interacciones_pkey PRIMARY KEY (id);


--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);


--
-- migraciones_aplicadas_pkey: excluido (la tabla la crea aplicar-migraciones.sh)
--


--
-- Name: notificaciones notificaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificaciones
    ADD CONSTRAINT notificaciones_pkey PRIMARY KEY (id);


--
-- Name: oportunidades oportunidades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oportunidades
    ADD CONSTRAINT oportunidades_pkey PRIMARY KEY (id);


--
-- Name: pdf_procesamientos pdf_procesamientos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pdf_procesamientos
    ADD CONSTRAINT pdf_procesamientos_pkey PRIMARY KEY (id);


--
-- Name: persona_bitacora persona_bitacora_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persona_bitacora
    ADD CONSTRAINT persona_bitacora_pkey PRIMARY KEY (id);


--
-- Name: personas personas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personas
    ADD CONSTRAINT personas_pkey PRIMARY KEY (id);


--
-- Name: plantillas_email plantillas_email_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plantillas_email
    ADD CONSTRAINT plantillas_email_codigo_key UNIQUE (codigo);


--
-- Name: plantillas_email plantillas_email_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plantillas_email
    ADD CONSTRAINT plantillas_email_pkey PRIMARY KEY (id);


--
-- Name: poliza_archivos poliza_archivos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.poliza_archivos
    ADD CONSTRAINT poliza_archivos_pkey PRIMARY KEY (id);


--
-- Name: poliza_bitacora poliza_bitacora_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.poliza_bitacora
    ADD CONSTRAINT poliza_bitacora_pkey PRIMARY KEY (id);


--
-- Name: polizas_eliminadas polizas_eliminadas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.polizas_eliminadas
    ADD CONSTRAINT polizas_eliminadas_pkey PRIMARY KEY (id);


--
-- Name: polizas polizas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.polizas
    ADD CONSTRAINT polizas_pkey PRIMARY KEY (id);


--
-- Name: portal_cliente_accesos portal_cliente_accesos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_cliente_accesos
    ADD CONSTRAINT portal_cliente_accesos_pkey PRIMARY KEY (id);


--
-- Name: postits postits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postits
    ADD CONSTRAINT postits_pkey PRIMARY KEY (id);


--
-- Name: rate_limit_buckets rate_limit_buckets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_buckets
    ADD CONSTRAINT rate_limit_buckets_pkey PRIMARY KEY (id);


--
-- Name: rate_limit_buckets rate_limit_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_buckets
    ADD CONSTRAINT rate_limit_unique UNIQUE (identifier, endpoint);


--
-- Name: restauraciones restauraciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restauraciones
    ADD CONSTRAINT restauraciones_pkey PRIMARY KEY (id);


--
-- Name: riesgos riesgos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.riesgos
    ADD CONSTRAINT riesgos_pkey PRIMARY KEY (id);


--
-- Name: sesiones sesiones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesiones
    ADD CONSTRAINT sesiones_pkey PRIMARY KEY (id);


--
-- Name: sesiones sesiones_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesiones
    ADD CONSTRAINT sesiones_token_key UNIQUE (token);


--
-- Name: siniestro_archivos siniestro_archivos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.siniestro_archivos
    ADD CONSTRAINT siniestro_archivos_pkey PRIMARY KEY (id);


--
-- Name: siniestro_bitacora siniestro_bitacora_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.siniestro_bitacora
    ADD CONSTRAINT siniestro_bitacora_pkey PRIMARY KEY (id);


--
-- Name: siniestros_contador siniestros_contador_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.siniestros_contador
    ADD CONSTRAINT siniestros_contador_pkey PRIMARY KEY (anio);


--
-- Name: siniestros siniestros_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.siniestros
    ADD CONSTRAINT siniestros_pkey PRIMARY KEY (id);


--
-- Name: storage_tokens storage_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_tokens
    ADD CONSTRAINT storage_tokens_pkey PRIMARY KEY (id);


--
-- Name: storage_tokens storage_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_tokens
    ADD CONSTRAINT storage_tokens_token_key UNIQUE (token);


--
-- Name: tareas tareas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tareas
    ADD CONSTRAINT tareas_pkey PRIMARY KEY (id);


--
-- Name: telefonos_asistencia_companias telefonos_asistencia_companias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telefonos_asistencia_companias
    ADD CONSTRAINT telefonos_asistencia_companias_pkey PRIMARY KEY (id);


--
-- Name: telefonos_asistencia_companias telefonos_asistencia_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telefonos_asistencia_companias
    ADD CONSTRAINT telefonos_asistencia_unique UNIQUE (compania_id);


--
-- Name: tipo_catalogo tipo_catalogo_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_catalogo
    ADD CONSTRAINT tipo_catalogo_codigo_key UNIQUE (codigo);


--
-- Name: tipo_catalogo tipo_catalogo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_catalogo
    ADD CONSTRAINT tipo_catalogo_pkey PRIMARY KEY (id);


--
-- Name: catalogos uq_catalogo_tipo_codigo; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalogos
    ADD CONSTRAINT uq_catalogo_tipo_codigo UNIQUE (tipo_id, codigo);


--
-- Name: endosos uq_endosos_poliza_numero; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.endosos
    ADD CONSTRAINT uq_endosos_poliza_numero UNIQUE (poliza_id, numero_endoso);


--
-- Name: facturacion uq_facturacion_periodo_compania_ramo; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facturacion
    ADD CONSTRAINT uq_facturacion_periodo_compania_ramo UNIQUE (anio, mes, compania_id, ramo_id);


--
-- Name: personas uq_personas_dni_cuil; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personas
    ADD CONSTRAINT uq_personas_dni_cuil UNIQUE (dni_cuil);


--
-- Name: riesgos uq_riesgo_poliza_item; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.riesgos
    ADD CONSTRAINT uq_riesgo_poliza_item UNIQUE (poliza_id, numero_item);


--
-- Name: usuarios usuarios_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_email_key UNIQUE (email);


--
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);


--
-- Name: idx_anthropic_modelos_cache_familia; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_anthropic_modelos_cache_familia ON public.anthropic_modelos_cache USING btree (familia) WHERE (familia IS NOT NULL);


--
-- Name: idx_backups_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_backups_estado ON public.backups USING btree (estado);


--
-- Name: idx_backups_fecha_inicio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_backups_fecha_inicio ON public.backups USING btree (fecha_inicio DESC);


--
-- Name: idx_bitacora_siniestro; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bitacora_siniestro ON public.siniestro_bitacora USING btree (siniestro_id, created_at DESC);


--
-- Name: idx_catalogos_metadata; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_catalogos_metadata ON public.catalogos USING gin (metadata);


--
-- Name: idx_catalogos_nombre_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_catalogos_nombre_trgm ON public.catalogos USING gin (nombre public.gin_trgm_ops);


--
-- Name: idx_catalogos_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_catalogos_parent ON public.catalogos USING btree (parent_id) WHERE (parent_id IS NOT NULL);


--
-- Name: idx_catalogos_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_catalogos_tipo ON public.catalogos USING btree (tipo_id) WHERE (activo = true);


--
-- Name: idx_configuracion_backups_singleton; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_configuracion_backups_singleton ON public.configuracion_backups USING btree ((true));


--
-- Name: idx_configuracion_comunicaciones_singleton; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_configuracion_comunicaciones_singleton ON public.configuracion_comunicaciones USING btree ((true));


--
-- Name: idx_configuracion_correos_singleton; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_configuracion_correos_singleton ON public.configuracion_correos USING btree ((true));


--
-- Name: idx_configuracion_formulario_publico_singleton; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_configuracion_formulario_publico_singleton ON public.configuracion_formulario_publico USING btree ((true));


--
-- Name: idx_configuracion_portal_singleton; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_configuracion_portal_singleton ON public.configuracion_portal_cliente USING btree ((true));


--
-- Name: idx_cotizacion_companias_cotizacion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cotizacion_companias_cotizacion ON public.cotizacion_companias USING btree (cotizacion_id);


--
-- Name: idx_cotizaciones_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cotizaciones_created_at ON public.cotizaciones USING btree (created_at DESC);


--
-- Name: idx_cotizaciones_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cotizaciones_estado ON public.cotizaciones USING btree (estado);


--
-- Name: idx_cotizaciones_fecha_envio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cotizaciones_fecha_envio ON public.cotizaciones USING btree (fecha_envio) WHERE ((fecha_envio IS NOT NULL) AND ((estado)::text = ANY ((ARRAY['ENVIADA'::character varying, 'EN_PROCESO'::character varying])::text[])));


--
-- Name: idx_cotizaciones_lead_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cotizaciones_lead_id ON public.cotizaciones USING btree (lead_id);


--
-- Name: idx_cotizaciones_oportunidad_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cotizaciones_oportunidad_id ON public.cotizaciones USING btree (oportunidad_id);


--
-- Name: idx_cotizaciones_persona_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cotizaciones_persona_id ON public.cotizaciones USING btree (persona_id);


--
-- Name: idx_cotizaciones_updated_at_en_proceso; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cotizaciones_updated_at_en_proceso ON public.cotizaciones USING btree (updated_at) WHERE ((estado)::text = 'EN_PROCESO'::text);


--
-- Name: idx_cotizaciones_usuario_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cotizaciones_usuario_id ON public.cotizaciones USING btree (usuario_id);


--
-- Name: idx_cotizaciones_vencimiento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cotizaciones_vencimiento ON public.cotizaciones USING btree (fecha_vencimiento) WHERE ((fecha_vencimiento IS NOT NULL) AND ((estado)::text = ANY ((ARRAY['ENVIADA'::character varying, 'EN_PROCESO'::character varying])::text[])));


--
-- Name: idx_dudosos_importacion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dudosos_importacion ON public.importacion_registros_dudosos USING btree (importacion_id, estado_resolucion);


--
-- Name: idx_dudosos_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dudosos_tipo ON public.importacion_registros_dudosos USING btree (tipo_problema);


--
-- Name: idx_email_bajas_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_bajas_email ON public.email_bajas USING btree (email);


--
-- Name: idx_email_clicks_envio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_clicks_envio ON public.email_clicks USING btree (envio_id);


--
-- Name: idx_email_envios_cola_priorizada; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_envios_cola_priorizada ON public.email_envios USING btree (prioridad DESC, enviar_despues_de, fecha_creacion) WHERE ((estado)::text = 'ENCOLADO'::text);


--
-- Name: idx_email_envios_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_envios_estado ON public.email_envios USING btree (estado);


--
-- Name: idx_email_envios_fecha_creacion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_envios_fecha_creacion ON public.email_envios USING btree (fecha_creacion DESC);


--
-- Name: idx_email_envios_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_envios_persona ON public.email_envios USING btree (persona_id);


--
-- Name: idx_email_envios_poliza; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_envios_poliza ON public.email_envios USING btree (poliza_id);


--
-- Name: idx_email_envios_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_envios_token ON public.email_envios USING btree (token_tracking);


--
-- Name: idx_endosos_poliza; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_endosos_poliza ON public.endosos USING btree (poliza_id);


--
-- Name: idx_errores_agregacion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_errores_agregacion ON public.errores_sistema USING btree (codigo, modulo, endpoint, ultima_aparicion);


--
-- Name: idx_errores_codigo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_errores_codigo ON public.errores_sistema USING btree (codigo);


--
-- Name: idx_errores_correlation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_errores_correlation ON public.errores_sistema USING btree (correlation_id) WHERE (correlation_id IS NOT NULL);


--
-- Name: idx_errores_modulo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_errores_modulo ON public.errores_sistema USING btree (modulo);


--
-- Name: idx_errores_no_archivados; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_errores_no_archivados ON public.errores_sistema USING btree (created_at DESC) WHERE (archivado = false);


--
-- Name: idx_errores_ultima; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_errores_ultima ON public.errores_sistema USING btree (ultima_aparicion DESC);


--
-- Name: idx_facturacion_compania; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_facturacion_compania ON public.facturacion USING btree (compania_id, anio DESC, mes DESC);


--
-- Name: idx_facturacion_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_facturacion_estado ON public.facturacion USING btree (estado_liquidacion) WHERE ((estado_liquidacion)::text <> 'COBRADO'::text);


--
-- Name: idx_facturacion_periodo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_facturacion_periodo ON public.facturacion USING btree (anio DESC, mes DESC);


--
-- Name: idx_importacion_jobs_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_importacion_jobs_estado ON public.importacion_jobs USING btree (estado, prioridad DESC, fecha_creacion);


--
-- Name: idx_importacion_jobs_importacion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_importacion_jobs_importacion ON public.importacion_jobs USING btree (importacion_id);


--
-- Name: idx_importacion_lotes_importacion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_importacion_lotes_importacion ON public.importacion_lotes USING btree (importacion_id, numero_lote);


--
-- Name: idx_importaciones_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_importaciones_created_at ON public.importaciones USING btree (created_at DESC);


--
-- Name: idx_importaciones_estado_proceso; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_importaciones_estado_proceso ON public.importaciones USING btree (estado_proceso);


--
-- Name: idx_importaciones_usuario_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_importaciones_usuario_fecha ON public.importaciones USING btree (usuario_id, created_at DESC);


--
-- Name: idx_importaciones_usuario_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_importaciones_usuario_id ON public.importaciones USING btree (usuario_id);


--
-- Name: idx_interacciones_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interacciones_fecha ON public.interacciones USING btree (fecha DESC);


--
-- Name: idx_interacciones_lead_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interacciones_lead_id ON public.interacciones USING btree (lead_id);


--
-- Name: idx_interacciones_oportunidad_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interacciones_oportunidad_id ON public.interacciones USING btree (oportunidad_id);


--
-- Name: idx_interacciones_persona_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interacciones_persona_id ON public.interacciones USING btree (persona_id) WHERE (persona_id IS NOT NULL);


--
-- Name: idx_leads_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_created_at ON public.leads USING btree (created_at DESC);


--
-- Name: idx_leads_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_estado ON public.leads USING btree (estado);


--
-- Name: idx_leads_fuente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_fuente ON public.leads USING btree (fuente);


--
-- Name: idx_leads_nivel_interes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_nivel_interes ON public.leads USING btree (nivel_interes);


--
-- Name: idx_leads_persona_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_persona_id ON public.leads USING btree (persona_id);


--
-- Name: idx_leads_usuario_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_usuario_id ON public.leads USING btree (usuario_id);


--
-- Name: idx_notificaciones_entidad; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notificaciones_entidad ON public.notificaciones USING btree (entidad_tipo, entidad_id) WHERE (entidad_id IS NOT NULL);


--
-- Name: idx_notificaciones_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notificaciones_tipo ON public.notificaciones USING btree (tipo, created_at DESC);


--
-- Name: idx_notificaciones_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notificaciones_usuario ON public.notificaciones USING btree (usuario_id, created_at DESC);


--
-- Name: idx_notificaciones_usuario_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notificaciones_usuario_id ON public.notificaciones USING btree (usuario_id);


--
-- Name: idx_notificaciones_usuario_no_leidas; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notificaciones_usuario_no_leidas ON public.notificaciones USING btree (usuario_id, created_at DESC) WHERE ((leida = false) AND (descartada = false));


--
-- Name: idx_oportunidades_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oportunidades_created_at ON public.oportunidades USING btree (created_at DESC);


--
-- Name: idx_oportunidades_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oportunidades_estado ON public.oportunidades USING btree (estado);


--
-- Name: idx_oportunidades_fecha_proximo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oportunidades_fecha_proximo ON public.oportunidades USING btree (fecha_proximo_contacto);


--
-- Name: idx_oportunidades_monto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oportunidades_monto ON public.oportunidades USING btree (monto_estimado) WHERE (monto_estimado IS NOT NULL);


--
-- Name: idx_oportunidades_persona_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oportunidades_persona_id ON public.oportunidades USING btree (persona_id);


--
-- Name: idx_oportunidades_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oportunidades_tipo ON public.oportunidades USING btree (tipo);


--
-- Name: idx_oportunidades_usuario_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oportunidades_usuario_id ON public.oportunidades USING btree (usuario_id);


--
-- Name: idx_pdf_procesamientos_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pdf_procesamientos_estado ON public.pdf_procesamientos USING btree (estado);


--
-- Name: idx_pdf_procesamientos_poliza_origen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pdf_procesamientos_poliza_origen ON public.pdf_procesamientos USING btree (poliza_origen_id) WHERE (poliza_origen_id IS NOT NULL);


--
-- Name: idx_pdf_procesamientos_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pdf_procesamientos_usuario ON public.pdf_procesamientos USING btree (usuario_id);


--
-- Name: idx_persona_bitacora_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_persona_bitacora_fecha ON public.persona_bitacora USING btree (created_at DESC);


--
-- Name: idx_persona_bitacora_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_persona_bitacora_persona ON public.persona_bitacora USING btree (persona_id);


--
-- Name: idx_personas_apellido_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_personas_apellido_trgm ON public.personas USING gin (apellido public.gin_trgm_ops);


--
-- Name: idx_personas_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_personas_created_at ON public.personas USING btree (created_at DESC);


--
-- Name: idx_personas_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_personas_deleted_at ON public.personas USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_personas_dni_cuil; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_personas_dni_cuil ON public.personas USING btree (regexp_replace((dni_cuil)::text, '[^0-9]'::text, ''::text, 'g'::text));


--
-- Name: idx_personas_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_personas_email ON public.personas USING btree (lower((email)::text)) WHERE (email IS NOT NULL);


--
-- Name: idx_personas_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_personas_estado ON public.personas USING btree (estado) WHERE ((estado)::text <> 'INACTIVO'::text);


--
-- Name: idx_personas_fecha_nacimiento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_personas_fecha_nacimiento ON public.personas USING btree (((datos_extra ->> 'fecha_nacimiento'::text))) WHERE (datos_extra ? 'fecha_nacimiento'::text);


--
-- Name: idx_personas_nombre_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_personas_nombre_trgm ON public.personas USING gin (nombre public.gin_trgm_ops);


--
-- Name: idx_personas_telefono; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_personas_telefono ON public.personas USING btree (telefono) WHERE (telefono IS NOT NULL);


--
-- Name: idx_personas_usuario_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_personas_usuario_id ON public.personas USING btree (usuario_id);


--
-- Name: idx_poliza_archivos_endoso; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_poliza_archivos_endoso ON public.poliza_archivos USING btree (endoso_id) WHERE (endoso_id IS NOT NULL);


--
-- Name: idx_poliza_archivos_poliza; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_poliza_archivos_poliza ON public.poliza_archivos USING btree (poliza_id);


--
-- Name: idx_poliza_bitacora_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_poliza_bitacora_fecha ON public.poliza_bitacora USING btree (created_at DESC);


--
-- Name: idx_poliza_bitacora_poliza; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_poliza_bitacora_poliza ON public.poliza_bitacora USING btree (poliza_id);


--
-- Name: idx_polizas_asegurado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_polizas_asegurado ON public.polizas USING btree (asegurado_id);


--
-- Name: idx_polizas_compania; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_polizas_compania ON public.polizas USING btree (compania_id);


--
-- Name: idx_polizas_eliminadas_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_polizas_eliminadas_fecha ON public.polizas_eliminadas USING btree (fecha_eliminacion DESC);


--
-- Name: idx_polizas_eliminadas_numero; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_polizas_eliminadas_numero ON public.polizas_eliminadas USING btree (numero_poliza);


--
-- Name: idx_polizas_eliminadas_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_polizas_eliminadas_usuario ON public.polizas_eliminadas USING btree (eliminada_por_usuario_id);


--
-- Name: idx_polizas_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_polizas_estado ON public.polizas USING btree (estado) WHERE ((estado)::text = ANY ((ARRAY['VIGENTE'::character varying, 'PROGRAMADA'::character varying])::text[]));


--
-- Name: idx_polizas_fecha_fin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_polizas_fecha_fin ON public.polizas USING btree (fecha_fin) WHERE ((estado)::text = 'VIGENTE'::text);


--
-- Name: idx_polizas_numero; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_polizas_numero ON public.polizas USING btree (numero_poliza);


--
-- Name: idx_polizas_poliza_origen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_polizas_poliza_origen ON public.polizas USING btree (poliza_origen_id) WHERE (poliza_origen_id IS NOT NULL);


--
-- Name: idx_polizas_ramo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_polizas_ramo ON public.polizas USING btree (ramo_id);


--
-- Name: idx_polizas_vencimiento_dashboard; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_polizas_vencimiento_dashboard ON public.polizas USING btree (fecha_fin, estado, compania_id) WHERE ((estado)::text = 'VIGENTE'::text);


--
-- Name: idx_portal_accesos_activo_por_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_portal_accesos_activo_por_persona ON public.portal_cliente_accesos USING btree (persona_id) WHERE (revocado = false);


--
-- Name: idx_portal_accesos_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_accesos_persona ON public.portal_cliente_accesos USING btree (persona_id);


--
-- Name: idx_portal_cliente_accesos_token_hash_activo; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_portal_cliente_accesos_token_hash_activo ON public.portal_cliente_accesos USING btree (token_hash) WHERE (revocado = false);


--
-- Name: idx_postits_compartido; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_postits_compartido ON public.postits USING btree (compartido);


--
-- Name: idx_postits_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_postits_created_at ON public.postits USING btree (created_at DESC);


--
-- Name: idx_postits_usuario_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_postits_usuario_id ON public.postits USING btree (usuario_id);


--
-- Name: idx_rate_limit_reset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rate_limit_reset ON public.rate_limit_buckets USING btree (reset_at);


--
-- Name: idx_restauraciones_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restauraciones_estado ON public.restauraciones USING btree (estado);


--
-- Name: idx_restauraciones_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restauraciones_fecha ON public.restauraciones USING btree (fecha_inicio DESC);


--
-- Name: idx_restauraciones_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restauraciones_usuario ON public.restauraciones USING btree (usuario_id);


--
-- Name: idx_riesgos_chasis; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_riesgos_chasis ON public.riesgos USING btree (((detalle_tecnico ->> 'chasis'::text))) WHERE (detalle_tecnico ? 'chasis'::text);


--
-- Name: idx_riesgos_detalle_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_riesgos_detalle_gin ON public.riesgos USING gin (detalle_tecnico);


--
-- Name: idx_riesgos_direccion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_riesgos_direccion ON public.riesgos USING btree (((detalle_tecnico ->> 'direccion'::text))) WHERE (((tipo_riesgo)::text = ANY ((ARRAY['HOGAR'::character varying, 'COMERCIO'::character varying])::text[])) AND (detalle_tecnico ? 'direccion'::text));


--
-- Name: idx_riesgos_motor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_riesgos_motor ON public.riesgos USING btree (((detalle_tecnico ->> 'motor'::text))) WHERE (detalle_tecnico ? 'motor'::text);


--
-- Name: idx_riesgos_patente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_riesgos_patente ON public.riesgos USING btree (((detalle_tecnico ->> 'patente'::text))) WHERE (((tipo_riesgo)::text = ANY ((ARRAY['AUTOMOTOR'::character varying, 'MOTO'::character varying])::text[])) AND (detalle_tecnico ? 'patente'::text));


--
-- Name: idx_riesgos_poliza; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_riesgos_poliza ON public.riesgos USING btree (poliza_id);


--
-- Name: idx_riesgos_tipo_poliza; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_riesgos_tipo_poliza ON public.riesgos USING btree (tipo_riesgo, poliza_id);


--
-- Name: idx_sesiones_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sesiones_expires ON public.sesiones USING btree (expires_at);


--
-- Name: idx_sesiones_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sesiones_token ON public.sesiones USING btree (token);


--
-- Name: idx_sesiones_usuario_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sesiones_usuario_id ON public.sesiones USING btree (usuario_id);


--
-- Name: idx_siniestro_archivos_siniestro_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_siniestro_archivos_siniestro_id ON public.siniestro_archivos USING btree (siniestro_id);


--
-- Name: idx_siniestro_bitacora_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_siniestro_bitacora_fecha ON public.siniestro_bitacora USING btree (siniestro_id, created_at DESC);


--
-- Name: idx_siniestros_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_siniestros_deleted_at ON public.siniestros USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_siniestros_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_siniestros_estado ON public.siniestros USING btree (estado) WHERE ((estado)::text <> ALL ((ARRAY['FINALIZADO'::character varying, 'RECHAZADO'::character varying])::text[]));


--
-- Name: idx_siniestros_fecha_ocurrencia; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_siniestros_fecha_ocurrencia ON public.siniestros USING btree (fecha_ocurrencia DESC);


--
-- Name: idx_siniestros_numero; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_siniestros_numero ON public.siniestros USING btree (numero_siniestro) WHERE (numero_siniestro IS NOT NULL);


--
-- Name: idx_siniestros_numero_caso; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_siniestros_numero_caso ON public.siniestros USING btree (numero_caso) WHERE (numero_caso IS NOT NULL);


--
-- Name: idx_siniestros_numero_siniestro; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_siniestros_numero_siniestro ON public.siniestros USING btree (numero_siniestro);


--
-- Name: idx_siniestros_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_siniestros_persona ON public.siniestros USING btree (persona_id);


--
-- Name: idx_siniestros_poliza; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_siniestros_poliza ON public.siniestros USING btree (poliza_id);


--
-- Name: idx_siniestros_ultimo_movimiento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_siniestros_ultimo_movimiento ON public.siniestros USING btree (fecha_ultimo_movimiento) WHERE ((estado)::text !~~ 'CERRADO%'::text);


--
-- Name: idx_storage_tokens_expiracion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_storage_tokens_expiracion ON public.storage_tokens USING btree (fecha_expiracion);


--
-- Name: idx_storage_tokens_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_storage_tokens_token ON public.storage_tokens USING btree (token);


--
-- Name: idx_tareas_cotizacion_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tareas_cotizacion_id ON public.tareas USING btree (cotizacion_id);


--
-- Name: idx_tareas_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tareas_estado ON public.tareas USING btree (estado);


--
-- Name: idx_tareas_fecha_vencimiento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tareas_fecha_vencimiento ON public.tareas USING btree (fecha_vencimiento);


--
-- Name: idx_tareas_lead_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tareas_lead_id ON public.tareas USING btree (lead_id);


--
-- Name: idx_tareas_oportunidad_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tareas_oportunidad_id ON public.tareas USING btree (oportunidad_id);


--
-- Name: idx_tareas_persona_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tareas_persona_id ON public.tareas USING btree (persona_id);


--
-- Name: idx_tareas_usuario_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tareas_usuario_id ON public.tareas USING btree (usuario_id);


--
-- Name: idx_usuarios_activo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usuarios_activo ON public.usuarios USING btree (activo);


--
-- Name: idx_usuarios_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usuarios_email ON public.usuarios USING btree (email);


--
-- Name: idx_usuarios_rol; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usuarios_rol ON public.usuarios USING btree (rol);


--
-- Name: uq_cotizacion_companias_con_cobertura; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_cotizacion_companias_con_cobertura ON public.cotizacion_companias USING btree (cotizacion_id, compania_id, cobertura_id) WHERE (cobertura_id IS NOT NULL);


--
-- Name: uq_cotizacion_companias_sin_cobertura; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_cotizacion_companias_sin_cobertura ON public.cotizacion_companias USING btree (cotizacion_id, compania_id) WHERE (cobertura_id IS NULL);


--
-- Name: uq_facturacion_periodo_compania_sin_ramo; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_facturacion_periodo_compania_sin_ramo ON public.facturacion USING btree (anio, mes, compania_id) WHERE (ramo_id IS NULL);


--
-- Name: uq_poliza_compania_numero; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_poliza_compania_numero ON public.polizas USING btree (compania_id, numero_poliza) WHERE (compania_id IS NOT NULL);


--
-- Name: catalogos tg_catalogos_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_catalogos_updated_at BEFORE UPDATE ON public.catalogos FOR EACH ROW EXECUTE FUNCTION public.fn_actualizar_updated_at();


--
-- Name: facturacion tg_facturacion_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_facturacion_updated_at BEFORE UPDATE ON public.facturacion FOR EACH ROW EXECUTE FUNCTION public.fn_actualizar_updated_at();


--
-- Name: pdf_procesamientos tg_pdf_procesamientos_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_pdf_procesamientos_touch BEFORE UPDATE ON public.pdf_procesamientos FOR EACH ROW EXECUTE FUNCTION public.trg_pdf_procesamientos_touch();


--
-- Name: personas tg_personas_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_personas_updated_at BEFORE UPDATE ON public.personas FOR EACH ROW EXECUTE FUNCTION public.fn_actualizar_updated_at();


--
-- Name: polizas tg_polizas_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_polizas_updated_at BEFORE UPDATE ON public.polizas FOR EACH ROW EXECUTE FUNCTION public.fn_actualizar_updated_at();


--
-- Name: riesgos tg_riesgos_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_riesgos_updated_at BEFORE UPDATE ON public.riesgos FOR EACH ROW EXECUTE FUNCTION public.fn_actualizar_updated_at();


--
-- Name: polizas tg_sincronizar_estado_persona; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_sincronizar_estado_persona AFTER INSERT OR DELETE OR UPDATE OF estado ON public.polizas FOR EACH ROW EXECUTE FUNCTION public.fn_sincronizar_estado_persona();


--
-- Name: siniestros tg_siniestro_movimiento; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_siniestro_movimiento BEFORE UPDATE ON public.siniestros FOR EACH ROW WHEN ((((old.estado)::text IS DISTINCT FROM (new.estado)::text) OR (old.descripcion IS DISTINCT FROM new.descripcion))) EXECUTE FUNCTION public.fn_actualizar_movimiento_siniestro();


--
-- Name: siniestros tg_siniestros_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_siniestros_updated_at BEFORE UPDATE ON public.siniestros FOR EACH ROW EXECUTE FUNCTION public.fn_actualizar_updated_at();


--
-- Name: cotizaciones trg_cotizacion_numero; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cotizacion_numero BEFORE INSERT ON public.cotizaciones FOR EACH ROW EXECUTE FUNCTION public.generar_numero_cotizacion();


--
-- Name: backups backups_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backups
    ADD CONSTRAINT backups_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: catalogos catalogos_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalogos
    ADD CONSTRAINT catalogos_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.catalogos(id) ON DELETE RESTRICT;


--
-- Name: catalogos catalogos_tipo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalogos
    ADD CONSTRAINT catalogos_tipo_id_fkey FOREIGN KEY (tipo_id) REFERENCES public.tipo_catalogo(id) ON DELETE RESTRICT;


--
-- Name: cotizacion_companias cotizacion_companias_cobertura_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizacion_companias
    ADD CONSTRAINT cotizacion_companias_cobertura_id_fkey FOREIGN KEY (cobertura_id) REFERENCES public.catalogos(id) ON DELETE SET NULL;


--
-- Name: cotizacion_companias cotizacion_companias_compania_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizacion_companias
    ADD CONSTRAINT cotizacion_companias_compania_id_fkey FOREIGN KEY (compania_id) REFERENCES public.catalogos(id) ON DELETE SET NULL;


--
-- Name: cotizacion_companias cotizacion_companias_cotizacion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizacion_companias
    ADD CONSTRAINT cotizacion_companias_cotizacion_id_fkey FOREIGN KEY (cotizacion_id) REFERENCES public.cotizaciones(id) ON DELETE CASCADE;


--
-- Name: cotizaciones cotizaciones_compania_ganadora_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizaciones
    ADD CONSTRAINT cotizaciones_compania_ganadora_id_fkey FOREIGN KEY (compania_ganadora_id) REFERENCES public.catalogos(id) ON DELETE SET NULL;


--
-- Name: cotizaciones cotizaciones_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizaciones
    ADD CONSTRAINT cotizaciones_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: cotizaciones cotizaciones_oportunidad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizaciones
    ADD CONSTRAINT cotizaciones_oportunidad_id_fkey FOREIGN KEY (oportunidad_id) REFERENCES public.oportunidades(id) ON DELETE SET NULL;


--
-- Name: cotizaciones cotizaciones_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizaciones
    ADD CONSTRAINT cotizaciones_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE CASCADE;


--
-- Name: cotizaciones cotizaciones_poliza_generada_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizaciones
    ADD CONSTRAINT cotizaciones_poliza_generada_id_fkey FOREIGN KEY (poliza_generada_id) REFERENCES public.polizas(id) ON DELETE SET NULL;


--
-- Name: cotizaciones cotizaciones_ramo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizaciones
    ADD CONSTRAINT cotizaciones_ramo_id_fkey FOREIGN KEY (ramo_id) REFERENCES public.catalogos(id) ON DELETE SET NULL;


--
-- Name: cotizaciones cotizaciones_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizaciones
    ADD CONSTRAINT cotizaciones_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: email_clicks email_clicks_envio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_clicks
    ADD CONSTRAINT email_clicks_envio_id_fkey FOREIGN KEY (envio_id) REFERENCES public.email_envios(id) ON DELETE CASCADE;


--
-- Name: email_envios email_envios_enviado_por_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_envios
    ADD CONSTRAINT email_envios_enviado_por_usuario_id_fkey FOREIGN KEY (enviado_por_usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: email_envios email_envios_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_envios
    ADD CONSTRAINT email_envios_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE SET NULL;


--
-- Name: email_envios email_envios_poliza_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_envios
    ADD CONSTRAINT email_envios_poliza_id_fkey FOREIGN KEY (poliza_id) REFERENCES public.polizas(id) ON DELETE SET NULL;


--
-- Name: endosos endosos_poliza_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.endosos
    ADD CONSTRAINT endosos_poliza_id_fkey FOREIGN KEY (poliza_id) REFERENCES public.polizas(id) ON DELETE CASCADE;


--
-- Name: errores_sistema errores_sistema_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.errores_sistema
    ADD CONSTRAINT errores_sistema_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: facturacion facturacion_compania_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facturacion
    ADD CONSTRAINT facturacion_compania_id_fkey FOREIGN KEY (compania_id) REFERENCES public.catalogos(id) ON DELETE RESTRICT;


--
-- Name: facturacion facturacion_ramo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facturacion
    ADD CONSTRAINT facturacion_ramo_id_fkey FOREIGN KEY (ramo_id) REFERENCES public.catalogos(id) ON DELETE RESTRICT;


--
-- Name: email_bajas fk_email_bajas_persona; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_bajas
    ADD CONSTRAINT fk_email_bajas_persona FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE SET NULL;


--
-- Name: poliza_archivos fk_poliza_archivos_endoso; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.poliza_archivos
    ADD CONSTRAINT fk_poliza_archivos_endoso FOREIGN KEY (endoso_id) REFERENCES public.endosos(id) ON DELETE CASCADE;


--
-- Name: polizas fk_polizas_asegurado; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.polizas
    ADD CONSTRAINT fk_polizas_asegurado FOREIGN KEY (asegurado_id) REFERENCES public.personas(id) ON DELETE CASCADE;


--
-- Name: polizas fk_polizas_compania; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.polizas
    ADD CONSTRAINT fk_polizas_compania FOREIGN KEY (compania_id) REFERENCES public.catalogos(id) ON DELETE SET NULL;


--
-- Name: polizas fk_polizas_origen; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.polizas
    ADD CONSTRAINT fk_polizas_origen FOREIGN KEY (poliza_origen_id) REFERENCES public.polizas(id) ON DELETE CASCADE;


--
-- Name: polizas fk_polizas_ramo; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.polizas
    ADD CONSTRAINT fk_polizas_ramo FOREIGN KEY (ramo_id) REFERENCES public.catalogos(id) ON DELETE SET NULL;


--
-- Name: polizas fk_polizas_tomador; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.polizas
    ADD CONSTRAINT fk_polizas_tomador FOREIGN KEY (tomador_id) REFERENCES public.personas(id) ON DELETE SET NULL;


--
-- Name: siniestros fk_siniestros_persona; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.siniestros
    ADD CONSTRAINT fk_siniestros_persona FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE CASCADE;


--
-- Name: siniestros fk_siniestros_poliza; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.siniestros
    ADD CONSTRAINT fk_siniestros_poliza FOREIGN KEY (poliza_id) REFERENCES public.polizas(id) ON DELETE CASCADE;


--
-- Name: importacion_jobs importacion_jobs_importacion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.importacion_jobs
    ADD CONSTRAINT importacion_jobs_importacion_id_fkey FOREIGN KEY (importacion_id) REFERENCES public.importaciones(id) ON DELETE CASCADE;


--
-- Name: importacion_lotes importacion_lotes_importacion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.importacion_lotes
    ADD CONSTRAINT importacion_lotes_importacion_id_fkey FOREIGN KEY (importacion_id) REFERENCES public.importaciones(id) ON DELETE CASCADE;


--
-- Name: importacion_registros_dudosos importacion_registros_dudosos_importacion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.importacion_registros_dudosos
    ADD CONSTRAINT importacion_registros_dudosos_importacion_id_fkey FOREIGN KEY (importacion_id) REFERENCES public.importaciones(id) ON DELETE CASCADE;


--
-- Name: importacion_registros_dudosos importacion_registros_dudosos_lote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.importacion_registros_dudosos
    ADD CONSTRAINT importacion_registros_dudosos_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES public.importacion_lotes(id) ON DELETE CASCADE;


--
-- Name: importacion_registros_dudosos importacion_registros_dudosos_resuelto_por_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.importacion_registros_dudosos
    ADD CONSTRAINT importacion_registros_dudosos_resuelto_por_usuario_id_fkey FOREIGN KEY (resuelto_por_usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: importaciones importaciones_compania_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.importaciones
    ADD CONSTRAINT importaciones_compania_id_fkey FOREIGN KEY (compania_id) REFERENCES public.catalogos(id) ON DELETE SET NULL;


--
-- Name: importaciones importaciones_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.importaciones
    ADD CONSTRAINT importaciones_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: interacciones interacciones_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interacciones
    ADD CONSTRAINT interacciones_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: interacciones interacciones_oportunidad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interacciones
    ADD CONSTRAINT interacciones_oportunidad_id_fkey FOREIGN KEY (oportunidad_id) REFERENCES public.oportunidades(id) ON DELETE CASCADE;


--
-- Name: interacciones interacciones_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interacciones
    ADD CONSTRAINT interacciones_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE CASCADE;


--
-- Name: leads leads_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE SET NULL;


--
-- Name: leads leads_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: notificaciones notificaciones_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificaciones
    ADD CONSTRAINT notificaciones_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: oportunidades oportunidades_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oportunidades
    ADD CONSTRAINT oportunidades_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE CASCADE;


--
-- Name: oportunidades oportunidades_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oportunidades
    ADD CONSTRAINT oportunidades_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: pdf_procesamientos pdf_procesamientos_endoso_creado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pdf_procesamientos
    ADD CONSTRAINT pdf_procesamientos_endoso_creado_id_fkey FOREIGN KEY (endoso_creado_id) REFERENCES public.endosos(id) ON DELETE SET NULL;


--
-- Name: pdf_procesamientos pdf_procesamientos_poliza_creada_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pdf_procesamientos
    ADD CONSTRAINT pdf_procesamientos_poliza_creada_id_fkey FOREIGN KEY (poliza_creada_id) REFERENCES public.polizas(id) ON DELETE SET NULL;


--
-- Name: pdf_procesamientos pdf_procesamientos_poliza_origen_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pdf_procesamientos
    ADD CONSTRAINT pdf_procesamientos_poliza_origen_id_fkey FOREIGN KEY (poliza_origen_id) REFERENCES public.polizas(id) ON DELETE SET NULL;


--
-- Name: pdf_procesamientos pdf_procesamientos_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pdf_procesamientos
    ADD CONSTRAINT pdf_procesamientos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: persona_bitacora persona_bitacora_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persona_bitacora
    ADD CONSTRAINT persona_bitacora_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE CASCADE;


--
-- Name: persona_bitacora persona_bitacora_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persona_bitacora
    ADD CONSTRAINT persona_bitacora_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: personas personas_deleted_by_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personas
    ADD CONSTRAINT personas_deleted_by_usuario_id_fkey FOREIGN KEY (deleted_by_usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: personas personas_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personas
    ADD CONSTRAINT personas_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: poliza_archivos poliza_archivos_poliza_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.poliza_archivos
    ADD CONSTRAINT poliza_archivos_poliza_id_fkey FOREIGN KEY (poliza_id) REFERENCES public.polizas(id) ON DELETE CASCADE;


--
-- Name: poliza_bitacora poliza_bitacora_poliza_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.poliza_bitacora
    ADD CONSTRAINT poliza_bitacora_poliza_id_fkey FOREIGN KEY (poliza_id) REFERENCES public.polizas(id) ON DELETE CASCADE;


--
-- Name: poliza_bitacora poliza_bitacora_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.poliza_bitacora
    ADD CONSTRAINT poliza_bitacora_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: polizas polizas_cobertura_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.polizas
    ADD CONSTRAINT polizas_cobertura_id_fkey FOREIGN KEY (cobertura_id) REFERENCES public.catalogos(id);


--
-- Name: polizas_eliminadas polizas_eliminadas_eliminada_por_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.polizas_eliminadas
    ADD CONSTRAINT polizas_eliminadas_eliminada_por_usuario_id_fkey FOREIGN KEY (eliminada_por_usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: polizas polizas_refacturacion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.polizas
    ADD CONSTRAINT polizas_refacturacion_id_fkey FOREIGN KEY (refacturacion_id) REFERENCES public.catalogos(id);


--
-- Name: polizas polizas_vigencia_tipo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.polizas
    ADD CONSTRAINT polizas_vigencia_tipo_id_fkey FOREIGN KEY (vigencia_tipo_id) REFERENCES public.catalogos(id);


--
-- Name: portal_cliente_accesos portal_cliente_accesos_creado_por_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_cliente_accesos
    ADD CONSTRAINT portal_cliente_accesos_creado_por_usuario_id_fkey FOREIGN KEY (creado_por_usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: portal_cliente_accesos portal_cliente_accesos_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_cliente_accesos
    ADD CONSTRAINT portal_cliente_accesos_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE CASCADE;


--
-- Name: postits postits_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postits
    ADD CONSTRAINT postits_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: restauraciones restauraciones_backup_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restauraciones
    ADD CONSTRAINT restauraciones_backup_id_fkey FOREIGN KEY (backup_id) REFERENCES public.backups(id) ON DELETE SET NULL;


--
-- Name: restauraciones restauraciones_pre_backup_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restauraciones
    ADD CONSTRAINT restauraciones_pre_backup_id_fkey FOREIGN KEY (pre_backup_id) REFERENCES public.backups(id) ON DELETE SET NULL;


--
-- Name: restauraciones restauraciones_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restauraciones
    ADD CONSTRAINT restauraciones_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: riesgos riesgos_poliza_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.riesgos
    ADD CONSTRAINT riesgos_poliza_id_fkey FOREIGN KEY (poliza_id) REFERENCES public.polizas(id) ON DELETE CASCADE;


--
-- Name: sesiones sesiones_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesiones
    ADD CONSTRAINT sesiones_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: siniestro_archivos siniestro_archivos_siniestro_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.siniestro_archivos
    ADD CONSTRAINT siniestro_archivos_siniestro_id_fkey FOREIGN KEY (siniestro_id) REFERENCES public.siniestros(id) ON DELETE CASCADE;


--
-- Name: siniestro_bitacora siniestro_bitacora_siniestro_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.siniestro_bitacora
    ADD CONSTRAINT siniestro_bitacora_siniestro_id_fkey FOREIGN KEY (siniestro_id) REFERENCES public.siniestros(id) ON DELETE CASCADE;


--
-- Name: siniestro_bitacora siniestro_bitacora_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.siniestro_bitacora
    ADD CONSTRAINT siniestro_bitacora_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: siniestros siniestros_deleted_by_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.siniestros
    ADD CONSTRAINT siniestros_deleted_by_usuario_id_fkey FOREIGN KEY (deleted_by_usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: siniestros siniestros_riesgo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.siniestros
    ADD CONSTRAINT siniestros_riesgo_id_fkey FOREIGN KEY (riesgo_id) REFERENCES public.riesgos(id) ON DELETE SET NULL;


--
-- Name: storage_tokens storage_tokens_creado_por_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_tokens
    ADD CONSTRAINT storage_tokens_creado_por_usuario_id_fkey FOREIGN KEY (creado_por_usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: tareas tareas_cotizacion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tareas
    ADD CONSTRAINT tareas_cotizacion_id_fkey FOREIGN KEY (cotizacion_id) REFERENCES public.cotizaciones(id) ON DELETE SET NULL;


--
-- Name: tareas tareas_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tareas
    ADD CONSTRAINT tareas_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: tareas tareas_oportunidad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tareas
    ADD CONSTRAINT tareas_oportunidad_id_fkey FOREIGN KEY (oportunidad_id) REFERENCES public.oportunidades(id) ON DELETE SET NULL;


--
-- Name: tareas tareas_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tareas
    ADD CONSTRAINT tareas_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE CASCADE;


--
-- Name: tareas tareas_poliza_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tareas
    ADD CONSTRAINT tareas_poliza_id_fkey FOREIGN KEY (poliza_id) REFERENCES public.polizas(id) ON DELETE SET NULL;


--
-- Name: tareas tareas_siniestro_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tareas
    ADD CONSTRAINT tareas_siniestro_id_fkey FOREIGN KEY (siniestro_id) REFERENCES public.siniestros(id) ON DELETE SET NULL;


--
-- Name: tareas tareas_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tareas
    ADD CONSTRAINT tareas_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: telefonos_asistencia_companias telefonos_asistencia_companias_compania_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telefonos_asistencia_companias
    ADD CONSTRAINT telefonos_asistencia_companias_compania_id_fkey FOREIGN KEY (compania_id) REFERENCES public.catalogos(id) ON DELETE CASCADE;


--
-- Name: configuracion Acceso total configuracion; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Acceso total configuracion" ON public.configuracion USING (true) WITH CHECK (true);


--
-- Name: catalogos Lectura libre autenticados; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Lectura libre autenticados" ON public.catalogos FOR SELECT TO authenticated USING (true);


--
-- Name: tipo_catalogo Lectura libre autenticados; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Lectura libre autenticados" ON public.tipo_catalogo FOR SELECT TO authenticated USING (true);


--
-- Name: notificaciones Notificaciones propias; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Notificaciones propias" ON public.notificaciones TO authenticated USING ((usuario_id = auth.uid()));


--
-- Name: anthropic_modelos_cache Permitir todo en anthropic_modelos_cache; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en anthropic_modelos_cache" ON public.anthropic_modelos_cache USING (true) WITH CHECK (true);


--
-- Name: backups Permitir todo en backups; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en backups" ON public.backups USING (true) WITH CHECK (true);


--
-- Name: configuracion_backups Permitir todo en configuracion_backups; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en configuracion_backups" ON public.configuracion_backups USING (true) WITH CHECK (true);


--
-- Name: configuracion_comunicaciones Permitir todo en configuracion_comunicaciones; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en configuracion_comunicaciones" ON public.configuracion_comunicaciones USING (true) WITH CHECK (true);


--
-- Name: configuracion_correos Permitir todo en configuracion_correos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en configuracion_correos" ON public.configuracion_correos USING (true) WITH CHECK (true);


--
-- Name: configuracion_formulario_publico Permitir todo en configuracion_formulario_publico; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en configuracion_formulario_publico" ON public.configuracion_formulario_publico USING (true) WITH CHECK (true);


--
-- Name: configuracion_notificaciones Permitir todo en configuracion_notificaciones; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en configuracion_notificaciones" ON public.configuracion_notificaciones USING (true) WITH CHECK (true);


--
-- Name: configuracion_portal_cliente Permitir todo en configuracion_portal_cliente; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en configuracion_portal_cliente" ON public.configuracion_portal_cliente USING (true) WITH CHECK (true);


--
-- Name: cotizacion_companias Permitir todo en cotizacion_companias; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en cotizacion_companias" ON public.cotizacion_companias USING (true) WITH CHECK (true);


--
-- Name: cotizaciones Permitir todo en cotizaciones; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en cotizaciones" ON public.cotizaciones USING (true) WITH CHECK (true);


--
-- Name: email_bajas Permitir todo en email_bajas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en email_bajas" ON public.email_bajas USING (true) WITH CHECK (true);


--
-- Name: email_clicks Permitir todo en email_clicks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en email_clicks" ON public.email_clicks USING (true) WITH CHECK (true);


--
-- Name: email_envios Permitir todo en email_envios; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en email_envios" ON public.email_envios USING (true) WITH CHECK (true);


--
-- Name: errores_sistema Permitir todo en errores_sistema; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en errores_sistema" ON public.errores_sistema USING (true) WITH CHECK (true);


--
-- Name: importacion_jobs Permitir todo en importacion_jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en importacion_jobs" ON public.importacion_jobs USING (true) WITH CHECK (true);


--
-- Name: importacion_lotes Permitir todo en importacion_lotes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en importacion_lotes" ON public.importacion_lotes USING (true) WITH CHECK (true);


--
-- Name: importacion_registros_dudosos Permitir todo en importacion_registros_dudosos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en importacion_registros_dudosos" ON public.importacion_registros_dudosos USING (true) WITH CHECK (true);


--
-- Name: importaciones Permitir todo en importaciones; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en importaciones" ON public.importaciones USING (true) WITH CHECK (true);


--
-- Name: interacciones Permitir todo en interacciones; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en interacciones" ON public.interacciones USING (true) WITH CHECK (true);


--
-- Name: leads Permitir todo en leads; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en leads" ON public.leads USING (true) WITH CHECK (true);


--
-- Name: oportunidades Permitir todo en oportunidades; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en oportunidades" ON public.oportunidades USING (true) WITH CHECK (true);


--
-- Name: pdf_procesamientos Permitir todo en pdf_procesamientos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en pdf_procesamientos" ON public.pdf_procesamientos USING (true) WITH CHECK (true);


--
-- Name: plantillas_email Permitir todo en plantillas_email; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en plantillas_email" ON public.plantillas_email USING (true) WITH CHECK (true);


--
-- Name: poliza_bitacora Permitir todo en poliza_bitacora; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en poliza_bitacora" ON public.poliza_bitacora USING (true) WITH CHECK (true);


--
-- Name: polizas_eliminadas Permitir todo en polizas_eliminadas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en polizas_eliminadas" ON public.polizas_eliminadas USING (true) WITH CHECK (true);


--
-- Name: portal_cliente_accesos Permitir todo en portal_cliente_accesos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en portal_cliente_accesos" ON public.portal_cliente_accesos USING (true) WITH CHECK (true);


--
-- Name: postits Permitir todo en postits; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en postits" ON public.postits USING (true) WITH CHECK (true);


--
-- Name: rate_limit_buckets Permitir todo en rate_limit_buckets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en rate_limit_buckets" ON public.rate_limit_buckets USING (true) WITH CHECK (true);


--
-- Name: restauraciones Permitir todo en restauraciones; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en restauraciones" ON public.restauraciones USING (true) WITH CHECK (true);


--
-- Name: sesiones Permitir todo en sesiones; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en sesiones" ON public.sesiones USING (true) WITH CHECK (true);


--
-- Name: siniestros_contador Permitir todo en siniestros_contador; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en siniestros_contador" ON public.siniestros_contador USING (true) WITH CHECK (true);


--
-- Name: storage_tokens Permitir todo en storage_tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en storage_tokens" ON public.storage_tokens USING (true) WITH CHECK (true);


--
-- Name: tareas Permitir todo en tareas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en tareas" ON public.tareas USING (true) WITH CHECK (true);


--
-- Name: telefonos_asistencia_companias Permitir todo en telefonos_asistencia_companias; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en telefonos_asistencia_companias" ON public.telefonos_asistencia_companias USING (true) WITH CHECK (true);


--
-- Name: usuarios Permitir todo en usuarios; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitir todo en usuarios" ON public.usuarios USING (true) WITH CHECK (true);


--
-- Name: poliza_archivos acceso_archivos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY acceso_archivos ON public.poliza_archivos USING (true);


--
-- Name: anthropic_modelos_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.anthropic_modelos_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: backups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.backups ENABLE ROW LEVEL SECURITY;

--
-- Name: catalogos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.catalogos ENABLE ROW LEVEL SECURITY;

--
-- Name: configuracion; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.configuracion ENABLE ROW LEVEL SECURITY;

--
-- Name: configuracion_backups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.configuracion_backups ENABLE ROW LEVEL SECURITY;

--
-- Name: configuracion_comunicaciones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.configuracion_comunicaciones ENABLE ROW LEVEL SECURITY;

--
-- Name: configuracion_correos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.configuracion_correos ENABLE ROW LEVEL SECURITY;

--
-- Name: configuracion_formulario_publico; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.configuracion_formulario_publico ENABLE ROW LEVEL SECURITY;

--
-- Name: configuracion_notificaciones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.configuracion_notificaciones ENABLE ROW LEVEL SECURITY;

--
-- Name: configuracion_portal_cliente; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.configuracion_portal_cliente ENABLE ROW LEVEL SECURITY;

--
-- Name: cotizacion_companias; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cotizacion_companias ENABLE ROW LEVEL SECURITY;

--
-- Name: cotizaciones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cotizaciones ENABLE ROW LEVEL SECURITY;

--
-- Name: facturacion desarrollo_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY desarrollo_delete ON public.facturacion FOR DELETE USING (true);


--
-- Name: polizas desarrollo_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY desarrollo_delete ON public.polizas FOR DELETE USING (true);


--
-- Name: riesgos desarrollo_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY desarrollo_delete ON public.riesgos FOR DELETE USING (true);


--
-- Name: facturacion desarrollo_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY desarrollo_insert ON public.facturacion FOR INSERT WITH CHECK (true);


--
-- Name: polizas desarrollo_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY desarrollo_insert ON public.polizas FOR INSERT WITH CHECK (true);


--
-- Name: riesgos desarrollo_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY desarrollo_insert ON public.riesgos FOR INSERT WITH CHECK (true);


--
-- Name: facturacion desarrollo_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY desarrollo_select ON public.facturacion FOR SELECT USING (true);


--
-- Name: polizas desarrollo_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY desarrollo_select ON public.polizas FOR SELECT USING (true);


--
-- Name: riesgos desarrollo_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY desarrollo_select ON public.riesgos FOR SELECT USING (true);


--
-- Name: facturacion desarrollo_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY desarrollo_update ON public.facturacion FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: polizas desarrollo_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY desarrollo_update ON public.polizas FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: riesgos desarrollo_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY desarrollo_update ON public.riesgos FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: email_bajas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_bajas ENABLE ROW LEVEL SECURITY;

--
-- Name: email_clicks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_clicks ENABLE ROW LEVEL SECURITY;

--
-- Name: email_envios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_envios ENABLE ROW LEVEL SECURITY;

--
-- Name: endosos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.endosos ENABLE ROW LEVEL SECURITY;

--
-- Name: endosos endosos_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY endosos_all ON public.endosos USING (true) WITH CHECK (true);


--
-- Name: errores_sistema; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.errores_sistema ENABLE ROW LEVEL SECURITY;

--
-- Name: catalogos escritura_catalogos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY escritura_catalogos ON public.catalogos USING (true);


--
-- Name: facturacion; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.facturacion ENABLE ROW LEVEL SECURITY;

--
-- Name: importacion_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.importacion_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: importacion_lotes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.importacion_lotes ENABLE ROW LEVEL SECURITY;

--
-- Name: importacion_registros_dudosos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.importacion_registros_dudosos ENABLE ROW LEVEL SECURITY;

--
-- Name: importaciones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.importaciones ENABLE ROW LEVEL SECURITY;

--
-- Name: interacciones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.interacciones ENABLE ROW LEVEL SECURITY;

--
-- Name: leads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

--
-- Name: catalogos lectura_publica_catalogos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lectura_publica_catalogos ON public.catalogos FOR SELECT USING (true);


--
-- Name: tipo_catalogo lectura_publica_tipo_catalogo; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lectura_publica_tipo_catalogo ON public.tipo_catalogo FOR SELECT USING (true);


--
-- Name: notificaciones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;

--
-- Name: oportunidades; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.oportunidades ENABLE ROW LEVEL SECURITY;

--
-- Name: pdf_procesamientos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pdf_procesamientos ENABLE ROW LEVEL SECURITY;

--
-- Name: persona_bitacora; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.persona_bitacora ENABLE ROW LEVEL SECURITY;

--
-- Name: persona_bitacora persona_bitacora_select_anon; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY persona_bitacora_select_anon ON public.persona_bitacora FOR SELECT USING (true);


--
-- Name: personas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.personas ENABLE ROW LEVEL SECURITY;

--
-- Name: personas personas_select_anon; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY personas_select_anon ON public.personas FOR SELECT USING (true);


--
-- Name: plantillas_email; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.plantillas_email ENABLE ROW LEVEL SECURITY;

--
-- Name: poliza_archivos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.poliza_archivos ENABLE ROW LEVEL SECURITY;

--
-- Name: poliza_bitacora; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.poliza_bitacora ENABLE ROW LEVEL SECURITY;

--
-- Name: polizas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.polizas ENABLE ROW LEVEL SECURITY;

--
-- Name: polizas_eliminadas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.polizas_eliminadas ENABLE ROW LEVEL SECURITY;

--
-- Name: portal_cliente_accesos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.portal_cliente_accesos ENABLE ROW LEVEL SECURITY;

--
-- Name: postits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.postits ENABLE ROW LEVEL SECURITY;

--
-- Name: rate_limit_buckets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

--
-- Name: restauraciones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.restauraciones ENABLE ROW LEVEL SECURITY;

--
-- Name: riesgos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.riesgos ENABLE ROW LEVEL SECURITY;

--
-- Name: sesiones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sesiones ENABLE ROW LEVEL SECURITY;

--
-- Name: siniestro_archivos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.siniestro_archivos ENABLE ROW LEVEL SECURITY;

--
-- Name: siniestro_archivos siniestro_archivos_select_anon; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY siniestro_archivos_select_anon ON public.siniestro_archivos FOR SELECT USING (true);


--
-- Name: siniestro_bitacora; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.siniestro_bitacora ENABLE ROW LEVEL SECURITY;

--
-- Name: siniestro_bitacora siniestro_bitacora_select_anon; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY siniestro_bitacora_select_anon ON public.siniestro_bitacora FOR SELECT USING (true);


--
-- Name: siniestros; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.siniestros ENABLE ROW LEVEL SECURITY;

--
-- Name: siniestros_contador; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.siniestros_contador ENABLE ROW LEVEL SECURITY;

--
-- Name: siniestros siniestros_select_anon; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY siniestros_select_anon ON public.siniestros FOR SELECT USING (true);


--
-- Name: storage_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.storage_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: tareas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tareas ENABLE ROW LEVEL SECURITY;

--
-- Name: telefonos_asistencia_companias; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.telefonos_asistencia_companias ENABLE ROW LEVEL SECURITY;

--
-- Name: tipo_catalogo; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tipo_catalogo ENABLE ROW LEVEL SECURITY;

--
-- Name: usuarios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--


-- ============================================================================
-- Baseline marker: el schema dumpeado arriba ya incluye el resultado de las
-- migraciones 001-044 que existían al momento del dump (2026-05-06). Las
-- marcamos como aplicadas implícitamente para que aplicar-migraciones.sh las
-- skipee y solo ejecute las nuevas (045+) en futuras actualizaciones.
--
-- La tabla migraciones_aplicadas la crea aplicar-migraciones.sh ANTES de
-- correr este archivo. El nombre de schema lo calificamos explícitamente
-- porque el dump arriba dejó el search_path vacío.
-- ============================================================================
INSERT INTO public.migraciones_aplicadas (nombre) VALUES
  ('001_siniestro_estados.sql'),
  ('002_facturacion.sql'),
  ('003_postits.sql'),
  ('004_interacciones.sql'),
  ('005_storage_tokens.sql'),
  ('006_rate_limit_buckets.sql'),
  ('007_portal_cliente.sql'),
  ('008_endosos_y_agente_pdf.sql'),
  ('009_poliza_bitacora.sql'),
  ('010_backups_crmseg.sql'),
  ('011_restauraciones.sql'),
  ('012_backups_sin_cifrado.sql'),
  ('013_email_system_completo.sql'),
  ('014_emails_sistema_unificado.sql'),
  ('015_sistema_errores.sql'),
  ('016_error_critico_evento.sql'),
  ('017_reconciliacion_final_db.sql'),
  ('018_eliminar_fks_duplicadas.sql'),
  ('019_auditoria_reparacion.sql'),
  ('020_anthropic_familia_dinamica.sql'),
  ('021_tipo_riesgo_dinamico.sql'),
  ('022_endosos_numero_atomico_y_bitacora_edicion.sql'),
  ('023_polizas_eliminadas_audit.sql'),
  ('024_vista_polizas_pendientes_renovar.sql'),
  ('025_persona_bitacora_y_papelera.sql'),
  ('026_personas_rls_efectiva.sql'),
  ('027_siniestros_bitacora_y_papelera.sql'),
  ('028_siniestros_rls_efectiva.sql'),
  ('029_limpiar_rls_legacy.sql'),
  ('030_persona_bitacora_rls_efectiva.sql'),
  ('031_notif_denuncia_publica.sql'),
  ('032_urls_publicas_configuracion.sql'),
  ('033_vista_polizas_por_vencer_soft_delete.sql'),
  ('034_facturacion_constraints.sql'),
  ('035_interacciones_persona_id.sql'),
  ('036_cotizaciones_fixes.sql'),
  ('037_cotizacion_templates.sql'),
  ('038_color_marca.sql'),
  ('039_polizas_origen_creacion.sql'),
  ('040_siniestros_en_tramite.sql'),
  ('041_bienvenida_poliza_template.sql'),
  ('042_portal_cliente_token_hash.sql'),
  ('043_sugerencia_correccion_portal.sql'),
  ('044_error_critico_plantilla_humana.sql')
ON CONFLICT (nombre) DO NOTHING;

