-- ============================================================
-- 114 — Soporte de leads como destinatarios de campañas
-- ============================================================
-- Hasta acá el motor de campañas solo enviaba a `personas` (clientes o
-- prospectos convertidos). Los `leads` (no convertidos, descartados, etc.)
-- no eran alcanzables por audiencias/campañas.
--
-- Esta migración agrega:
--   1) `email_envios.lead_id` — tracking del destinatario cuando es un lead.
--   2) `mailing_audiencias.ids_leads[]` — para audiencias MANUAL con leads.
--   3) Extiende `filtro_jsonb` documentando los nuevos criterios para
--      audiencias FILTRO (`incluir_personas`, `incluir_leads`, `leads_*`).
--
-- El motor (`aplicarFiltroAudiencia` + `ejecutarCampana`) se actualiza en
-- código para resolver leads además de personas.
-- ============================================================

-- 1) email_envios.lead_id (tracking cuando el destinatario es un lead)
ALTER TABLE public.email_envios
  ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_email_envios_lead
  ON public.email_envios (lead_id) WHERE lead_id IS NOT NULL;

-- 2) mailing_audiencias.ids_leads[] (audiencias MANUAL con leads)
ALTER TABLE public.mailing_audiencias
  ADD COLUMN IF NOT EXISTS ids_leads UUID[] DEFAULT '{}'::uuid[] NOT NULL;

-- Constraint de MANUAL: hoy exige ids_personas > 0. La reemplazamos por
-- una que permita ids_personas O ids_leads no vacío.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mailing_audiencias_manual_check'
      AND conrelid = 'public.mailing_audiencias'::regclass
  ) THEN
    ALTER TABLE public.mailing_audiencias
      DROP CONSTRAINT mailing_audiencias_manual_check;
  END IF;
END $$;

-- No agregamos constraint nuevo — la validación queda en el endpoint API
-- (donde tenemos mejor mensaje de error) para no bloquear ediciones
-- parciales durante el flujo del wizard.

-- 3) Los criterios nuevos para filtro_jsonb (FILTRO):
--    {
--      "incluir_personas": true,            (default true si no viene)
--      "incluir_leads": false,              (default false)
--      "leads_estado": ["DESCARTADO"],      (string[] — NUEVO/CONTACTADO/CONVERTIDO/DESCARTADO)
--      "leads_motivo_descarte_ilike": "precio",  (string — ILIKE %texto%)
--      "leads_fuente": ["WEB"],             (string[] opcional — futuro)
--      "leads_nivel_interes": ["ALTO"],     (string[] opcional — futuro)
--      "leads_acepta_marketing": true       (bool opcional — leads NO tienen ese
--                                            campo actualmente, se ignora)
--    }
--
-- No hay cambio de schema para eso — todo va en filtro_jsonb existente.
