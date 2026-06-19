#!/bin/bash
set -e

# ============================================================================
# backup-restore.sh (Fase 3 — con snapshot defensivo)
#
# Script llamado desde src/lib/backup-restore.ts después de haber extraído un
# .crmbak a un directorio de trabajo. Ejecuta los pasos que tocan el
# filesystem / docker (DB y storage).
#
# Filosofía de seguridad:
#   El restore de DB hace DROP SCHEMA public CASCADE. Si el psql posterior
#   falla por CUALQUIER motivo (error SQL, OOM, container muerto, network),
#   la DB queda corrupta y sin vuelta atrás. Por eso ANTES del DROP creamos
#   un snapshot rápido (pg_dump → /tmp). Si el restore real falla, recuperamos
#   el estado previo automáticamente desde ese snapshot. Si el restore tiene
#   éxito, el snapshot se borra.
#
#   Esta es defensa secundaria — el caller (rollback del updater o
#   restauración desde UI) ya hace un .crmbak pre-restore upstream. El
#   snapshot del script es la red por debajo: cubre el window entre el DROP
#   y el COMMIT real, donde upstream no puede ayudar.
#
# Uso:
#   bash backup-restore.sh --work-dir=<dir> --restaurar-db=0|1 --restaurar-storage=0|1
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

WORK_DIR=""
RESTAURAR_DB=0
RESTAURAR_STORAGE=0
for arg in "$@"; do
  case $arg in
    --work-dir=*) WORK_DIR="${arg#*=}" ;;
    --restaurar-db=*) RESTAURAR_DB="${arg#*=}" ;;
    --restaurar-storage=*) RESTAURAR_STORAGE="${arg#*=}" ;;
  esac
done

if [ -z "$WORK_DIR" ] || [ ! -d "$WORK_DIR" ]; then
  echo "ERROR: --work-dir requerido y debe existir"
  exit 1
fi

# Buscar database.sql.gz en WORK_DIR o en un subdir
SRC_DIR="$WORK_DIR"
if [ ! -f "$SRC_DIR/database.sql.gz" ]; then
  for sub in "$WORK_DIR"/*/; do
    if [ -f "${sub}database.sql.gz" ]; then
      SRC_DIR="${sub%/}"
      break
    fi
  done
fi

if [ ! -f "$SRC_DIR/database.sql.gz" ]; then
  echo "ERROR: no se encontró database.sql.gz en $WORK_DIR"
  exit 2
fi

POSTGRES_HOST="${POSTGRES_HOST:-}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-supabase-db}"

# ----- helpers -----
ejecutar_pg_dump() {
  # Snapshot del estado actual a stdout (caller redirige a archivo).
  if [ -n "$POSTGRES_HOST" ]; then
    PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" "$POSTGRES_DB"
  else
    docker exec "$POSTGRES_CONTAINER" pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"
  fi
}

ejecutar_psql_cmd() {
  # Ejecuta un comando SQL puntual. Silencioso.
  local sql="$1"
  if [ -n "$POSTGRES_HOST" ]; then
    PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$sql" > /dev/null
  else
    docker exec -i "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$sql" > /dev/null
  fi
}

ejecutar_psql_stdin() {
  # Ejecuta lo que venga por stdin (típicamente un dump descomprimido).
  # NO usamos ON_ERROR_STOP=1: el dump tiene CREATE SCHEMA sin IF NOT EXISTS
  # para schemas que ya existen en Supabase (auth, realtime, storage). Esos
  # errores son benignos y se ignoran; lo que sí queremos es que psql complete
  # todas las sentencias del dump.
  if [ -n "$POSTGRES_HOST" ]; then
    PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB"
  else
    docker exec -i "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
  fi
}

verificar_db_consistente() {
  # Sanity check post-restore: confirma que las tablas críticas del CRM existan.
  # Si no están, el restore quedó incompleto y debemos rollback al snapshot.
  local check_sql="SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('usuarios_perfil','configuracion','tipo_catalogo','personas','polizas','licencias') HAVING count(*) = 6"
  local result
  if [ -n "$POSTGRES_HOST" ]; then
    result=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "$check_sql" 2>/dev/null || echo "")
  else
    result=$(docker exec -i "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "$check_sql" 2>/dev/null || echo "")
  fi
  [ "$result" = "1" ]
}

if [ "$RESTAURAR_DB" = "1" ]; then
  # Snapshot defensivo: si CUALQUIER paso del restore falla, lo usamos para
  # recuperar el estado previo. Se borra solo cuando el restore termina OK y
  # quedó validado por verificar_db_consistente.
  SNAPSHOT_FILE="$WORK_DIR/snapshot-pre-restore-$$.sql.gz"
  echo "[restore] Creando snapshot defensivo (pre-DROP)..."
  if ! ejecutar_pg_dump 2>/dev/null | gzip > "$SNAPSHOT_FILE"; then
    echo "ERROR: no se pudo crear snapshot defensivo. Abortando ANTES de tocar la DB."
    rm -f "$SNAPSHOT_FILE"
    exit 5
  fi
  SNAPSHOT_BYTES=$(stat -c%s "$SNAPSHOT_FILE" 2>/dev/null || echo 0)
  echo "[restore] Snapshot creado (${SNAPSHOT_BYTES} bytes): $SNAPSHOT_FILE"

  echo "[restore] DROP SCHEMA public CASCADE + restore desde dump..."
  set +e
  ejecutar_psql_cmd "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
  DROP_RC=$?
  if [ "$DROP_RC" -eq 0 ]; then
    gunzip -c "$SRC_DIR/database.sql.gz" | ejecutar_psql_stdin > /dev/null 2>&1
    RESTORE_RC=$?
  else
    RESTORE_RC=$DROP_RC
  fi
  set -e

  if [ "$RESTORE_RC" -ne 0 ] || ! verificar_db_consistente; then
    echo "[restore] ⚠ Restore falló (rc=$RESTORE_RC) o quedó inconsistente. Recuperando estado previo desde snapshot..."
    set +e
    ejecutar_psql_cmd "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
    gunzip -c "$SNAPSHOT_FILE" | ejecutar_psql_stdin > /dev/null 2>&1
    RECOVER_RC=$?
    set -e
    if [ "$RECOVER_RC" -ne 0 ] || ! verificar_db_consistente; then
      echo "❌ CATASTRÓFICO: el snapshot tampoco se pudo restaurar."
      echo "❌ La DB quedó en estado inconsistente. Snapshot preservado en:"
      echo "❌   $SNAPSHOT_FILE"
      echo "❌ Recuperación manual: gunzip -c '$SNAPSHOT_FILE' | docker exec -i supabase-db psql -U postgres -d postgres"
      exit 99
    fi
    echo "[restore] ✓ Estado pre-restore recuperado desde snapshot"
    rm -f "$SNAPSHOT_FILE"
    exit 3
  fi

  rm -f "$SNAPSHOT_FILE"
  echo "[restore] DB restaurada y validada"
fi

if [ "$RESTAURAR_STORAGE" = "1" ]; then
  echo "[restore] Restaurando storage..."
  TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
  if [ -d "$PROJECT_DIR/storage" ]; then
    mv "$PROJECT_DIR/storage" "$PROJECT_DIR/storage.pre-restore.$TIMESTAMP"
    echo "[restore] Storage anterior movido a storage.pre-restore.$TIMESTAMP"
  fi
  if [ -f "$SRC_DIR/storage.tar.gz" ]; then
    if ! tar -xzf "$SRC_DIR/storage.tar.gz" -C "$PROJECT_DIR"; then
      echo "ERROR: falló la extracción del storage"
      # Si tenemos el storage anterior, intentar restaurarlo
      if [ -d "$PROJECT_DIR/storage.pre-restore.$TIMESTAMP" ] && [ ! -d "$PROJECT_DIR/storage" ]; then
        mv "$PROJECT_DIR/storage.pre-restore.$TIMESTAMP" "$PROJECT_DIR/storage"
        echo "[restore] Storage anterior recuperado"
      fi
      exit 4
    fi
    echo "[restore] Storage restaurado"
  else
    echo "[restore] storage.tar.gz no encontrado (saltando)"
  fi
fi

echo "[restore] Pasos de filesystem completados"
exit 0
