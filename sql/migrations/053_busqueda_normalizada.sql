-- ============================================================
-- 053 — Búsqueda normalizada con unaccent + pg_trgm
-- ============================================================
-- Las búsquedas del CRM usan `ilike '%termino%'` sobre `apellido`/`nombre`/
-- `razon_social`. Eso significa:
--   1) Tipear "perez" NO encuentra "Pérez" (los acentos rompen el match).
--   2) Sin índice apto para LIKE con wildcard inicial, cada búsqueda
--      hace seq scan completo de la tabla.
--
-- Solución (Opción B):
--   - Wrapper `immutable_unaccent` para que sea usable en columnas generated.
--     `unaccent()` por sí solo está marcado STABLE — Postgres no lo deja
--     usar en `GENERATED ALWAYS AS`. El wrapper es trivial pero declarado
--     IMMUTABLE para destrabar.
--   - Columnas `_norm` en `personas` (apellido/nombre/razon_social) y
--     `leads` (apellido/nombre) que guardan la versión sin tildes y en
--     lowercase. Calculadas automáticamente por la DB en cada INSERT/UPDATE.
--   - Índices GIN trigram (pg_trgm) sobre las columnas `_norm`. Esto sí
--     acelera `ilike '%termino%'` con wildcards en ambos lados.
--
-- El cliente hace dos cambios:
--   a) Normaliza el término de búsqueda con String.normalize('NFD')+regex+lowercase.
--   b) Cambia `apellido.ilike.%term%` → `apellido_norm.ilike.%term%`.
--
-- Bonus de pg_trgm: tolera typos. `peres` matchea `Pérez` por similitud.
-- ============================================================

-- Wrapper IMMUTABLE necesario para columnas generated.
-- `unaccent` (sin argumento de dictionary) es STABLE; envuelto en una función
-- IMMUTABLE es seguro porque el comportamiento de `unaccent` no cambia entre
-- ejecuciones de una misma fila (sería un problema solo si la tabla de
-- dictionary `unaccent` se modificara — algo que el CRM no hace).
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$ SELECT unaccent('unaccent'::regdictionary, $1) $$;

-- ============================================================
-- PERSONAS — apellido, nombre, razon_social
-- ============================================================
ALTER TABLE personas
  ADD COLUMN IF NOT EXISTS apellido_norm TEXT
    GENERATED ALWAYS AS (lower(immutable_unaccent(apellido))) STORED;

ALTER TABLE personas
  ADD COLUMN IF NOT EXISTS nombre_norm TEXT
    GENERATED ALWAYS AS (lower(immutable_unaccent(nombre))) STORED;

ALTER TABLE personas
  ADD COLUMN IF NOT EXISTS razon_social_norm TEXT
    GENERATED ALWAYS AS (lower(immutable_unaccent(razon_social))) STORED;

CREATE INDEX IF NOT EXISTS idx_personas_apellido_norm_trgm
  ON personas USING GIN (apellido_norm gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_personas_nombre_norm_trgm
  ON personas USING GIN (nombre_norm gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_personas_razon_social_norm_trgm
  ON personas USING GIN (razon_social_norm gin_trgm_ops);

-- ============================================================
-- LEADS — apellido, nombre
-- ============================================================
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS apellido_norm TEXT
    GENERATED ALWAYS AS (lower(immutable_unaccent(apellido))) STORED;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS nombre_norm TEXT
    GENERATED ALWAYS AS (lower(immutable_unaccent(nombre))) STORED;

CREATE INDEX IF NOT EXISTS idx_leads_apellido_norm_trgm
  ON leads USING GIN (apellido_norm gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_leads_nombre_norm_trgm
  ON leads USING GIN (nombre_norm gin_trgm_ops);
