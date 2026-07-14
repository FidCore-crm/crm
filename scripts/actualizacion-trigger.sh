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

# CRM_DIR se auto-detecta desde la ubicación del script (scripts/<este>.sh).
# Si el crontab pasa CRM_DIR explícito, respeta esa. Auto-detect evita depender
# del path de instalación — funciona en /opt/crm-fidcore (installer estándar),
# /home/nahuel/crm-seguros (server histórico del equipo), o cualquier custom.
if [ -z "${CRM_DIR:-}" ]; then
  CRM_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
fi
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

# Limpieza periódica de carpetas storage.pre-restore.* (cada 12h).
#
# Cada vez que ocurre un rollback o una restauración, backup-restore.sh mueve
# storage/ → storage.pre-restore.<timestamp>/ por seguridad. Esas carpetas
# acumulan disco y nunca se borran automáticamente. Las eliminamos pasados
# los 7 días: tiempo suficiente para detectar problemas post-rollback y
# recuperar archivos puntuales si fueran necesarios.
#
# El cleanup vive acá (script del host) y no en el cron del container porque
# las carpetas viven al lado de `storage/` en el project root, FUERA del
# bind-mount `./storage:/app/storage`. El container no puede verlas.
#
# Marker file con mtime: si tiene <12h, salteamos.
PRE_RESTORE_MARKER="${CRM_DIR}/tmp/updates/.last-pre-restore-cleanup"
PRE_RESTORE_TTL_DAYS=7
DEBE_LIMPIAR=1
if [ -f "$PRE_RESTORE_MARKER" ]; then
  MARKER_AGE_SEC=$(( $(date +%s) - $(stat -c %Y "$PRE_RESTORE_MARKER" 2>/dev/null || echo 0) ))
  [ "$MARKER_AGE_SEC" -lt 43200 ] && DEBE_LIMPIAR=0  # 12h = 43200s
fi
if [ "$DEBE_LIMPIAR" -eq 1 ] && [ -d "$CRM_DIR" ]; then
  CANT=$(find "$CRM_DIR" -maxdepth 1 -name "storage.pre-restore.*" -type d -mtime "+${PRE_RESTORE_TTL_DAYS}" 2>/dev/null | wc -l)
  if [ "$CANT" -gt 0 ]; then
    find "$CRM_DIR" -maxdepth 1 -name "storage.pre-restore.*" -type d -mtime "+${PRE_RESTORE_TTL_DAYS}" -exec rm -rf {} + 2>/dev/null
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Cleanup: ${CANT} carpetas storage.pre-restore.* eliminadas (más de ${PRE_RESTORE_TTL_DAYS} días)" >> "$TRIGGER_LOG"
  fi
  touch "$PRE_RESTORE_MARKER" 2>/dev/null || true
fi

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
#
# IMPORTANTE: capturamos exit code de `docker exec` por separado para distinguir
# "DB unreachable" (container caído, restart en curso) de "fila no existe".
# Si la DB está unreachable transitoriamente, NO borramos el trigger — esperamos
# al próximo tick (~1 min). Antes lo borraba y la actualización quedaba perdida.
ESTADO_DB_RAW=$(docker exec -i supabase-db psql -U supabase_admin -d postgres -tAc \
  "SELECT estado FROM actualizaciones WHERE id='${ACTUALIZACION_ID}';" 2>>"$TRIGGER_LOG")
DB_EXIT=$?
ESTADO_DB=$(echo "$ESTADO_DB_RAW" | tr -d '[:space:]')

if [ "$DB_EXIT" -ne 0 ]; then
  log "DB unreachable (docker exec exit=$DB_EXIT) — no borro trigger, reintento en el próximo tick"
  exit 0
fi

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

# Ejecutamos con `setsid` para que el script viva en su propio process group.
# Sin esto, el watcher de timeout interno (kill -- -$MAIN_PID) no puede matar
# subprocesos colgados como `docker compose build`, porque MAIN_PID no es PGID
# cuando heredamos el grupo del cron. Con setsid, MAIN_PID == PGID y `kill --`
# se lleva al bash y a todos sus hijos directos.
# Fallback a `bash` directo si setsid no existe (raro en Linux moderno).
if command -v setsid >/dev/null 2>&1; then
  setsid bash "$APLICAR_SCRIPT"
else
  log "WARN: setsid no disponible — el timeout watcher puede no matar subprocesos colgados"
  bash "$APLICAR_SCRIPT"
fi
EXIT_CODE=$?

rm -f "$LOCK_FILE"

log "aplicar-actualizacion.sh terminó con exit=$EXIT_CODE"
exit $EXIT_CODE
