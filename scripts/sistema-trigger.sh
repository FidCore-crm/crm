#!/bin/bash
# =====================================================================
# sistema-trigger.sh
# =====================================================================
#
# Cron del HOST que revisa cada minuto si hay un flag de apagar o
# reiniciar el servidor pendiente de ejecutar.
#
# Si encuentra tmp/sistema/apagar.flag o tmp/sistema/reiniciar.flag con
# timestamp reciente (<5min), ejecuta el comando correspondiente.
#
# Defensas:
#   - PATH explícito (cron no hereda /usr/local/bin).
#   - Validación de timestamp: descarta flags >5 min para evitar ejecutar
#     una orden que quedó dando vueltas tras un crash o redeploy.
#   - Borra el flag ANTES de ejecutar (idempotencia: si shutdown falla
#     o se reintenta el cron, no se re-ejecuta).
#   - Rotación de log a 1 MB.
#
# Solo APPLIANCE: este script NO se instala en modo VPS.
#
# Instalación (parte del wizard):
#   1. Copiar a /usr/local/bin/fidcore-sistema-trigger.sh
#   2. Configurar sudoers (NOPASSWD para shutdown y reboot):
#        echo "fidcore ALL=(root) NOPASSWD: /sbin/shutdown, /sbin/reboot" \
#          > /etc/sudoers.d/fidcore-sistema
#        chmod 0440 /etc/sudoers.d/fidcore-sistema
#   3. Agregar al crontab del usuario:
#        * * * * * /usr/local/bin/fidcore-sistema-trigger.sh

set -u

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

CRM_DIR="${CRM_DIR:-/home/fidcore/crm-seguros}"
SISTEMA_DIR="${CRM_DIR}/tmp/sistema"
APAGAR_FLAG="${SISTEMA_DIR}/apagar.flag"
REINICIAR_FLAG="${SISTEMA_DIR}/reiniciar.flag"
LOG_FILE="${SISTEMA_DIR}/sistema-trigger.log"
LOG_MAX_BYTES=$((1 * 1024 * 1024))   # 1 MB
TIMESTAMP_MAX_AGE_SECS=300            # 5 min

mkdir -p "$SISTEMA_DIR"

# Rotar log si supera 1 MB
if [ -f "$LOG_FILE" ]; then
  LSIZE=$(stat -c %s "$LOG_FILE" 2>/dev/null || echo 0)
  if [ "$LSIZE" -gt "$LOG_MAX_BYTES" ]; then
    mv -f "$LOG_FILE" "${LOG_FILE}.1" 2>/dev/null || true
  fi
fi

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG_FILE"
}

# Si no hay ningún flag, salir
[ -f "$APAGAR_FLAG" ] || [ -f "$REINICIAR_FLAG" ] || exit 0

# Procesar un flag: valida timestamp, borra el flag, ejecuta el comando.
# Args: $1 = path al flag, $2 = nombre legible ('apagar'|'reiniciar'),
#       $3 = comando sudo a ejecutar
procesar_flag() {
  local FLAG_PATH="$1"
  local NOMBRE="$2"
  local COMANDO="$3"

  [ -f "$FLAG_PATH" ] || return 0

  # Extraer timestamp del JSON (sin jq — minimizamos deps)
  local TS_RAW
  TS_RAW=$(grep -oE '"timestamp"\s*:\s*"[^"]+"' "$FLAG_PATH" | sed 's/.*"\([^"]*\)"$/\1/')

  if [ -z "$TS_RAW" ]; then
    log "Flag ${NOMBRE} sin timestamp — borrando por seguridad"
    rm -f "$FLAG_PATH"
    return 0
  fi

  local TS_EPOCH
  TS_EPOCH=$(date -d "$TS_RAW" +%s 2>/dev/null || echo 0)
  local AHORA_EPOCH
  AHORA_EPOCH=$(date +%s)
  local DELTA=$((AHORA_EPOCH - TS_EPOCH))

  if [ "$TS_EPOCH" -le 0 ] || [ "$DELTA" -gt "$TIMESTAMP_MAX_AGE_SECS" ]; then
    log "Flag ${NOMBRE} con timestamp inválido o viejo (${DELTA}s) — borrando"
    rm -f "$FLAG_PATH"
    return 0
  fi

  # Extraer email del solicitante para el log
  local EMAIL
  EMAIL=$(grep -oE '"solicitado_por_email"\s*:\s*"[^"]+"' "$FLAG_PATH" | sed 's/.*"\([^"]*\)"$/\1/')

  log "Ejecutando ${NOMBRE} (solicitado por ${EMAIL:-desconocido})"

  # Borrar el flag ANTES de ejecutar — idempotencia
  rm -f "$FLAG_PATH"

  # Ejecutar el comando con un delay para que el log se flushee
  ( sleep 2 && $COMANDO ) &
  disown
}

procesar_flag "$REINICIAR_FLAG" "reiniciar" "sudo -n /sbin/reboot"
procesar_flag "$APAGAR_FLAG" "apagar" "sudo -n /sbin/shutdown -h now"

exit 0
