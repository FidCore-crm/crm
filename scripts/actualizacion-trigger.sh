#!/bin/bash
# =====================================================================
# actualizacion-trigger.sh
# =====================================================================
#
# Cron del HOST que revisa cada minuto si hay una actualización
# programada pendiente de ejecutar.
#
# Si el archivo `tmp/updates/pending.json` existe y su `programada_para`
# ya pasó (o es null = "actualizar ahora"), dispara aplicar-actualizacion.sh.
#
# Instalación (parte de INSTALACION.md):
#   1. Copiar este archivo a /usr/local/bin/pulzar-actualizacion-trigger.sh
#   2. Agregar al crontab del usuario que tiene acceso a Docker:
#        * * * * * /usr/local/bin/pulzar-actualizacion-trigger.sh
#   3. Asegurarse de que el usuario tenga acceso a `docker compose` sin sudo
#
# Output: log en `tmp/updates/trigger.log` para diagnóstico.

set -u

CRM_DIR="${CRM_DIR:-/home/nahuel/crm-seguros}"
TRIGGER_FILE="${CRM_DIR}/tmp/updates/pending.json"
TRIGGER_LOG="${CRM_DIR}/tmp/updates/trigger.log"
APLICAR_SCRIPT="${CRM_DIR}/scripts/aplicar-actualizacion.sh"
LOCK_FILE="${CRM_DIR}/tmp/updates/.in-progress"

# Si no hay archivo de trigger, no hay nada que hacer
[ -f "$TRIGGER_FILE" ] || exit 0

# Lock: si ya hay un update corriendo, salir silenciosamente
if [ -f "$LOCK_FILE" ]; then
  # Verificar si el proceso del lock todavía vive
  LOCK_PID=$(cat "$LOCK_FILE" 2>/dev/null)
  if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
    # Proceso vivo, no hacer nada
    exit 0
  fi
  # Lock viejo, lo limpiamos
  rm -f "$LOCK_FILE"
fi

mkdir -p "$(dirname "$TRIGGER_LOG")"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$TRIGGER_LOG"
}

# Parsear el JSON sin jq (queremos minimizar dependencias del host)
# Asumimos formato simple producido por src/lib/updater.ts.
ACTUALIZACION_ID=$(grep -oE '"actualizacion_id"\s*:\s*"[^"]+"' "$TRIGGER_FILE" | sed 's/.*"\([^"]*\)"$/\1/')
VERSION_NUEVA=$(grep -oE '"version_nueva"\s*:\s*"[^"]+"' "$TRIGGER_FILE" | sed 's/.*"\([^"]*\)"$/\1/')
PROGRAMADA_PARA=$(grep -oE '"programada_para"\s*:\s*"[^"]+"' "$TRIGGER_FILE" | sed 's/.*"\([^"]*\)"$/\1/')

if [ -z "$ACTUALIZACION_ID" ] || [ -z "$VERSION_NUEVA" ]; then
  log "trigger inválido (faltan campos), borrando: $(cat "$TRIGGER_FILE")"
  rm -f "$TRIGGER_FILE"
  exit 1
fi

# Si programada_para no es vacía, verificar que ya pasó
if [ -n "$PROGRAMADA_PARA" ]; then
  # Convertir ISO a epoch
  PROGRAMADA_EPOCH=$(date -d "$PROGRAMADA_PARA" +%s 2>/dev/null || echo 0)
  AHORA_EPOCH=$(date +%s)
  if [ "$PROGRAMADA_EPOCH" -gt "$AHORA_EPOCH" ]; then
    # Todavía no es hora — esperar al próximo tick
    exit 0
  fi
fi

# Disparar el update
log "Disparando aplicar-actualizacion.sh para v${VERSION_NUEVA} (id=${ACTUALIZACION_ID})"
echo $$ > "$LOCK_FILE"

# Exportamos las variables que el script espera
export ACTUALIZACION_ID
export VERSION_NUEVA
export CRM_DIR

# Ejecutamos en foreground (este script ya lo lanza cron en background)
# y capturamos exit code
bash "$APLICAR_SCRIPT"
EXIT_CODE=$?

rm -f "$LOCK_FILE"

log "aplicar-actualizacion.sh terminó con exit=$EXIT_CODE"
exit $EXIT_CODE
