#!/bin/bash
# ============================================================================
# aplicar-migraciones.sh — aplica las migraciones SQL pendientes
#
# Modo de uso:
#   - HOST/systemd:  POSTGRES_HOST="" usa docker exec supabase-db
#   - DOCKER:        POSTGRES_HOST="supabase-db" + creds, conecta por TCP
#   - --dry-run:     no ejecuta, solo lista las pendientes
#   - --baseline:    marca todas las del repo como aplicadas SIN ejecutar
#                    (útil cuando se conecta a una DB que ya tiene el schema
#                    de un servidor pre-Docker)
#   - --no-reconcile: desactiva la reconciliación automática (modo estricto)
#
# Idempotencia:
#   - Crea/usa la tabla `migraciones_aplicadas (nombre PK, fecha)`.
#   - Lee `sql/migrations/*.sql` en orden lex (que coincide con orden numérico
#     porque todas tienen prefijo NNN_).
#   - Skipea las que ya tienen row.
#
# Reconciliación automática (default en v1.0.9+):
#   - Si una migración falla con un error "already exists" o "duplicate
#     column" → asume que está aplicada (sus efectos ya estaban en la DB
#     pero el row de tracking se perdió, ej: se aplicó con psql directo en
#     un sprint y nunca quedó registrada). La marca como aplicada y sigue.
#   - Si falla con cualquier OTRO error → aborta como antes.
#   - Esto cubre el caso "DB tiene los efectos pero migraciones_aplicadas
#     está desactualizada" sin requerir intervención manual.
#   - Se puede desactivar con --no-reconcile.
#   - Las migraciones nuevas DEBEN escribirse con `DROP X IF EXISTS + CREATE X`,
#     `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, etc., para
#     que el rollback de transacción no tape cambios reales pendientes.
#
# Detección de "primera vez vs repo existente":
#   - Si la DB no tiene la tabla `personas` (heurística: es schema vacío),
#     ejecuta TODAS las migraciones.
#   - Si la DB ya tiene tablas pero no tiene `migraciones_aplicadas`, asume
#     que el schema está al día con el repo y crea la tabla baseline-eada
#     (todas las del repo marcadas como aplicadas).
#   - El admin puede forzar el modo con --baseline.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MIGRATIONS_DIR="$PROJECT_DIR/sql/migrations"

DRY_RUN=0
BASELINE=0
RECONCILE=1  # reconciliación automática activa por default
for arg in "$@"; do
  case $arg in
    --dry-run) DRY_RUN=1 ;;
    --baseline) BASELINE=1 ;;
    --no-reconcile) RECONCILE=0 ;;
    -h|--help)
      sed -n '1,40p' "$0"
      exit 0
      ;;
  esac
done

# --- Cargar .env si existe (sin pisar lo que ya venga del caller) ---
ENV_FILE="${CRM_ENV_FILE:-$PROJECT_DIR/.env.docker}"
if [ ! -f "$ENV_FILE" ] && [ -f "$PROJECT_DIR/.env.local" ]; then
  ENV_FILE="$PROJECT_DIR/.env.local"
fi
if [ -f "$ENV_FILE" ]; then
  # Solo exportamos las claves que NO estén ya seteadas en el ambiente — así
  # el caller puede sobrescribir con env inline (ej: POSTGRES_HOST="" bash ...).
  while IFS='=' read -r key value; do
    [ -z "$key" ] && continue
    [[ "$key" =~ ^[[:space:]]*# ]] && continue
    # Strip quotes alrededor del value (manejo simple)
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    if [ -z "${!key+x}" ]; then
      export "$key=$value"
    fi
  done < <(grep -v '^#' "$ENV_FILE" | grep -v '^$')
fi

POSTGRES_HOST="${POSTGRES_HOST:-}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-supabase-db}"

# Wrapper que abstrae TCP vs docker exec.
# Uso:
#   psql_run "SELECT 1"
#   psql_run -f /path/to/file.sql
psql_run() {
  if [ -n "$POSTGRES_HOST" ]; then
    PGPASSWORD="$POSTGRES_PASSWORD" psql \
      -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" \
      -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      -v ON_ERROR_STOP=1 \
      "$@"
  else
    # Para docker exec con -f, hay que pasarlo por stdin.
    if [ "${1:-}" = "-f" ] && [ -n "${2:-}" ]; then
      docker exec -i "$POSTGRES_CONTAINER" psql \
        -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
        -v ON_ERROR_STOP=1 \
        < "$2"
    else
      docker exec -i "$POSTGRES_CONTAINER" psql \
        -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
        -v ON_ERROR_STOP=1 \
        "$@"
    fi
  fi
}

# Wrapper específico para queries que devuelven una sola línea (-tAc).
psql_query() {
  local query="$1"
  if [ -n "$POSTGRES_HOST" ]; then
    PGPASSWORD="$POSTGRES_PASSWORD" psql \
      -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" \
      -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      -tAc "$query" 2>/dev/null
  else
    docker exec "$POSTGRES_CONTAINER" psql \
      -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      -tAc "$query" 2>/dev/null
  fi
}

echo "=========================================="
echo "Migraciones SQL — FidCore CRM"
if [ -n "$POSTGRES_HOST" ]; then
  echo "Conexión: TCP $POSTGRES_USER@$POSTGRES_HOST:$POSTGRES_PORT/$POSTGRES_DB"
else
  echo "Conexión: docker exec $POSTGRES_CONTAINER"
fi
echo "Migraciones dir: $MIGRATIONS_DIR"
[ $DRY_RUN -eq 1 ] && echo "Modo: DRY RUN"
[ $BASELINE -eq 1 ] && echo "Modo: BASELINE (no ejecuta, solo marca)"
[ $RECONCILE -eq 0 ] && echo "Modo: NO-RECONCILE (estricto, sin tolerancia a 'already exists')"
echo "=========================================="

# 1. Verificar conectividad
if ! psql_query "SELECT 1" >/dev/null; then
  echo "ERROR: no se pudo conectar a Postgres."
  exit 1
fi

# 2. Crear tabla de tracking si no existe
psql_run >/dev/null <<'SQL'
CREATE TABLE IF NOT EXISTS migraciones_aplicadas (
  nombre VARCHAR PRIMARY KEY,
  fecha TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SQL

# 3. Heurística: ¿es DB virgen o schema existente?
TIENE_PERSONAS=$(psql_query "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='personas'")
TIENE_MIGRACIONES=$(psql_query "SELECT COUNT(*) FROM migraciones_aplicadas")

# Si el admin pidió baseline explícito, lo respetamos.
if [ $BASELINE -eq 1 ]; then
  echo "Modo BASELINE: marcando todas las migraciones del repo como aplicadas."
elif [ -n "$TIENE_PERSONAS" ] && [ "$TIENE_MIGRACIONES" = "0" ]; then
  # DB ya poblada (schema existente) pero sin tracking -> baseline implícito.
  echo "DB ya poblada detectada y migraciones_aplicadas vacío."
  echo "Marcando todas las migraciones del repo como aplicadas (baseline implícito)."
  echo "Si querés re-correr alguna, eliminá su row de migraciones_aplicadas."
  BASELINE=1
fi

# 4. Iterar migraciones en orden
APLICADAS=0
SKIPPED=0
PENDIENTES=()

for archivo in $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort); do
  nombre=$(basename "$archivo")
  ya_aplicada=$(psql_query "SELECT 1 FROM migraciones_aplicadas WHERE nombre = '$nombre'")

  if [ -n "$ya_aplicada" ]; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  PENDIENTES+=("$nombre")
done

if [ ${#PENDIENTES[@]} -eq 0 ]; then
  echo "Todas las migraciones del repo ya están aplicadas. Nada que hacer."
  echo "  Aplicadas previamente: $SKIPPED"
  exit 0
fi

echo ""
echo "Migraciones pendientes: ${#PENDIENTES[@]}"
for m in "${PENDIENTES[@]}"; do
  echo "  - $m"
done

if [ $DRY_RUN -eq 1 ]; then
  echo ""
  echo "DRY RUN — no se ejecuta nada."
  exit 0
fi

# 5. Aplicar cada pendiente — re-chequeamos antes de cada uno porque algunas
#    migraciones (como el 000_schema_base) pueden insertar rows en
#    migraciones_aplicadas marcando otras como aplicadas implícitamente.
for nombre in "${PENDIENTES[@]}"; do
  archivo="$MIGRATIONS_DIR/$nombre"

  # Re-chequeo: ¿una migración previa la marcó como aplicada?
  ya_aplicada_recheck=$(psql_query "SELECT 1 FROM migraciones_aplicadas WHERE nombre = '$nombre'")
  if [ -n "$ya_aplicada_recheck" ]; then
    echo "  [skipped] $nombre (marcada como aplicada por una migración previa)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if [ $BASELINE -eq 1 ]; then
    echo "  [baseline] $nombre"
  else
    echo "  [aplicando] $nombre ..."
    # Capturamos stderr para poder detectar "already exists" (reconcile).
    # stdout va a /dev/null como antes.
    apply_output=$(psql_run -f "$archivo" 2>&1 >/dev/null) || apply_rc=$?
    apply_rc=${apply_rc:-0}

    if [ "$apply_rc" -ne 0 ]; then
      # ¿Es un error idempotente que la reconciliación cubre?
      # Solo miramos líneas que empiezan con "ERROR:" (no NOTICEs ni WARNINGs)
      # para no confundirnos con un NOTICE benigno de "already exists, skipping"
      # de algún CREATE ... IF NOT EXISTS dentro de la misma migración.
      error_line=$(echo "$apply_output" | grep -E "^ERROR:" | head -1)
      if [ $RECONCILE -eq 1 ] && \
         echo "$error_line" | grep -qiE "already exists|duplicate column|duplicate key value violates unique constraint"; then
        echo "  [reconcile] $nombre: la DB ya tiene los efectos de esta migración."
        echo "              Marcando como aplicada sin re-ejecutar."
        echo "              ($error_line)"
        # No se ejecutó por el rollback de la transacción, pero los efectos ya estaban.
        # Marcamos como aplicada y seguimos.
      else
        echo "  ERROR aplicando $nombre — abortando."
        echo "$apply_output" | head -20
        exit 2
      fi
      unset error_line
    fi
    unset apply_rc
  fi

  # Marcar como aplicada (escapamos comillas simples por seguridad)
  nombre_esc=$(echo "$nombre" | sed "s/'/''/g")
  psql_run >/dev/null <<SQL
INSERT INTO migraciones_aplicadas (nombre) VALUES ('$nombre_esc')
ON CONFLICT (nombre) DO NOTHING;
SQL

  APLICADAS=$((APLICADAS + 1))
done

echo ""
echo "=========================================="
if [ $BASELINE -eq 1 ]; then
  echo "Listo: $APLICADAS migraciones marcadas como aplicadas (sin ejecutar)."
else
  echo "Listo: $APLICADAS migraciones aplicadas, $SKIPPED ya estaban."
fi
echo "=========================================="
