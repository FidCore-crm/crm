-- ============================================================
-- 132 — Trazabilidad de denuncias desde el portal público
-- ============================================================
-- Feedback del PAS: al recibir una denuncia por /denuncia solo se
-- guardaba IP en el texto de la bitácora. No había forma clara de
-- ver qué dispositivo, browser, OS, referer, país, idioma, etc.
-- usó el asegurado. Trazabilidad para auditoría y para poder
-- detectar denuncias fraudulentas o suplantación.
--
-- Se agrega columna JSONB `denuncia_metadata` en `siniestros` con
-- todos los datos del request. Nullable — solo se llena cuando
-- origen_creacion=PORTAL_CLIENTE.
-- ============================================================

ALTER TABLE public.siniestros
  ADD COLUMN IF NOT EXISTS denuncia_metadata JSONB;

COMMENT ON COLUMN public.siniestros.denuncia_metadata IS
  'Metadata del request cuando el siniestro se creó desde /denuncia (portal público). '
  'Estructura: { ip, user_agent, browser: {nombre, version}, os: {nombre, version}, '
  'dispositivo: "movil"|"tablet"|"desktop", pais, idioma, referer, fecha_hora, hora_local }.';
