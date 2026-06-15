-- Migración 080: campañas guardadas del módulo de mailings.
--
-- Una campaña es una agrupación reutilizable y trackeable de:
--   - audiencia (puede ser una mailing_audiencia guardada o un snapshot ad-hoc)
--   - plantilla (puede ser mailing_plantilla o textos libres)
--   - schedule (enviar ahora o programar para fecha futura)
--   - métricas en vivo (total/enviados/aperturas/clicks/fallidos)
--
-- Estados:
--   BORRADOR    — creada, sin disparar todavía
--   PROGRAMADA  — schedule futuro, espera al cron
--   EJECUTANDO  — el cron la está procesando (loop de envíos)
--   COMPLETADA  — terminó OK
--   PAUSADA     — el admin la detuvo a mitad
--   CANCELADA   — el admin la canceló antes de empezar
--
-- Tracking de progreso: la columna `personas_procesadas_ids` se llena
-- incrementalmente para reanudar si el cron se interrumpe.

BEGIN;

CREATE TABLE IF NOT EXISTS public.mailing_campanas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(200) NOT NULL,
  descripcion TEXT,

  -- Destinatarios: 2 modos
  --   audiencia_id: referencia a mailing_audiencias (puede ser FILTRO dinámico
  --     que se resuelve al momento de ejecutar — ojo: la lista puede cambiar
  --     entre el momento de programar y el de ejecutar)
  --   personas_ids: snapshot fijo guardado al crear (lista inmutable)
  audiencia_id UUID REFERENCES public.mailing_audiencias(id) ON DELETE SET NULL,
  personas_ids UUID[] DEFAULT '{}'::uuid[],

  -- Mensaje: 2 modos
  --   mailing_plantilla_id: referencia a una plantilla guardada
  --   asunto_libre + cuerpo_libre: textos ad-hoc (modo "sin plantilla")
  mailing_plantilla_id UUID REFERENCES public.mailing_plantillas(id) ON DELETE SET NULL,
  asunto_libre VARCHAR(300),
  cuerpo_libre TEXT,
  -- Override del asunto cuando se usa plantilla (opcional)
  asunto_override VARCHAR(300),

  -- Schedule
  programada_para TIMESTAMPTZ,  -- NULL = enviar al confirmar; valor = ejecutar a esa hora

  -- Estado + tracking
  estado VARCHAR(20) NOT NULL DEFAULT 'BORRADOR'
    CHECK (estado IN ('BORRADOR', 'PROGRAMADA', 'EJECUTANDO', 'COMPLETADA', 'PAUSADA', 'CANCELADA')),
  personas_procesadas_ids UUID[] DEFAULT '{}'::uuid[],   -- ya procesadas (para reanudar)

  -- Métricas (se actualizan en vivo durante la ejecución)
  total_destinatarios INTEGER NOT NULL DEFAULT 0,
  enviados INTEGER NOT NULL DEFAULT 0,
  fallidos INTEGER NOT NULL DEFAULT 0,
  excluidos INTEGER NOT NULL DEFAULT 0,

  fecha_inicio_ejecucion TIMESTAMPTZ,
  fecha_fin_ejecucion TIMESTAMPTZ,
  ultimo_error TEXT,

  -- Auditoría
  usuario_creador_id UUID REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Listado por fecha
CREATE INDEX IF NOT EXISTS idx_mailing_campanas_created
  ON public.mailing_campanas (created_at DESC);

-- Para el cron: buscar campañas listas para ejecutar
CREATE INDEX IF NOT EXISTS idx_mailing_campanas_programada
  ON public.mailing_campanas (estado, programada_para)
  WHERE estado = 'PROGRAMADA';

-- Trigger updated_at
DROP TRIGGER IF EXISTS tg_mailing_campanas_updated_at ON public.mailing_campanas;
CREATE TRIGGER tg_mailing_campanas_updated_at
  BEFORE UPDATE ON public.mailing_campanas
  FOR EACH ROW EXECUTE FUNCTION public.fn_actualizar_updated_at();

-- RLS: admin-only
ALTER TABLE public.mailing_campanas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mailing_campanas_select" ON public.mailing_campanas;
CREATE POLICY "mailing_campanas_select" ON public.mailing_campanas
  FOR SELECT TO authenticated
  USING (fn_es_admin_actual());

DROP POLICY IF EXISTS "mailing_campanas_modify" ON public.mailing_campanas;
CREATE POLICY "mailing_campanas_modify" ON public.mailing_campanas
  FOR ALL TO authenticated
  USING (fn_es_admin_actual())
  WITH CHECK (fn_es_admin_actual());

-- Validación: debe haber audiencia O lista de personas (no ambas vacías)
ALTER TABLE public.mailing_campanas DROP CONSTRAINT IF EXISTS chk_destinatarios;
ALTER TABLE public.mailing_campanas ADD CONSTRAINT chk_destinatarios
  CHECK (audiencia_id IS NOT NULL OR cardinality(personas_ids) > 0);

-- Validación: debe haber plantilla O texto libre
ALTER TABLE public.mailing_campanas DROP CONSTRAINT IF EXISTS chk_mensaje;
ALTER TABLE public.mailing_campanas ADD CONSTRAINT chk_mensaje
  CHECK (
    mailing_plantilla_id IS NOT NULL
    OR (asunto_libre IS NOT NULL AND cuerpo_libre IS NOT NULL)
  );

COMMIT;
