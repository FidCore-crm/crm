-- Migración 061: CHECK constraints adicionales (#98)
--
-- Agrega validaciones a nivel DB que complementan las del código TypeScript.
-- Auditoría previa confirmó que ninguna fila existente viola estos checks
-- (verificado el 2026-05-13 contra DB de producción local).
--
-- Si en una instalación futura los datos violan algún constraint, la migración
-- fallará — habrá que limpiar primero los datos o agregar el constraint con
-- NOT VALID para que aplique solo a nuevos INSERT/UPDATE.

BEGIN;

-- ============================================================================
-- SINIESTROS — montos no-negativos + coherencia lógica
-- ============================================================================

ALTER TABLE siniestros DROP CONSTRAINT IF EXISTS chk_siniestros_monto_estimado_no_negativo;
ALTER TABLE siniestros ADD CONSTRAINT chk_siniestros_monto_estimado_no_negativo
  CHECK (monto_estimado IS NULL OR monto_estimado >= 0);

ALTER TABLE siniestros DROP CONSTRAINT IF EXISTS chk_siniestros_monto_liquidado_no_negativo;
ALTER TABLE siniestros ADD CONSTRAINT chk_siniestros_monto_liquidado_no_negativo
  CHECK (monto_liquidado IS NULL OR monto_liquidado >= 0);

ALTER TABLE siniestros DROP CONSTRAINT IF EXISTS chk_siniestros_monto_cobrado_no_negativo;
ALTER TABLE siniestros ADD CONSTRAINT chk_siniestros_monto_cobrado_no_negativo
  CHECK (monto_cobrado IS NULL OR monto_cobrado >= 0);

ALTER TABLE siniestros DROP CONSTRAINT IF EXISTS chk_siniestros_franquicia_no_negativa;
ALTER TABLE siniestros ADD CONSTRAINT chk_siniestros_franquicia_no_negativa
  CHECK (franquicia_aplicada IS NULL OR franquicia_aplicada >= 0);

-- Coherencia: liquidado <= estimado, cobrado <= liquidado
-- (cuando ambos están seteados; si uno es NULL, el CHECK pasa)
ALTER TABLE siniestros DROP CONSTRAINT IF EXISTS chk_siniestros_liquidado_le_estimado;
ALTER TABLE siniestros ADD CONSTRAINT chk_siniestros_liquidado_le_estimado
  CHECK (
    monto_liquidado IS NULL
    OR monto_estimado IS NULL
    OR monto_liquidado <= monto_estimado
  );

ALTER TABLE siniestros DROP CONSTRAINT IF EXISTS chk_siniestros_cobrado_le_liquidado;
ALTER TABLE siniestros ADD CONSTRAINT chk_siniestros_cobrado_le_liquidado
  CHECK (
    monto_cobrado IS NULL
    OR monto_liquidado IS NULL
    OR monto_cobrado <= monto_liquidado
  );

-- Coherencia: fecha_cierre >= fecha_denuncia
ALTER TABLE siniestros DROP CONSTRAINT IF EXISTS chk_siniestros_cierre_ge_denuncia;
ALTER TABLE siniestros ADD CONSTRAINT chk_siniestros_cierre_ge_denuncia
  CHECK (
    fecha_cierre IS NULL
    OR fecha_cierre >= fecha_denuncia
  );


-- ============================================================================
-- POLIZAS — suma_asegurada no-negativa, fecha_baja >= fecha_inicio
-- ============================================================================

ALTER TABLE polizas DROP CONSTRAINT IF EXISTS chk_polizas_suma_asegurada_no_negativa;
ALTER TABLE polizas ADD CONSTRAINT chk_polizas_suma_asegurada_no_negativa
  CHECK (suma_asegurada IS NULL OR suma_asegurada >= 0);

ALTER TABLE polizas DROP CONSTRAINT IF EXISTS chk_polizas_fecha_baja_ge_inicio;
ALTER TABLE polizas ADD CONSTRAINT chk_polizas_fecha_baja_ge_inicio
  CHECK (
    fecha_baja IS NULL
    OR fecha_baja >= fecha_inicio
  );


-- ============================================================================
-- RIESGOS — suma_asegurada no-negativa
-- ============================================================================

ALTER TABLE riesgos DROP CONSTRAINT IF EXISTS chk_riesgos_suma_asegurada_no_negativa;
ALTER TABLE riesgos ADD CONSTRAINT chk_riesgos_suma_asegurada_no_negativa
  CHECK (suma_asegurada IS NULL OR suma_asegurada >= 0);


-- ============================================================================
-- OPORTUNIDADES — monto_estimado no-negativo
-- ============================================================================

ALTER TABLE oportunidades DROP CONSTRAINT IF EXISTS chk_oportunidades_monto_estimado_no_negativo;
ALTER TABLE oportunidades ADD CONSTRAINT chk_oportunidades_monto_estimado_no_negativo
  CHECK (monto_estimado IS NULL OR monto_estimado >= 0);


-- ============================================================================
-- PERSONAS — formato de email
-- ============================================================================
-- Regex pragmático: algo@algo.algo (no es RFC 5322 estricto pero filtra
-- errores comunes como "foo", "foo@bar", "foo@@bar.com").

ALTER TABLE personas DROP CONSTRAINT IF EXISTS chk_personas_email_formato;
ALTER TABLE personas ADD CONSTRAINT chk_personas_email_formato
  CHECK (
    email IS NULL
    OR email = ''
    OR email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  );

ALTER TABLE personas DROP CONSTRAINT IF EXISTS chk_personas_email_secundario_formato;
ALTER TABLE personas ADD CONSTRAINT chk_personas_email_secundario_formato
  CHECK (
    email_secundario IS NULL
    OR email_secundario = ''
    OR email_secundario ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  );


-- ============================================================================
-- LEADS — email formato (cuando hay)
-- ============================================================================

ALTER TABLE leads DROP CONSTRAINT IF EXISTS chk_leads_email_formato;
ALTER TABLE leads ADD CONSTRAINT chk_leads_email_formato
  CHECK (
    email IS NULL
    OR email = ''
    OR email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  );


-- ============================================================================
-- COTIZACIONES — fecha_vencimiento >= fecha_envio (cuando ambas)
-- ============================================================================

ALTER TABLE cotizaciones DROP CONSTRAINT IF EXISTS chk_cotizaciones_venc_ge_envio;
ALTER TABLE cotizaciones ADD CONSTRAINT chk_cotizaciones_venc_ge_envio
  CHECK (
    fecha_vencimiento IS NULL
    OR fecha_envio IS NULL
    OR fecha_vencimiento >= fecha_envio
  );


-- ============================================================================
-- TAREAS — fecha_vencimiento debe existir (ya es NOT NULL)
-- TAREAS — nada que agregar; ya tiene CHECKs de tipo, prioridad, estado, recurrencia
-- ============================================================================


COMMIT;
