-- 018_eliminar_fks_duplicadas.sql
-- Elimina FKs duplicadas creadas por migración 017.
-- Criterio general:
--   - Si el on_delete difiere, se conserva la que tiene el comportamiento correcto según CLAUDE.md.
--   - Si ambas tienen el mismo on_delete, se conserva la original (*_fkey) y se elimina la nueva (fk_*).
--   - Para referencias a catalogos sin documentación explícita, se conserva SET NULL (*_fkey con 'a')
--     sobre NO ACTION (fk_* con 'n'), porque es el comportamiento más seguro al borrar un catálogo.

BEGIN;

-- ============================================================
-- cotizacion_companias → cotizaciones (cotizacion_id)
-- Ambas CASCADE (c). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE cotizacion_companias DROP CONSTRAINT IF EXISTS fk_cotizacion_companias_cotizacion;

-- ============================================================
-- cotizacion_companias → catalogos (compania_id)
-- *_fkey = SET NULL (a), fk_* = NO ACTION (n).
-- No documentado en CLAUDE.md, pero SET NULL es más seguro. Se conserva *_fkey.
-- ============================================================
ALTER TABLE cotizacion_companias DROP CONSTRAINT IF EXISTS fk_cotizacion_companias_compania;

-- ============================================================
-- cotizaciones → leads (lead_id)
-- CLAUDE.md: leads → cotizaciones = CASCADE. Ambas son NO ACTION (n), ninguna es correcta.
-- Se conserva original, se elimina fk_*. (La corrección de on_delete queda como deuda separada.)
-- ============================================================
ALTER TABLE cotizaciones DROP CONSTRAINT IF EXISTS fk_cotizaciones_lead;

-- ============================================================
-- cotizaciones → oportunidades (oportunidad_id)
-- CLAUDE.md: oportunidades → cotizaciones (oportunidad_id) = SET NULL.
-- Ambas NO ACTION (n). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE cotizaciones DROP CONSTRAINT IF EXISTS fk_cotizaciones_oportunidad;

-- ============================================================
-- cotizaciones → personas (persona_id)
-- CLAUDE.md: personas → cotizaciones (persona_id) = CASCADE.
-- Ambas NO ACTION (n). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE cotizaciones DROP CONSTRAINT IF EXISTS fk_cotizaciones_persona;

-- ============================================================
-- cotizaciones → usuarios (usuario_id)
-- No documentado. Ambas NO ACTION (n). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE cotizaciones DROP CONSTRAINT IF EXISTS fk_cotizaciones_usuario;

-- ============================================================
-- email_envios → personas (persona_id)
-- No documentado. Ambas NO ACTION (n). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE email_envios DROP CONSTRAINT IF EXISTS fk_email_envios_persona;

-- ============================================================
-- email_envios → polizas (poliza_id)
-- No documentado. Ambas NO ACTION (n). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE email_envios DROP CONSTRAINT IF EXISTS fk_email_envios_poliza;

-- ============================================================
-- endosos → polizas (poliza_id)
-- CLAUDE.md: polizas → endosos = CASCADE. Ambas CASCADE (c). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE endosos DROP CONSTRAINT IF EXISTS fk_endosos_poliza;

-- ============================================================
-- errores_sistema → usuarios (usuario_id)
-- No documentado. Ambas NO ACTION (n). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE errores_sistema DROP CONSTRAINT IF EXISTS fk_errores_sistema_usuario;

-- ============================================================
-- facturacion → catalogos (compania_id)
-- *_fkey = RESTRICT (r), fk_* = CASCADE (c).
-- No documentado. Para catálogos, SET NULL o NO ACTION es más seguro que CASCADE o RESTRICT.
-- Ninguna es ideal, pero CASCADE (fk_*) es peligrosa (borrar compañía borra facturación).
-- Se conserva *_fkey (RESTRICT) como la más segura disponible. Se elimina fk_*.
-- ============================================================
ALTER TABLE facturacion DROP CONSTRAINT IF EXISTS fk_facturacion_compania;

-- ============================================================
-- facturacion → catalogos (ramo_id)
-- *_fkey = RESTRICT (r), fk_* = NO ACTION (n). Ambas bloquean el borrado.
-- Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE facturacion DROP CONSTRAINT IF EXISTS fk_facturacion_ramo;

-- ============================================================
-- importaciones → usuarios (usuario_id)
-- *_fkey = CASCADE (c), fk_* = NO ACTION (n).
-- No documentado explícitamente. CASCADE en importaciones tiene sentido (si se borra el usuario
-- se borran sus importaciones). Se conserva *_fkey (CASCADE). Se elimina fk_*.
-- ============================================================
ALTER TABLE importaciones DROP CONSTRAINT IF EXISTS fk_importaciones_usuario;

-- ============================================================
-- importacion_jobs → importaciones (importacion_id)
-- Ambas CASCADE (c). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE importacion_jobs DROP CONSTRAINT IF EXISTS fk_importacion_jobs_importacion;

-- ============================================================
-- importacion_lotes → importaciones (importacion_id)
-- Ambas CASCADE (c). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE importacion_lotes DROP CONSTRAINT IF EXISTS fk_importacion_lotes_importacion;

-- ============================================================
-- importacion_registros_dudosos → importaciones (importacion_id)
-- Ambas CASCADE (c). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE importacion_registros_dudosos DROP CONSTRAINT IF EXISTS fk_importacion_dudosos_importacion;

-- ============================================================
-- interacciones → leads (lead_id)
-- Ambas CASCADE (c). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE interacciones DROP CONSTRAINT IF EXISTS fk_interacciones_lead;

-- ============================================================
-- interacciones → oportunidades (oportunidad_id)
-- Ambas CASCADE (c). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE interacciones DROP CONSTRAINT IF EXISTS fk_interacciones_oportunidad;

-- ============================================================
-- leads → personas (persona_id)
-- No documentado. Ambas NO ACTION (n). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE leads DROP CONSTRAINT IF EXISTS fk_leads_persona;

-- ============================================================
-- leads → usuarios (usuario_id)
-- No documentado. Ambas NO ACTION (n). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE leads DROP CONSTRAINT IF EXISTS fk_leads_usuario;

-- ============================================================
-- oportunidades → personas (persona_id)
-- CLAUDE.md: personas → oportunidades = CASCADE. Ambas CASCADE (c). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE oportunidades DROP CONSTRAINT IF EXISTS fk_oportunidades_persona;

-- ============================================================
-- oportunidades → usuarios (usuario_id)
-- No documentado. Ambas NO ACTION (n). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE oportunidades DROP CONSTRAINT IF EXISTS fk_oportunidades_usuario;

-- ============================================================
-- personas → usuarios (usuario_id)
-- No documentado. Ambas NO ACTION (n). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE personas DROP CONSTRAINT IF EXISTS fk_personas_usuario;

-- ============================================================
-- poliza_archivos → polizas (poliza_id)
-- CLAUDE.md: polizas → poliza_archivos = CASCADE. Ambas CASCADE (c). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE poliza_archivos DROP CONSTRAINT IF EXISTS fk_poliza_archivos_poliza;

-- ============================================================
-- polizas → personas (asegurado_id)
-- CLAUDE.md: personas → polizas (asegurado_id) = CASCADE.
-- *_fkey = RESTRICT (r), fk_* = CASCADE (c). Se conserva fk_* (CASCADE). Se elimina *_fkey.
-- ============================================================
ALTER TABLE polizas DROP CONSTRAINT IF EXISTS polizas_asegurado_id_fkey;

-- ============================================================
-- polizas → catalogos (cobertura_id)
-- CLAUDE.md: SET NULL. *_fkey = SET NULL (a), fk_* = NO ACTION (n).
-- Se conserva *_fkey (SET NULL). Se elimina fk_*.
-- ============================================================
ALTER TABLE polizas DROP CONSTRAINT IF EXISTS fk_polizas_cobertura;

-- ============================================================
-- polizas → catalogos (compania_id)
-- CLAUDE.md: SET NULL. *_fkey = RESTRICT (r), fk_* = NO ACTION (n).
-- Ninguna tiene SET NULL. NO ACTION es más cercano al comportamiento deseado que RESTRICT
-- (permite borrar si hay código de aplicación que lo gestiona). Se conserva fk_* (NO ACTION).
-- Se elimina *_fkey (RESTRICT).
-- ============================================================
ALTER TABLE polizas DROP CONSTRAINT IF EXISTS polizas_compania_id_fkey;

-- ============================================================
-- polizas → polizas (poliza_origen_id)
-- CLAUDE.md: polizas → polizas (poliza_origen_id) = CASCADE.
-- *_fkey = SET NULL (a), fk_* = CASCADE (c). Se conserva fk_* (CASCADE). Se elimina *_fkey.
-- ============================================================
ALTER TABLE polizas DROP CONSTRAINT IF EXISTS polizas_poliza_origen_id_fkey;

-- ============================================================
-- polizas → catalogos (ramo_id)
-- CLAUDE.md: SET NULL. *_fkey = RESTRICT (r), fk_* = NO ACTION (n).
-- Mismo criterio que compania_id: NO ACTION es más manejable. Se conserva fk_* (NO ACTION).
-- Se elimina *_fkey (RESTRICT).
-- ============================================================
ALTER TABLE polizas DROP CONSTRAINT IF EXISTS polizas_ramo_id_fkey;

-- ============================================================
-- polizas → catalogos (refacturacion_id)
-- CLAUDE.md: SET NULL. *_fkey = SET NULL (a), fk_* = NO ACTION (n).
-- Se conserva *_fkey (SET NULL). Se elimina fk_*.
-- ============================================================
ALTER TABLE polizas DROP CONSTRAINT IF EXISTS fk_polizas_refacturacion;

-- ============================================================
-- polizas → personas (tomador_id)
-- CLAUDE.md: SET NULL. *_fkey = RESTRICT (r), fk_* = NO ACTION (n). Ninguna tiene SET NULL.
-- NO ACTION es más manejable que RESTRICT. Se conserva fk_* (NO ACTION). Se elimina *_fkey.
-- ============================================================
ALTER TABLE polizas DROP CONSTRAINT IF EXISTS polizas_tomador_id_fkey;

-- ============================================================
-- polizas → catalogos (vigencia_tipo_id)
-- CLAUDE.md: SET NULL. *_fkey = SET NULL (a), fk_* = NO ACTION (n).
-- Se conserva *_fkey (SET NULL). Se elimina fk_*.
-- ============================================================
ALTER TABLE polizas DROP CONSTRAINT IF EXISTS fk_polizas_vigencia_tipo;

-- ============================================================
-- postits → usuarios (usuario_id)
-- No documentado. Ambas CASCADE (c). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE postits DROP CONSTRAINT IF EXISTS fk_postits_usuario;

-- ============================================================
-- riesgos → polizas (poliza_id)
-- CLAUDE.md: polizas → riesgos = CASCADE. Ambas CASCADE (c). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE riesgos DROP CONSTRAINT IF EXISTS fk_riesgos_poliza;

-- ============================================================
-- sesiones → usuarios (usuario_id)
-- No documentado. Ambas CASCADE (c). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE sesiones DROP CONSTRAINT IF EXISTS fk_sesiones_usuario;

-- ============================================================
-- siniestro_archivos → siniestros (siniestro_id)
-- CLAUDE.md: siniestros → siniestro_archivos = CASCADE. Ambas CASCADE (c). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE siniestro_archivos DROP CONSTRAINT IF EXISTS fk_siniestro_archivos_siniestro;

-- ============================================================
-- siniestro_bitacora → siniestros (siniestro_id)
-- CLAUDE.md: siniestros → siniestro_bitacora = CASCADE. Ambas CASCADE (c). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE siniestro_bitacora DROP CONSTRAINT IF EXISTS fk_siniestro_bitacora_siniestro;

-- ============================================================
-- siniestros → personas (persona_id)
-- CLAUDE.md: personas → siniestros = CASCADE.
-- *_fkey = RESTRICT (r), fk_* = CASCADE (c). Se conserva fk_* (CASCADE). Se elimina *_fkey.
-- ============================================================
ALTER TABLE siniestros DROP CONSTRAINT IF EXISTS siniestros_persona_id_fkey;

-- ============================================================
-- siniestros → polizas (poliza_id)
-- CLAUDE.md: polizas → siniestros = CASCADE.
-- *_fkey = RESTRICT (r), fk_* = CASCADE (c). Se conserva fk_* (CASCADE). Se elimina *_fkey.
-- ============================================================
ALTER TABLE siniestros DROP CONSTRAINT IF EXISTS siniestros_poliza_id_fkey;

-- ============================================================
-- siniestros → riesgos (riesgo_id)
-- No documentado. Ambas NO ACTION (n). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE siniestros DROP CONSTRAINT IF EXISTS fk_siniestros_riesgo;

-- ============================================================
-- tareas → personas (persona_id)
-- CLAUDE.md: personas → tareas = CASCADE. Ambas CASCADE (c). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE tareas DROP CONSTRAINT IF EXISTS fk_tareas_persona;

-- ============================================================
-- tareas → polizas (poliza_id)
-- CLAUDE.md: polizas → tareas = SET NULL. Ambas NO ACTION (n). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE tareas DROP CONSTRAINT IF EXISTS fk_tareas_poliza;

-- ============================================================
-- tareas → siniestros (siniestro_id)
-- CLAUDE.md: siniestros → tareas = SET NULL. Ambas NO ACTION (n). Se conserva original, se elimina fk_*.
-- ============================================================
ALTER TABLE tareas DROP CONSTRAINT IF EXISTS fk_tareas_siniestro;

COMMIT;
