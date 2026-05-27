#!/bin/bash
set -e

BACKUP_BASE="/var/backups/crm-seguros"
REMOTE_NAME="${1:-gdrive}"
REMOTE_FOLDER="${2:-Backups-CRM}"

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

echo "Sincronizando $BACKUP_BASE con ${REMOTE_NAME}:${REMOTE_FOLDER}..."

# Sync con rclone: mirror exacto (elimina del remoto lo que ya no esta local).
# Solo archivos .crmbak.
if rclone sync "$BACKUP_BASE" "${REMOTE_NAME}:${REMOTE_FOLDER}" \
  --include "backup-*.crmbak" \
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
