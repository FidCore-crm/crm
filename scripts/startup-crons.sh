#!/bin/bash
# Ejecuta TODOS los crons del CRM una vez.
# Es la variante de compatibilidad (usada por crm-crons.timer de systemd, catch-up
# al boot, etc). En el container Docker se usa el loop dual crons-loop.sh que
# separa rápidos (cada 20 min) de lentos (cada 2h) para no gastar recursos.
#
# Funciona en dos modos:
#   - HOST/systemd:  ENV_FILE=/home/.../.env.local, CRM_BASE_URL=http://localhost:3000
#   - DOCKER:        CRON_SECRET en env, CRM_BASE_URL=http://crm:3000

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Correr rápidos y lentos en secuencia
bash "$SCRIPT_DIR/startup-crons-rapidos.sh"
bash "$SCRIPT_DIR/startup-crons-lentos.sh"
