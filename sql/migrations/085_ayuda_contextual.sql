-- Migración 085 — Sistema de ayuda contextual (tooltips + centro de ayuda).
--
-- Agrega una preferencia por usuario para mostrar/ocultar los tooltips de
-- ayuda contextual del CRM. El admin (y cada usuario) puede apagarlos cuando
-- ya conozca el sistema y los ve como ruido visual.
--
-- El Centro de Ayuda (`/crm/ayuda`) sigue accesible siempre — esta
-- preferencia controla solo los íconos `?` inline dentro de los módulos.

BEGIN;

ALTER TABLE public.usuarios_perfil
  ADD COLUMN IF NOT EXISTS mostrar_ayuda_contextual BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.usuarios_perfil.mostrar_ayuda_contextual IS
  'Si true (default), se muestran los íconos ? de ayuda contextual dentro de los módulos. El Centro de Ayuda /crm/ayuda no se ve afectado.';

COMMIT;
