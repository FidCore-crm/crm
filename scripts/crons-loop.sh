#!/bin/bash
# Loop wrapper de los crons del CRM cuando corren como container del compose.
# En el host con systemd, se usa crm-crons.timer + crm-crons.service en su lugar
# (cada 2h con Persistent=true para catch-up post-reboot).
#
# Acá replicamos: ejecutar startup-crons.sh, dormir CRONS_INTERVAL_SECONDS, repetir.

set -u

INTERVAL_SECONDS="${CRONS_INTERVAL_SECONDS:-7200}"  # 2h por defecto
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[crons-loop] Iniciando loop cada ${INTERVAL_SECONDS}s"

while true; do
  bash "$SCRIPT_DIR/startup-crons.sh" || echo "[crons-loop] startup-crons.sh terminó con error (continuamos)"
  echo "[crons-loop] Próximo tick en ${INTERVAL_SECONDS}s"
  sleep "$INTERVAL_SECONDS"
done
