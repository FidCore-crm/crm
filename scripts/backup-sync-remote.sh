#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_BASE="/var/backups/crm-seguros"
REMOTE_NAME="${1:-gdrive}"
REMOTE_FOLDER="${2:-Backups-CRM}"

# Cargar env para poder leer DB de tipos de backup
if [ -f "$PROJECT_DIR/.env.local" ]; then
  set -a
  export $(grep -v '^#' "$PROJECT_DIR/.env.local" | grep -v '^$' | xargs -d '\n' 2>/dev/null) || true
  set +a
fi
if [ -f "$PROJECT_DIR/.env.docker" ]; then
  set -a
  export $(grep -v '^#' "$PROJECT_DIR/.env.docker" | grep -v '^$' | xargs -d '\n' 2>/dev/null) || true
  set +a
fi
POSTGRES_HOST="${POSTGRES_HOST:-}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-supabase-db}"

# Verificar que rclone esta instalado
if ! command -v rclone &> /dev/null; then
  echo "ERROR: rclone no esta instalado"
  echo "Instala con: curl https://rclone.org/install.sh | sudo bash"
  exit 1
fi

# Verificar que el remote existe
if ! rclone listremotes | grep -q "^${REMOTE_NAME}:"; then
  echo "ERROR: el remote '${REMOTE_NAME}' no esta configurado"
  echo "Configuralo con: rclone config"
  exit 2
fi

# Fix v1.0.144: los PRE_UPDATE NO se sincronizan a Drive. Son defensivos
# (rollback inmediato tras update fallido), duran 3 días en local, no
# hace falta consumir espacio remoto para ellos. Los AUTOMATICO diarios
# y los MANUAL/PRE_RESTORE sí se sincronizan.
#
# Usamos --filter-from (no --include + --exclude que son de orden
# indeterminado y no filtran correctamente). El archivo lista los
# PRE_UPDATE con prefijo `- ` (excluir), después catch-all include para
# el resto de backup-*.crmbak.
FILTER_FILE=$(mktemp)
trap "rm -f $FILTER_FILE" EXIT

# Función auxiliar para consultar DB
psql_query() {
  local sql="$1"
  if [ -n "$POSTGRES_HOST" ] && command -v psql &>/dev/null; then
    PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" \
      -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "$sql" 2>/dev/null || echo ""
  elif command -v docker &>/dev/null && docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
    docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      -tAc "$sql" 2>/dev/null || echo ""
  else
    echo ""
  fi
}

# Construir archivo de filtros (orden importa en rclone: primer match gana)
#   - <nombre>     → excluir cada PRE_UPDATE por nombre exacto
#   + backup-*.crmbak → incluir el resto de backups
#   - *            → excluir cualquier otra cosa
{
  psql_query "SELECT '- ' || nombre || '.crmbak' FROM backups WHERE tipo='PRE_UPDATE' AND archivo_unico_path IS NOT NULL" 2>/dev/null
  echo "+ backup-*.crmbak"
  echo "- *"
} > "$FILTER_FILE"

CANT_EXCLUIDOS=$(grep -c "^- backup-" "$FILTER_FILE" 2>/dev/null || echo 0)
echo "Sincronizando $BACKUP_BASE con ${REMOTE_NAME}:${REMOTE_FOLDER}..."
if [ "$CANT_EXCLUIDOS" -gt 0 ]; then
  echo "  Excluidos ${CANT_EXCLUIDOS} PRE_UPDATE (locales, no van a Drive)"
fi

# Sync con rclone: mirror exacto (elimina del remoto lo que ya no esta local).
if rclone sync "$BACKUP_BASE" "${REMOTE_NAME}:${REMOTE_FOLDER}" \
  --filter-from "$FILTER_FILE" \
  --transfers 4 \
  --checkers 8 \
  --progress \
  --stats 10s; then
  echo "Sincronizacion completada"
  exit 0
else
  EXIT_CODE=$?
  echo "Error durante la sincronizacion (codigo $EXIT_CODE)"
  exit $EXIT_CODE
fi
