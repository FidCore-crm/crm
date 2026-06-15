-- Migración 079: módulo de mailings (separado de los emails automáticos).
--
-- Filosofía: las plantillas, audiencias y campañas viven en tablas propias del
-- módulo. NO se mezclan con `plantillas_email` (que son las 5+ plantillas
-- automáticas del sistema configurables solo desde Configuración).
--
-- Tablas:
--   - mailing_plantillas: plantillas reutilizables que el PAS arma para sus
--     mailings (promociones, avisos, felicitaciones, etc.).
--   - mailing_audiencias: segmentos guardados de la cartera (filtro de criterios
--     o lista manual). Se usan en envíos masivos y campañas.
--   - mailing_campanas: campañas reutilizables (audiencia + plantilla + schedule
--     + métricas). Sprint 2.

BEGIN;

-- ============================================================================
-- mailing_plantillas
-- ============================================================================
-- Estructura igual a `plantillas_email` para que el editor (EditorPlantillaModal)
-- se pueda reusar visualmente, pero como entidad separada — son las plantillas
-- del PAS para sus mailings activos, no las 5 automáticas del sistema.

CREATE TABLE IF NOT EXISTS public.mailing_plantillas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo VARCHAR(80) NOT NULL UNIQUE,          -- slug interno
  nombre VARCHAR(200) NOT NULL,                -- nombre display
  descripcion TEXT,

  -- Mismos 4 campos editables que las automáticas (asunto + saludo + cuerpo + cierre)
  asunto VARCHAR(300) NOT NULL,
  saludo TEXT NOT NULL,
  cuerpo TEXT NOT NULL,
  cierre TEXT NOT NULL,

  -- CTA opcional (botón al final del cuerpo)
  cta_texto VARCHAR(80),
  cta_url VARCHAR(500),

  -- Variables disponibles (lista de strings, ej: ['nombre','apellido','titulo'])
  -- Sirve para mostrar los chips de variables en el editor.
  variables_disponibles TEXT[] DEFAULT '{nombre,apellido,email,productora_nombre,productora_telefono,productora_email}'::text[],

  activa BOOLEAN NOT NULL DEFAULT true,
  usuario_creador_id UUID REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mailing_plantillas_activa
  ON public.mailing_plantillas (activa)
  WHERE activa = true;

DROP TRIGGER IF EXISTS tg_mailing_plantillas_updated_at ON public.mailing_plantillas;
CREATE TRIGGER tg_mailing_plantillas_updated_at
  BEFORE UPDATE ON public.mailing_plantillas
  FOR EACH ROW EXECUTE FUNCTION public.fn_actualizar_updated_at();

ALTER TABLE public.mailing_plantillas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mailing_plantillas_select" ON public.mailing_plantillas;
CREATE POLICY "mailing_plantillas_select" ON public.mailing_plantillas
  FOR SELECT TO authenticated
  USING (fn_es_admin_actual());

DROP POLICY IF EXISTS "mailing_plantillas_modify" ON public.mailing_plantillas;
CREATE POLICY "mailing_plantillas_modify" ON public.mailing_plantillas
  FOR ALL TO authenticated
  USING (fn_es_admin_actual())
  WITH CHECK (fn_es_admin_actual());

-- ============================================================================
-- mailing_audiencias
-- ============================================================================
-- Segmentos de cartera guardados. Hay 2 tipos:
--   - FILTRO: el segmento se reconstruye dinámicamente al momento de usarlo,
--     aplicando los criterios JSON sobre personas + pólizas.
--   - MANUAL: lista fija de persona_id seleccionada por el admin. No cambia.
--
-- Estructura de filtro_jsonb (tipo FILTRO):
--   {
--     "estado_persona": ["ACTIVO", "PROSPECTO"],
--     "tipo_persona": ["FISICA"],
--     "acepta_marketing": true,
--     "origen": ["WEB", "REFERIDO"],
--     "provincia": ["Buenos Aires"],
--     "compania_ids": ["uuid1", "uuid2"],
--     "ramo_ids": ["uuid3"],
--     "estado_poliza": ["VIGENTE"],
--     "vencimiento_proximo_dias": 30,
--     "vencidas_hace_dias": null,
--     "con_polizas_vigentes": true,
--     "antiguedad_cliente_dias_min": null,
--     "antiguedad_cliente_dias_max": null
--   }
-- Todos los campos opcionales — solo se aplican los presentes.

CREATE TABLE IF NOT EXISTS public.mailing_audiencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(200) NOT NULL,
  descripcion TEXT,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('FILTRO', 'MANUAL')),

  -- Solo uno se usa según el tipo
  filtro_jsonb JSONB,                            -- tipo=FILTRO
  ids_personas UUID[] DEFAULT '{}'::uuid[],      -- tipo=MANUAL

  -- Snapshot cacheado del último preview (rendimiento, no es la fuente de verdad)
  ultima_cantidad INTEGER,
  ultimo_preview_en TIMESTAMPTZ,

  activa BOOLEAN NOT NULL DEFAULT true,
  usuario_creador_id UUID REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mailing_audiencias_activa
  ON public.mailing_audiencias (activa)
  WHERE activa = true;

DROP TRIGGER IF EXISTS tg_mailing_audiencias_updated_at ON public.mailing_audiencias;
CREATE TRIGGER tg_mailing_audiencias_updated_at
  BEFORE UPDATE ON public.mailing_audiencias
  FOR EACH ROW EXECUTE FUNCTION public.fn_actualizar_updated_at();

ALTER TABLE public.mailing_audiencias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mailing_audiencias_select" ON public.mailing_audiencias;
CREATE POLICY "mailing_audiencias_select" ON public.mailing_audiencias
  FOR SELECT TO authenticated
  USING (fn_es_admin_actual());

DROP POLICY IF EXISTS "mailing_audiencias_modify" ON public.mailing_audiencias;
CREATE POLICY "mailing_audiencias_modify" ON public.mailing_audiencias
  FOR ALL TO authenticated
  USING (fn_es_admin_actual())
  WITH CHECK (fn_es_admin_actual());

COMMIT;
