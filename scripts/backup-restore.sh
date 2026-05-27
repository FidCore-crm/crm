#!/bin/bash
set -e

# ============================================================================
# backup-restore.sh (Fase 2)
#
# Script llamado desde src/lib/backup-restore.ts después de haber extraído un
# .crmbak a un directorio de trabajo. Ejecuta los pasos que tocan el
# filesystem / docker (DB y storage).
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

if [ "$RESTAURAR_DB" = "1" ]; then
  echo "[restore] Restaurando base de datos..."
  if [ -n "$POSTGRES_HOST" ]; then
    # Modo TCP — para containers
    PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;" > /dev/null
    gunzip -c "$SRC_DIR/database.sql.gz" | PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" > /dev/null 2>&1 || {
      echo "ERROR: falló el restore de la DB (TCP)"
      exit 3
    }
  else
    # Modo legacy host — docker exec
    docker exec -i "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;" > /dev/null
    gunzip -c "$SRC_DIR/database.sql.gz" | docker exec -i "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" > /dev/null 2>&1 || {
      echo "ERROR: falló el restore de la DB (docker exec)"
      exit 3
    }
  fi
  echo "[restore] DB restaurada"
fi

if [ "$RESTAURAR_STORAGE" = "1" ]; then
  echo "[restore] Restaurando storage..."
  TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
  if [ -d "$PROJECT_DIR/storage" ]; then
    mv "$PROJECT_DIR/storage" "$PROJECT_DIR/storage.pre-restore.$TIMESTAMP"
    echo "[restore] Storage anterior movido a storage.pre-restore.$TIMESTAMP"
  fi
  if [ -f "$SRC_DIR/storage.tar.gz" ]; then
    tar -xzf "$SRC_DIR/storage.tar.gz" -C "$PROJECT_DIR" || {
      echo "ERROR: falló la extracción del storage"
      exit 4
    }
    echo "[restore] Storage restaurado"
  else
    echo "[restore] storage.tar.gz no encontrado (saltando)"
  fi
fi

echo "[restore] Pasos de filesystem completados"
exit 0
