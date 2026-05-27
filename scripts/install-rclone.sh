#!/bin/bash
set -e

echo "Instalando rclone..."

if command -v rclone &> /dev/null; then
  echo "rclone ya esta instalado: $(rclone version | head -n 1)"
  exit 0
fi

curl https://rclone.org/install.sh | sudo bash

echo ""
echo "rclone instalado correctamente"
echo ""
echo "Siguiente paso: configurar un remote llamado 'gdrive'"
echo "Ejecuta: rclone config"
echo ""
echo "Segui las instrucciones del asistente para conectar con Google Drive."
