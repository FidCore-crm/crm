-- Migración 066: mover 25 FKs de `usuarios` (legacy) a `usuarios_perfil` (nueva con Supabase Auth).
--
-- Contexto: la migración 055 hizo el cutover a Supabase Auth + creó `usuarios_perfil`
-- pero NO actualizó las FKs de 25 tablas que seguían apuntando a la tabla legacy
-- `usuarios`. Cualquier admin creado con el sistema nuevo (auth.users + trigger →
-- usuarios_perfil) NO existe en `usuarios`, por lo que un INSERT en cualquiera de
-- esas 25 tablas con su usuario_id rompe por violation de FK.
--
-- Casos rotos pre-fix:
--   - POST /api/portal-cliente/acceso/[persona_id]
--   - POST /api/postits, /api/tareas/* (vía Supabase client directo)
--   - Crear leads, oportunidades, cotizaciones, backups, errores_sistema, etc.
--   - Resolver dudosos del importador
--   - Aprobar PDFs del agente IA
--
-- Pre-condiciones validadas antes de correr:
--   1. Todos los IDs en `usuarios` legacy también están en `usuarios_perfil`.
--   2. Cero filas en las 25 tablas con usuario_id apuntando a un id que NO esté en
--      `usuarios_perfil` (verificado con queries de huérfanos).
--
-- La tabla legacy `usuarios` se MANTIENE viva por compatibilidad con código que
-- aún la lea en queries SELECT. Se elimina en una migración posterior cuando se
-- audite que ya no la usa nadie.

BEGIN;

-- Cada bloque: DROP + ADD con el mismo ON DELETE de la FK original.

-- 1. backups
ALTER TABLE public.backups DROP CONSTRAINT IF EXISTS backups_usuario_id_fkey;
ALTER TABLE public.backups
  ADD CONSTRAINT backups_usuario_id_fkey
  FOREIGN KEY (usuario_id) REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL;

-- 2. cotizaciones
ALTER TABLE public.cotizaciones DROP CONSTRAINT IF EXISTS cotizaciones_usuario_id_fkey;
ALTER TABLE public.cotizaciones
  ADD CONSTRAINT cotizaciones_usuario_id_fkey
  FOREIGN KEY (usuario_id) REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL;

-- 3. email_envios
ALTER TABLE public.email_envios DROP CONSTRAINT IF EXISTS email_envios_enviado_por_usuario_id_fkey;
ALTER TABLE public.email_envios
  ADD CONSTRAINT email_envios_enviado_por_usuario_id_fkey
  FOREIGN KEY (enviado_por_usuario_id) REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL;

-- 4. errores_sistema
ALTER TABLE public.errores_sistema DROP CONSTRAINT IF EXISTS errores_sistema_usuario_id_fkey;
ALTER TABLE public.errores_sistema
  ADD CONSTRAINT errores_sistema_usuario_id_fkey
  FOREIGN KEY (usuario_id) REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL;

-- 5. importaciones
ALTER TABLE public.importaciones DROP CONSTRAINT IF EXISTS importaciones_usuario_id_fkey;
ALTER TABLE public.importaciones
  ADD CONSTRAINT importaciones_usuario_id_fkey
  FOREIGN KEY (usuario_id) REFERENCES public.usuarios_perfil(id) ON DELETE CASCADE;

-- 6. importacion_registros_dudosos
ALTER TABLE public.importacion_registros_dudosos
  DROP CONSTRAINT IF EXISTS importacion_registros_dudosos_resuelto_por_usuario_id_fkey;
ALTER TABLE public.importacion_registros_dudosos
  ADD CONSTRAINT importacion_registros_dudosos_resuelto_por_usuario_id_fkey
  FOREIGN KEY (resuelto_por_usuario_id) REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL;

-- 7. leads
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_usuario_id_fkey;
ALTER TABLE public.leads
  ADD CONSTRAINT leads_usuario_id_fkey
  FOREIGN KEY (usuario_id) REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL;

-- 8. notificaciones
ALTER TABLE public.notificaciones DROP CONSTRAINT IF EXISTS notificaciones_usuario_id_fkey;
ALTER TABLE public.notificaciones
  ADD CONSTRAINT notificaciones_usuario_id_fkey
  FOREIGN KEY (usuario_id) REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL;

-- 9. oportunidades
ALTER TABLE public.oportunidades DROP CONSTRAINT IF EXISTS oportunidades_usuario_id_fkey;
ALTER TABLE public.oportunidades
  ADD CONSTRAINT oportunidades_usuario_id_fkey
  FOREIGN KEY (usuario_id) REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL;

-- 10. pdf_procesamientos
ALTER TABLE public.pdf_procesamientos DROP CONSTRAINT IF EXISTS pdf_procesamientos_usuario_id_fkey;
ALTER TABLE public.pdf_procesamientos
  ADD CONSTRAINT pdf_procesamientos_usuario_id_fkey
  FOREIGN KEY (usuario_id) REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL;

-- 11. persona_bitacora
ALTER TABLE public.persona_bitacora DROP CONSTRAINT IF EXISTS persona_bitacora_usuario_id_fkey;
ALTER TABLE public.persona_bitacora
  ADD CONSTRAINT persona_bitacora_usuario_id_fkey
  FOREIGN KEY (usuario_id) REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL;

-- 12. personas (2 FKs)
ALTER TABLE public.personas DROP CONSTRAINT IF EXISTS personas_usuario_id_fkey;
ALTER TABLE public.personas
  ADD CONSTRAINT personas_usuario_id_fkey
  FOREIGN KEY (usuario_id) REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL;

ALTER TABLE public.personas DROP CONSTRAINT IF EXISTS personas_deleted_by_usuario_id_fkey;
ALTER TABLE public.personas
  ADD CONSTRAINT personas_deleted_by_usuario_id_fkey
  FOREIGN KEY (deleted_by_usuario_id) REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL;

-- 13. poliza_bitacora
ALTER TABLE public.poliza_bitacora DROP CONSTRAINT IF EXISTS poliza_bitacora_usuario_id_fkey;
ALTER TABLE public.poliza_bitacora
  ADD CONSTRAINT poliza_bitacora_usuario_id_fkey
  FOREIGN KEY (usuario_id) REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL;

-- 14. polizas_eliminadas
ALTER TABLE public.polizas_eliminadas DROP CONSTRAINT IF EXISTS polizas_eliminadas_eliminada_por_usuario_id_fkey;
ALTER TABLE public.polizas_eliminadas
  ADD CONSTRAINT polizas_eliminadas_eliminada_por_usuario_id_fkey
  FOREIGN KEY (eliminada_por_usuario_id) REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL;

-- 15. portal_cliente_accesos (el bug que disparó esta migración)
ALTER TABLE public.portal_cliente_accesos DROP CONSTRAINT IF EXISTS portal_cliente_accesos_creado_por_usuario_id_fkey;
ALTER TABLE public.portal_cliente_accesos
  ADD CONSTRAINT portal_cliente_accesos_creado_por_usuario_id_fkey
  FOREIGN KEY (creado_por_usuario_id) REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL;

-- 16. postits
ALTER TABLE public.postits DROP CONSTRAINT IF EXISTS postits_usuario_id_fkey;
ALTER TABLE public.postits
  ADD CONSTRAINT postits_usuario_id_fkey
  FOREIGN KEY (usuario_id) REFERENCES public.usuarios_perfil(id) ON DELETE CASCADE;

-- 17. restauraciones
ALTER TABLE public.restauraciones DROP CONSTRAINT IF EXISTS restauraciones_usuario_id_fkey;
ALTER TABLE public.restauraciones
  ADD CONSTRAINT restauraciones_usuario_id_fkey
  FOREIGN KEY (usuario_id) REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL;

-- 18. sesiones (legacy de auth custom — la mantenemos pero apuntando a la tabla
-- nueva por consistencia. El cleanup completo de sesiones legacy queda para otra
-- migración).
ALTER TABLE public.sesiones DROP CONSTRAINT IF EXISTS sesiones_usuario_id_fkey;
ALTER TABLE public.sesiones
  ADD CONSTRAINT sesiones_usuario_id_fkey
  FOREIGN KEY (usuario_id) REFERENCES public.usuarios_perfil(id) ON DELETE CASCADE;

-- 19. siniestro_bitacora
ALTER TABLE public.siniestro_bitacora DROP CONSTRAINT IF EXISTS siniestro_bitacora_usuario_id_fkey;
ALTER TABLE public.siniestro_bitacora
  ADD CONSTRAINT siniestro_bitacora_usuario_id_fkey
  FOREIGN KEY (usuario_id) REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL;

-- 20. siniestros
ALTER TABLE public.siniestros DROP CONSTRAINT IF EXISTS siniestros_deleted_by_usuario_id_fkey;
ALTER TABLE public.siniestros
  ADD CONSTRAINT siniestros_deleted_by_usuario_id_fkey
  FOREIGN KEY (deleted_by_usuario_id) REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL;

-- 21. solicitudes_blanqueo_password (2 FKs, sistema legacy pero mantenido por compat)
ALTER TABLE public.solicitudes_blanqueo_password
  DROP CONSTRAINT IF EXISTS solicitudes_blanqueo_password_habilitada_por_admin_id_fkey;
ALTER TABLE public.solicitudes_blanqueo_password
  ADD CONSTRAINT solicitudes_blanqueo_password_habilitada_por_admin_id_fkey
  FOREIGN KEY (habilitada_por_admin_id) REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL;

ALTER TABLE public.solicitudes_blanqueo_password
  DROP CONSTRAINT IF EXISTS solicitudes_blanqueo_password_usuario_id_fkey;
ALTER TABLE public.solicitudes_blanqueo_password
  ADD CONSTRAINT solicitudes_blanqueo_password_usuario_id_fkey
  FOREIGN KEY (usuario_id) REFERENCES public.usuarios_perfil(id) ON DELETE CASCADE;

-- 22. storage_tokens
ALTER TABLE public.storage_tokens DROP CONSTRAINT IF EXISTS storage_tokens_creado_por_usuario_id_fkey;
ALTER TABLE public.storage_tokens
  ADD CONSTRAINT storage_tokens_creado_por_usuario_id_fkey
  FOREIGN KEY (creado_por_usuario_id) REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL;

-- 23. tareas
ALTER TABLE public.tareas DROP CONSTRAINT IF EXISTS tareas_usuario_id_fkey;
ALTER TABLE public.tareas
  ADD CONSTRAINT tareas_usuario_id_fkey
  FOREIGN KEY (usuario_id) REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL;

COMMIT;

-- Verificación post-migración: contar FKs aún apuntando a `usuarios` legacy.
-- Esperado: 0.
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM pg_constraint
  WHERE contype = 'f' AND confrelid = 'usuarios'::regclass;
  RAISE NOTICE 'FKs aún apuntando a usuarios legacy: %', v_count;
END $$;
