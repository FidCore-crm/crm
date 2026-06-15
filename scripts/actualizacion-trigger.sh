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
# Defensas:
#   - PATH explícito (cron no hereda /usr/local/bin).
#   - Lock file con PID — no re-dispara si ya hay un script corriendo.
#   - Chequeo de estado en DB antes de invocar — si la fila ya está
#     FALLIDA/COMPLETADA/CANCELADA (típicamente por un retry de cron tras crash),
#     borra el trigger y sale silenciosamente para no relanzar todo.
#   - Validación de UUID del actualizacion_id antes de hablar con la DB.
#   - Rotación de cron.log y trigger.log para no crecer indefinidamente.
#
# Instalación (parte de INSTALACION.md):
#   1. Copiar este archivo a /usr/local/bin/fidcore-actualizacion-trigger.sh
#   2. Agregar al crontab del usuario que tiene acceso a Docker:
#        * * * * * /usr/local/bin/fidcore-actualizacion-trigger.sh
#   3. Asegurarse de que el usuario tenga acceso a `docker compose` sin sudo

set -u

# PATH explícito porque cron tiene PATH minimal — sin esto, `docker` y otros
# binarios pueden no encontrarse cuando se invoca desde crontab.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

CRM_DIR="${CRM_DIR:-/home/nahuel/crm-seguros}"
TRIGGER_FILE="${CRM_DIR}/tmp/updates/pending.json"
TRIGGER_LOG="${CRM_DIR}/tmp/updates/trigger.log"
CRON_LOG="${CRM_DIR}/tmp/updates/cron.log"
APLICAR_SCRIPT="${CRM_DIR}/scripts/aplicar-actualizacion.sh"
LOCK_FILE="${CRM_DIR}/tmp/updates/.in-progress"
LOG_MAX_BYTES=$((1 * 1024 * 1024))   # 1 MB

mkdir -p "$(dirname "$TRIGGER_LOG")"

# Rotar logs si superan 1 MB (incluye cron.log al que crontab redirige stdout)
for L in "$TRIGGER_LOG" "$CRON_LOG"; do
  if [ -f "$L" ]; then
    LSIZE=$(stat -c %s "$L" 2>/dev/null || echo 0)
    if [ "$LSIZE" -gt "$LOG_MAX_BYTES" ]; then
      mv -f "$L" "${L}.1" 2>/dev/null || true
    fi
  fi
done

# Si no hay archivo de trigger, no hay nada que hacer
[ -f "$TRIGGER_FILE" ] || exit 0

# Lock: si ya hay un update corriendo, salir silenciosamente
if [ -f "$LOCK_FILE" ]; then
  LOCK_PID=$(cat "$LOCK_FILE" 2>/dev/null)
  if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
    exit 0
  fi
  # Lock viejo (proceso muerto), lo limpiamos
  rm -f "$LOCK_FILE"
fi

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$TRIGGER_LOG"
}

# Parsear el JSON sin jq (queremos minimizar dependencias del host)
ACTUALIZACION_ID=$(grep -oE '"actualizacion_id"\s*:\s*"[^"]+"' "$TRIGGER_FILE" | sed 's/.*"\([^"]*\)"$/\1/')
VERSION_NUEVA=$(grep -oE '"version_nueva"\s*:\s*"[^"]+"' "$TRIGGER_FILE" | sed 's/.*"\([^"]*\)"$/\1/')
PROGRAMADA_PARA=$(grep -oE '"programada_para"\s*:\s*"[^"]+"' "$TRIGGER_FILE" | sed 's/.*"\([^"]*\)"$/\1/')

if [ -z "$ACTUALIZACION_ID" ] || [ -z "$VERSION_NUEVA" ]; then
  log "trigger inválido (faltan campos), borrando: $(cat "$TRIGGER_FILE")"
  rm -f "$TRIGGER_FILE"
  exit 1
fi

# Validar formato UUID — si está corrupto, descartar
if [[ ! "$ACTUALIZACION_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  log "trigger con UUID inválido: '${ACTUALIZACION_ID}' — borrando"
  rm -f "$TRIGGER_FILE"
  exit 1
fi

# Validar VERSION_NUEVA con regex semver flexible
if [[ ! "$VERSION_NUEVA" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][a-zA-Z0-9]+)*$ ]]; then
  log "trigger con VERSION_NUEVA inválida: '${VERSION_NUEVA}' — borrando"
  rm -f "$TRIGGER_FILE"
  exit 1
fi

# Chequear estado en DB ANTES de invocar el script pesado.
ESTADO_DB=$(docker exec -i supabase-db psql -U supabase_admin -d postgres -tAc \
  "SELECT estado FROM actualizaciones WHERE id='${ACTUALIZACION_ID}';" 2>/dev/null | tr -d '[:space:]')

case "$ESTADO_DB" in
  COMPLETADA|FALLIDA|CANCELADA)
    log "Trigger ignorado: fila ${ACTUALIZACION_ID:0:8} ya está en estado ${ESTADO_DB}. Borrando trigger."
    rm -f "$TRIGGER_FILE"
    exit 0
    ;;
  EJECUTANDO)
    log "Trigger ignorado: fila ${ACTUALIZACION_ID:0:8} ya está EJECUTANDO. Borrando trigger para no duplicar."
    rm -f "$TRIGGER_FILE"
    exit 0
    ;;
  PROGRAMADA)
    # OK, esperado — continuar
    ;;
  "")
    log "Trigger ignorado: fila ${ACTUALIZACION_ID} no existe en DB. Borrando trigger."
    rm -f "$TRIGGER_FILE"
    exit 1
    ;;
  *)
    log "Trigger con estado DB inesperado '${ESTADO_DB}' — borrando trigger por seguridad"
    rm -f "$TRIGGER_FILE"
    exit 1
    ;;
esac

# Si programada_para no es vacía, verificar que ya pasó
if [ -n "$PROGRAMADA_PARA" ]; then
  PROGRAMADA_EPOCH=$(date -d "$PROGRAMADA_PARA" +%s 2>/dev/null || echo 0)
  AHORA_EPOCH=$(date +%s)
  if [ "$PROGRAMADA_EPOCH" -gt "$AHORA_EPOCH" ]; then
    # Todavía no es hora — esperar al próximo tick
    exit 0
  fi
fi

# Disparar el update
log "Disparando aplicar-actualizacion.sh para v${VERSION_NUEVA} (id=${ACTUALIZACION_ID:0:8})"
echo $$ > "$LOCK_FILE"

# Exportamos las variables que el script espera
export ACTUALIZACION_ID
export VERSION_NUEVA
export CRM_DIR

# Ejecutamos en foreground (este script ya lo lanza cron en background)
bash "$APLICAR_SCRIPT"
EXIT_CODE=$?

rm -f "$LOCK_FILE"

log "aplicar-actualizacion.sh terminó con exit=$EXIT_CODE"
exit $EXIT_CODE
