#!/bin/bash
# =====================================================================
# aplicar-actualizacion.sh
# =====================================================================
#
# Aplica una actualización del CRM. Corre en el HOST (fuera del Docker).
#
# Lo ejecuta `actualizacion-trigger.sh` (cron del host) cuando detecta que
# el archivo `tmp/updates/pending.json` está listo para procesarse.
#
# Flujo (cada paso atómico y verificado):
#   0. Validaciones previas + capturar commit + setear EJECUTANDO atómico
#   1. Crear backup pre-update (.crmbak con DB + storage) + validar tar
#   2. git fetch + checkout del tag nuevo + validar package.json
#   3. docker compose build crm (con NEXT_PUBLIC_APP_VERSION inyectado)
#   4. Aplicar migraciones SQL nuevas (idempotente, error capturado)
#   5. docker compose up -d --force-recreate crm
#   6. Esperar healthcheck robusto (DB + filesystem + auth)
#   7. Actualizar version_actual en DB → marcar COMPLETADA
#
# Si CUALQUIER paso después del backup falla, dispara rollback automático.
#
# Mecanismos defensivos:
#   - PATH explícito para que cron del host encuentre docker, git, curl.
#   - Trap EXIT único que cubre cleanup + estado defensivo + log a DB.
#   - Timeout total robusto: si el script se cuelga, mata todo el process group.
#   - Marcado de estado atómico (UPDATE ... WHERE estado='PROGRAMADA' RETURNING).
#   - Chequeo periódico de "fui cancelado" entre pasos.
#   - Validación tar -tzf del backup + validación post-checkout del package.json.
#   - Healthcheck robusto via /api/health (no solo /login).
#   - progress.json con escape JSON para mensajes con caracteres especiales.
#   - Logs rotados para no crecer indefinidamente.
#
# Variables esperadas (las pasa el trigger script):
#   ACTUALIZACION_ID    UUID de la fila en `actualizaciones`
#   VERSION_NUEVA       Tag a aplicar (ej: 1.2.0)
#   CRM_DIR             Directorio root del CRM en el host

set -u

# PATH explícito porque cron tiene PATH minimal — sin esto, `docker compose`
# y otros binarios pueden no encontrarse cuando se invoca desde crontab.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Defaults
CRM_DIR="${CRM_DIR:-/opt/crm-fidcore}"
LOG_FILE="${CRM_DIR}/tmp/updates/last-run.log"
TRIGGER_FILE="${CRM_DIR}/tmp/updates/pending.json"
PROGRESS_FILE="${CRM_DIR}/tmp/updates/progress.json"
LOG_MAX_BYTES=$((5 * 1024 * 1024))   # 5 MB
TIMEOUT_TOTAL_SEC=1800               # 30 min
MAIN_PID=$$                          # PID real del script (lo usa el timeout)

# Carga variables del .env.docker (CRON_SECRET, etc.)
#
# IMPORTANTE: el .env.docker está pensado para el container, NO para el host.
# Tiene `POSTGRES_HOST=supabase-db` que solo resuelve adentro de la red Docker.
# Si lo dejamos en el environment del host, scripts hijos como aplicar-migraciones.sh
# intentan conectar por TCP a `supabase-db:5432` y fallan con "no se pudo conectar".
#
# Solución: hacer source pero después limpiar las vars de Postgres para que los
# scripts hijos usen el modo "docker exec supabase-db psql" (POSTGRES_HOST="").
if [ -f "${CRM_DIR}/.env.docker" ]; then
  set -a
  source "${CRM_DIR}/.env.docker"
  set +a
  unset POSTGRES_HOST POSTGRES_PORT POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB
fi

mkdir -p "$(dirname "$LOG_FILE")"

# Rotar log si supera 5 MB (conservamos el viejo como .1)
if [ -f "$LOG_FILE" ]; then
  LOG_SIZE=$(stat -c %s "$LOG_FILE" 2>/dev/null || echo 0)
  if [ "$LOG_SIZE" -gt "$LOG_MAX_BYTES" ]; then
    mv -f "$LOG_FILE" "${LOG_FILE}.1" 2>/dev/null || true
  fi
fi

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"
}

db_exec() {
  docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"
}

# Llama al endpoint TS /api/sistema/notificar-rollback. Best-effort: si el CRM
# no responde (el container puede estar caído en medio de un rollback fallido),
# loggeamos y seguimos — la prioridad es completar el rollback.
notificar_rollback_admin() {
  local version_intentada="$1"
  local version_actual="$2"
  local motivo_fallo="$3"
  local rollback_exitoso="$4"  # "true" | "false"

  if [ -z "$CRON_SECRET" ]; then
    log "  ⚠ CRON_SECRET vacío — no se puede notificar al admin"
    return 0
  fi

  # JSON crudo (escapamos comillas dobles en motivo_fallo)
  local motivo_escapado="${motivo_fallo//\"/\\\"}"
  local payload
  payload=$(printf '{"version_intentada":"%s","version_actual":"%s","motivo_fallo":"%s","rollback_exitoso":%s}' \
    "$version_intentada" "$version_actual" "$motivo_escapado" "$rollback_exitoso")

  local resp
  resp=$(curl -sf --max-time 10 \
    -X POST "http://localhost:3000/api/sistema/notificar-rollback" \
    -H "Authorization: Bearer $CRON_SECRET" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>&1 || echo "CURL_FAILED")

  if [ "$resp" = "CURL_FAILED" ]; then
    log "  ⚠ No se pudo notificar al admin (CRM no responde)"
  else
    log "  ✓ Admin notificado: $resp"
  fi
}

# Escapa una string para usar dentro de un string JSON.
# Reemplaza: \ → \\, " → \", newlines → \n, etc.
json_escape() {
  printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read())[1:-1], end="")' 2>/dev/null \
    || printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g' | tr -d '\n\r'
}

# Escribe un snapshot del paso actual + porcentaje al PROGRESS_FILE
# de forma atómica (escribe a tmp + mv). El frontend lo lee via
# /api/actualizaciones/estado.
escribir_progreso() {
  local paso="$1"
  local porcentaje="${2:-0}"
  local mensaje="${3:-}"
  local mensaje_esc
  mensaje_esc=$(json_escape "$mensaje")
  local tmp="${PROGRESS_FILE}.tmp"
  cat > "$tmp" <<EOF
{
  "actualizacion_id": "${ACTUALIZACION_ID:-}",
  "paso": "${paso}",
  "porcentaje": ${porcentaje},
  "mensaje": "${mensaje_esc}",
  "actualizado_en": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  mv -f "$tmp" "$PROGRESS_FILE" 2>/dev/null || true
}

# Variables que se llenan durante la ejecución (para uso del rollback)
COMMIT_PRE_UPDATE=""
BACKUP_ID=""
BACKUP_PATH=""
MIGRACIONES_APLICADAS=0
CHECKOUT_HECHO=0
ESTADO_FINAL_MARCADO=0
TIMEOUT_PID=""

# Marca el estado de la actualización en DB. Args: $1=estado, $2=mensaje opcional.
# Setea ESTADO_FINAL_MARCADO=1 cuando llega a COMPLETADA/FALLIDA/CANCELADA.
#
# Atomicidad: cuando el estado destino es final (COMPLETADA/FALLIDA/CANCELADA),
# el UPDATE incluye `AND estado NOT IN ('COMPLETADA','FALLIDA','CANCELADA')`.
# Esto protege la decisión del admin si hizo forzar-cierre desde la UI mientras
# el script seguía corriendo: el primer estado final que se haya escrito gana,
# y el rollback/cleanup posterior NO pisa el motivo original. También evita
# pisarse a sí mismo si por error se llama dos veces en cadena.
marcar_actualizacion() {
  local estado="$1"
  local mensaje="${2:-}"
  local sql="UPDATE actualizaciones SET estado='${estado}'"

  if [ -n "$mensaje" ]; then
    local mensaje_escaped="${mensaje//\'/\'\'}"
    sql="$sql, error_mensaje='${mensaje_escaped}'"
  fi
  if [ -n "$BACKUP_ID" ] && [[ "$BACKUP_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    sql="$sql, backup_id='${BACKUP_ID}'"
  fi

  local where_extra=""
  case "$estado" in
    EJECUTANDO)
      # COALESCE para no pisar la fecha original si se llama 2 veces
      sql="$sql, fecha_inicio_ejecucion=COALESCE(fecha_inicio_ejecucion, now())"
      ;;
    COMPLETADA|FALLIDA|CANCELADA)
      sql="$sql, fecha_fin_ejecucion=now()"
      ESTADO_FINAL_MARCADO=1
      # Atomicidad: no pisar otro estado final ya escrito (admin forzó cierre,
      # o se llamó dos veces a marcar_actualizacion en cadena).
      where_extra=" AND estado NOT IN ('COMPLETADA','FALLIDA','CANCELADA')"
      ;;
  esac

  sql="$sql WHERE id='${ACTUALIZACION_ID}'${where_extra};"
  db_exec -c "$sql" >> "$LOG_FILE" 2>&1 || log "WARN: db_exec falló para estado=$estado"
}

# Marca EJECUTANDO de forma ATÓMICA: solo cambia si está en PROGRAMADA.
# Devuelve 0 si se hizo el cambio, 1 si la fila fue cancelada/avanzada por otro.
# Esto cierra la race condition con `cancelarActualizacion` del backend.
marcar_ejecutando_atomico() {
  local out
  out=$(db_exec -tAc \
    "UPDATE actualizaciones
       SET estado='EJECUTANDO',
           fecha_inicio_ejecucion=COALESCE(fecha_inicio_ejecucion, now())
     WHERE id='${ACTUALIZACION_ID}' AND estado='PROGRAMADA'
     RETURNING id;" 2>&1 | head -1 | tr -d '[:space:]')
  if [ -n "$out" ] && [[ "$out" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    return 0
  fi
  return 1
}

# Marca COMPLETADA de forma ATÓMICA: solo cambia si está en EJECUTANDO.
# Si el admin marcó FALLIDA (forzar-cierre) mientras el script seguía corriendo,
# NO pisamos esa decisión — devolvemos error y el cleanup respeta el estado.
# Si hay BACKUP_ID válido, lo linkeamos para que se vea en la UI del historial.
marcar_completada_atomica() {
  local set_backup=""
  if [ -n "$BACKUP_ID" ] && [[ "$BACKUP_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    set_backup=", backup_id='${BACKUP_ID}'"
  fi
  local out
  out=$(db_exec -tAc \
    "UPDATE actualizaciones
       SET estado='COMPLETADA',
           fecha_fin_ejecucion=now()${set_backup}
     WHERE id='${ACTUALIZACION_ID}' AND estado='EJECUTANDO'
     RETURNING id;" 2>&1 | head -1 | tr -d '[:space:]')
  if [ -n "$out" ] && [[ "$out" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    ESTADO_FINAL_MARCADO=1
    return 0
  fi
  # No se pudo marcar COMPLETADA — la fila ya no está en EJECUTANDO.
  # Eso significa que un admin la cerró manualmente. Respetamos esa decisión.
  ESTADO_FINAL_MARCADO=1
  return 1
}

# Chequea si la actualización fue finalizada externamente entre dos pasos
# (admin la canceló con "Cancelar" o forzó cierre con "Marcar como fallida").
# Si sí, abortamos limpio SIN pisar el estado externo.
# Llamarlo antes de cada paso pesado.
abortar_si_finalizado() {
  local estado_actual
  estado_actual=$(db_exec -tAc \
    "SELECT estado FROM actualizaciones WHERE id='${ACTUALIZACION_ID}';" 2>/dev/null \
    | head -1 | tr -d '[:space:]')
  case "$estado_actual" in
    CANCELADA|FALLIDA|COMPLETADA)
      log "  ⚠ Estado externo cambió a ${estado_actual} — abortando sin tocar"
      ESTADO_FINAL_MARCADO=1   # no pisamos lo que ya quedó
      escribir_progreso "$estado_actual" 100 "Estado modificado externamente"
      exit 1
      ;;
  esac
}

# Guarda el log completo del run en DB via stdin (\copy desde STDIN).
# Maneja cualquier carácter especial sin necesidad de escape manual y no
# depende del filesystem del container.
guardar_log_completo() {
  [ -f "$LOG_FILE" ] || return 0
  # Truncar a 256 KB para no saturar la fila
  local truncated
  truncated=$(tail -c 262144 "$LOG_FILE")

  {
    echo "BEGIN;"
    echo "CREATE TEMP TABLE _log_buf(linea text);"
    echo "\\copy _log_buf FROM STDIN"
    printf '%s\n' "$truncated"
    echo "\\."
    echo "UPDATE actualizaciones SET log_completo = (SELECT string_agg(linea, E'\\n') FROM _log_buf) WHERE id = '${ACTUALIZACION_ID}';"
    echo "COMMIT;"
  } | docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 >>"$LOG_FILE" 2>&1 \
    || log "WARN: no se pudo guardar log_completo en DB"
}

# =====================================================================
# ROLLBACK AUTOMÁTICO
# =====================================================================
ejecutar_rollback() {
  local motivo_fallo="$1"

  # Marker explícito y filtrable en log_completo. La pantalla
  # /crm/configuracion/actualizaciones puede greppear "[ROLLBACK_EVENT]" para
  # listar updates donde el sistema tuvo que volver atrás.
  log ""
  log "[ROLLBACK_EVENT] ═══════════════════════════════════════════════════════════════"
  log "[ROLLBACK_EVENT]   ⚠ EL UPDATE FALLÓ — Iniciando rollback automático"
  log "[ROLLBACK_EVENT]   Motivo: ${motivo_fallo}"
  log "[ROLLBACK_EVENT]   Versión intentada: ${VERSION_NUEVA:-desconocida}"
  log "[ROLLBACK_EVENT] ═══════════════════════════════════════════════════════════════"

  escribir_progreso "ROLLBACK" 0 "$motivo_fallo"

  local rollback_exitoso=1
  local restaurar_db=0
  local restaurar_storage=0

  # Decidir qué restaurar según hasta dónde llegamos
  if [ $MIGRACIONES_APLICADAS -eq 1 ]; then
    restaurar_db=1
    restaurar_storage=1
  elif [ -n "$BACKUP_PATH" ] && [ -f "$BACKUP_PATH" ]; then
    # Hay backup pero migraciones no se aplicaron → solo storage por las dudas
    restaurar_storage=1
  fi

  # Paso A: volver al commit anterior si ya hicimos checkout
  if [ $CHECKOUT_HECHO -eq 1 ] && [ -n "$COMMIT_PRE_UPDATE" ]; then
    log "  [rollback A] git reset --hard ${COMMIT_PRE_UPDATE:0:12}"
    if cd "$CRM_DIR"; then
      if git reset --hard "$COMMIT_PRE_UPDATE" 2>&1 | tee -a "$LOG_FILE"; then
        log "  ✓ Código volvió al commit anterior"
      else
        log "  WARN: git reset falló"
        rollback_exitoso=0
      fi
    else
      rollback_exitoso=0
    fi
  fi

  # Paso B: restaurar backup (DB y/o storage según corresponda)
  if [ "$restaurar_db" -eq 1 ] || [ "$restaurar_storage" -eq 1 ]; then
    if [ -n "$BACKUP_PATH" ] && [ -f "$BACKUP_PATH" ]; then
      log "  [rollback B] Restaurando ${BACKUP_PATH##*/} (db=$restaurar_db, storage=$restaurar_storage)"

      local WORK_DIR
      WORK_DIR=$(mktemp -d -t fidcore-rollback-XXXXXX)

      if tar -xzf "$BACKUP_PATH" -C "$WORK_DIR" 2>&1 | tee -a "$LOG_FILE"; then
        bash "$CRM_DIR/scripts/backup-restore.sh" \
          --work-dir="$WORK_DIR" \
          --restaurar-db="$restaurar_db" \
          --restaurar-storage="$restaurar_storage" \
          2>&1 | tee -a "$LOG_FILE"
        if [ "${PIPESTATUS[0]}" -eq 0 ]; then
          log "  ✓ Backup restaurado"
        else
          log "  ⚠ backup-restore.sh devolvió error — revisar manualmente"
          rollback_exitoso=0
        fi
      else
        log "  ⚠ No se pudo extraer ${BACKUP_PATH}"
        rollback_exitoso=0
      fi

      rm -rf "$WORK_DIR" 2>/dev/null
    else
      log "  ⚠ No hay backup disponible para restaurar"
      rollback_exitoso=0
    fi
  fi

  # Paso C: rebuild + restart del container con el código (ahora viejo)
  if [ $CHECKOUT_HECHO -eq 1 ]; then
    log "  [rollback C] Reconstruyendo container con código anterior..."
    if cd "$CRM_DIR"; then
      # También exportamos versión vieja para el sidebar
      local version_vieja
      version_vieja=$(grep -oE '"version": *"[^"]+"' "$CRM_DIR/package.json" | head -1 | cut -d'"' -f4)
      export NEXT_PUBLIC_APP_VERSION="$version_vieja"
      if docker compose build crm 2>&1 | tee -a "$LOG_FILE"; then
        if docker compose up -d --force-recreate crm 2>&1 | tee -a "$LOG_FILE"; then
          log "  ✓ Container reconstruido con código anterior"
        else
          log "  ⚠ Restart del rollback falló"
          rollback_exitoso=0
        fi
      else
        log "  ⚠ Build del rollback falló — el CRM puede quedar inaccesible"
        rollback_exitoso=0
      fi
    else
      rollback_exitoso=0
    fi
  fi

  # Paso D: marcar la actualización con el mensaje apropiado
  local version_actual
  version_actual=$(grep -oE '"version": *"[^"]+"' "$CRM_DIR/package.json" | head -1 | cut -d'"' -f4)
  if [ $rollback_exitoso -eq 1 ]; then
    marcar_actualizacion FALLIDA "$motivo_fallo. Rollback aplicado: el sistema volvió a v${version_actual}."
    log "[ROLLBACK_EVENT]   ✓ Rollback completado. El CRM está corriendo v${version_actual}."
    escribir_progreso "ROLLBACK_OK" 100 "Rollback exitoso — sistema en v${version_actual}"
  else
    marcar_actualizacion FALLIDA "$motivo_fallo. ⚠ EL ROLLBACK TAMBIÉN FALLÓ — revisar manualmente el servidor."
    log "[ROLLBACK_EVENT]   ⚠ Rollback INCOMPLETO. El servidor puede estar en estado inconsistente."
    log "[ROLLBACK_EVENT]   Acción manual: SSH al servidor y verificar 'docker ps' + estado de DB."
    escribir_progreso "ROLLBACK_FAILED" 100 "Rollback incompleto — revisar manualmente"
  fi

  # Paso E: notificar al admin por email + notif in-app via endpoint TS.
  # Esto es independiente del éxito del rollback — el admin necesita enterarse
  # en ambos casos. Si el CRM no responde (rollback fallido catastrófico) el
  # helper loggea y sigue sin abortar.
  local rollback_flag="false"
  [ $rollback_exitoso -eq 1 ] && rollback_flag="true"
  log "[ROLLBACK_EVENT]   Notificando al admin..."
  notificar_rollback_admin \
    "${VERSION_NUEVA:-desconocida}" \
    "$version_actual" \
    "$motivo_fallo" \
    "$rollback_flag"

  exit 1
}

# =====================================================================
# Cleanup unificado (trap EXIT)
# =====================================================================
#
# Se ejecuta SIEMPRE al salir del script (éxito, error, signal, exit).
# Es UN solo trap que cubre todo:
#   - Mata el watcher de timeout si sigue vivo.
#   - Borra el trigger file (que actualizacion-trigger.sh no re-dispare).
#   - Mata el process group entero (incluido docker compose build si quedó vivo).
#   - Si la fila quedó en EJECUTANDO sin marcar resultado explícito,
#     marcarla FALLIDA (cubre crashes: kill -9, OOM, set -u, etc.).
#   - Guarda log_completo en DB (para historial).
cleanup_total() {
  local exit_code=$?

  # Matar el watcher de timeout (si sigue corriendo)
  if [ -n "$TIMEOUT_PID" ]; then
    kill "$TIMEOUT_PID" 2>/dev/null || true
  fi

  # Borrar trigger para que el cron no re-dispare
  rm -f "$TRIGGER_FILE"

  # Si terminó sin marcar resultado explícito, marcar FALLIDA defensivamente
  if [ "$ESTADO_FINAL_MARCADO" -eq 0 ] && [ -n "${ACTUALIZACION_ID:-}" ]; then
    log ""
    log "  ⚠ El script terminó (exit=$exit_code) sin marcar resultado explícito."
    log "  Marcando actualización como FALLIDA para que la UI no quede stuck."
    marcar_actualizacion FALLIDA "El script terminó inesperadamente (exit $exit_code). Revisar log_completo para detalles."
    escribir_progreso "FAILED" 100 "El script terminó inesperadamente"
  fi

  guardar_log_completo
}
trap cleanup_total EXIT

# Timeout watcher robusto: usa MAIN_PID (capturado antes de la subshell) +
# kill al process group para matar también procesos hijos colgados (build, etc.).
(
  sleep "$TIMEOUT_TOTAL_SEC"
  if kill -0 "$MAIN_PID" 2>/dev/null; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] FATAL: timeout total ${TIMEOUT_TOTAL_SEC}s alcanzado, matando script y procesos hijos" >> "$LOG_FILE"
    # Matar el process group (negativo = pgid) para llevarse hijos colgados
    kill -TERM -- "-$MAIN_PID" 2>/dev/null || kill -TERM "$MAIN_PID" 2>/dev/null
    sleep 5
    # Si sigue vivo después de 5s, kill -9
    kill -KILL -- "-$MAIN_PID" 2>/dev/null || kill -KILL "$MAIN_PID" 2>/dev/null
  fi
) &
TIMEOUT_PID=$!

# =====================================================================
# Validaciones previas
# =====================================================================

if [ -z "${ACTUALIZACION_ID:-}" ]; then
  log "FATAL: falta variable ACTUALIZACION_ID"
  exit 1
fi
if [ -z "${VERSION_NUEVA:-}" ]; then
  log "FATAL: falta variable VERSION_NUEVA"
  exit 1
fi
if [ ! -d "$CRM_DIR/.git" ]; then
  log "FATAL: $CRM_DIR no es un repo git"
  exit 1
fi

# Verificar que el usuario tenga acceso a Docker. Si el cron del host corre con
# un usuario sin grupo `docker` (o sin sudoers para docker), todos los pasos
# fallan más adelante con "permission denied" confuso. Mejor abortar limpio.
if ! docker ps >/dev/null 2>&1; then
  log "FATAL: el usuario que ejecuta este script no tiene acceso a Docker."
  log "       Solución: agregar el usuario al grupo 'docker' con"
  log "         sudo usermod -aG docker \$USER"
  log "       y volver a iniciar sesión."
  if [ -n "${ACTUALIZACION_ID:-}" ]; then
    # No podemos hablar con la DB sin docker — solo dejar marcado en log
    echo "Si el cron host corre con un usuario sin acceso a docker, el script no puede actualizar." >> "$LOG_FILE"
  fi
  exit 1
fi

# Verificar que los containers críticos existan (no necesariamente corriendo)
if ! docker inspect fidcore-crm >/dev/null 2>&1; then
  log "FATAL: el container 'fidcore-crm' no existe. ¿La instalación del CRM está completa?"
  exit 1
fi
if ! docker inspect supabase-db >/dev/null 2>&1; then
  log "FATAL: el container 'supabase-db' no existe. ¿Supabase self-hosted está instalado?"
  exit 1
fi

log "═══════════════════════════════════════════════════════════════"
log "  Aplicando actualización a FidCore v${VERSION_NUEVA}"
log "  ID: ${ACTUALIZACION_ID}"
log "  Directorio: ${CRM_DIR}"
log "  Timeout total: ${TIMEOUT_TOTAL_SEC}s"
log "═══════════════════════════════════════════════════════════════"

# CRÍTICO: marcar EJECUTANDO de forma ATÓMICA antes de empezar.
# Si la fila ya no está en PROGRAMADA (porque fue cancelada o ya pasó a
# EJECUTANDO por otro proceso), abortamos sin tocar nada.
if ! marcar_ejecutando_atomico; then
  log "FATAL: no se pudo cambiar PROGRAMADA → EJECUTANDO. La fila puede haber sido"
  log "       cancelada por el usuario o ya estar siendo procesada por otro script."
  ESTADO_FINAL_MARCADO=1   # No marcar nada en cleanup — el estado ya es correcto
  exit 1
fi
escribir_progreso "INICIANDO" 1 "Preparando actualización"

# Capturar commit actual ANTES de tocar nada (para rollback)
cd "$CRM_DIR" || { log "FATAL: no se pudo cd a $CRM_DIR"; exit 1; }
COMMIT_PRE_UPDATE=$(git rev-parse HEAD)
log "Commit pre-update: ${COMMIT_PRE_UPDATE:0:12}"

# =====================================================================
# Pre-flight: validar que el commit del tag nuevo sea distinto al HEAD actual.
# Si son iguales (caso típico: alguien commiteó directo en el filesystem del
# server donde corre el CRM), el rollback no tendría a dónde volver — sería
# imposible recuperar si las migraciones fallan. Mejor abortar antes de tocar
# storage y DB.
# =====================================================================
log "Pre-flight: verificando que v${VERSION_NUEVA} sea efectivamente más nueva..."
git fetch --tags --quiet origin 2>&1 | tee -a "$LOG_FILE"
if [ "${PIPESTATUS[0]}" -ne 0 ]; then
  log "FATAL: git fetch falló. Verificá conexión a internet."
  marcar_actualizacion FALLIDA "Pre-flight: git fetch falló. Verificá conectividad a github.com."
  exit 1
fi

TAG_VERIFICACION=""
if git rev-parse "v${VERSION_NUEVA}" >/dev/null 2>&1; then
  TAG_VERIFICACION="v${VERSION_NUEVA}"
elif git rev-parse "V${VERSION_NUEVA}" >/dev/null 2>&1; then
  TAG_VERIFICACION="V${VERSION_NUEVA}"
else
  log "FATAL: el tag v${VERSION_NUEVA} no existe en GitHub."
  marcar_actualizacion FALLIDA "Pre-flight: el tag v${VERSION_NUEVA} no existe en GitHub (probé también V${VERSION_NUEVA})."
  exit 1
fi

COMMIT_TAG_NUEVO=$(git rev-parse "$TAG_VERIFICACION")
if [ "$COMMIT_TAG_NUEVO" = "$COMMIT_PRE_UPDATE" ]; then
  log ""
  log "FATAL: el commit del tag $TAG_VERIFICACION es IDÉNTICO al HEAD actual."
  log "  HEAD actual:        ${COMMIT_PRE_UPDATE:0:12}"
  log "  Tag $TAG_VERIFICACION: ${COMMIT_TAG_NUEVO:0:12}"
  log ""
  log "Esto suele pasar cuando el repo del CRM se usa para commits directos"
  log "(el filesystem del server es el mismo que el del development). El"
  log "rollback automático no tendría a dónde volver si las migraciones fallan."
  log ""
  log "Solución: hacé el rebuild manualmente con:"
  log "  cd $CRM_DIR && docker compose build crm && docker compose up -d --force-recreate"
  log ""
  marcar_actualizacion FALLIDA "Pre-flight abortó: el código local ya contiene el commit del tag $TAG_VERIFICACION. Rebuild manual necesario (ver log)."
  exit 1
fi
log "  ✓ Pre-flight OK — HEAD: ${COMMIT_PRE_UPDATE:0:12}, $TAG_VERIFICACION: ${COMMIT_TAG_NUEVO:0:12}"

# =====================================================================
# Paso 1: Backup pre-update
# =====================================================================

abortar_si_finalizado
log "[1/6] Creando backup pre-update..."
escribir_progreso "BACKUP" 10 "Creando backup del sistema"

# backup-now.sh corre DENTRO del container (pg_dump 15 vive ahí, no en host)
BACKUP_OUTPUT=$(docker exec fidcore-crm bash /app/scripts/backup-now.sh --tipo=PRE_UPDATE 2>&1)
BACKUP_EXIT=$?

if [ $BACKUP_EXIT -ne 0 ]; then
  log "FATAL: backup-now.sh falló (exit $BACKUP_EXIT). Output completo:"
  echo "$BACKUP_OUTPUT" | tee -a "$LOG_FILE"
  marcar_actualizacion FALLIDA "El backup pre-update falló (exit $BACKUP_EXIT). Revisar log para detalles."
  exit 1
fi

# Parsear BACKUP_RESULT_JSON={...} del output del script
BACKUP_JSON=$(echo "$BACKUP_OUTPUT" | grep -oE 'BACKUP_RESULT_JSON=\{.*\}' | sed 's/^BACKUP_RESULT_JSON=//')
if [ -z "$BACKUP_JSON" ]; then
  log "FATAL: backup-now.sh no devolvió BACKUP_RESULT_JSON. Output completo:"
  echo "$BACKUP_OUTPUT" | tee -a "$LOG_FILE"
  marcar_actualizacion FALLIDA "El backup se completó pero no devolvió metadata utilizable."
  exit 1
fi

BACKUP_NOMBRE=$(echo "$BACKUP_JSON" | grep -oE '"nombre"\s*:\s*"[^"]+"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
BACKUP_PATH=$(echo "$BACKUP_JSON" | grep -oE '"archivo_unico_path"\s*:\s*"[^"]+"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
BACKUP_SIZE=$(echo "$BACKUP_JSON" | grep -oE '"archivo_unico_tamano_bytes"\s*:\s*[0-9]+' | head -1 | grep -oE '[0-9]+$')
BACKUP_DB_SIZE=$(echo "$BACKUP_JSON" | grep -oE '"tamano_db"\s*:\s*[0-9]+' | head -1 | grep -oE '[0-9]+$')
BACKUP_STORAGE_SIZE=$(echo "$BACKUP_JSON" | grep -oE '"tamano_storage"\s*:\s*[0-9]+' | head -1 | grep -oE '[0-9]+$')
BACKUP_DURACION=$(echo "$BACKUP_JSON" | grep -oE '"duracion"\s*:\s*[0-9]+' | head -1 | grep -oE '[0-9]+$')

if [ -z "$BACKUP_NOMBRE" ] || [ -z "$BACKUP_PATH" ]; then
  log "FATAL: no se pudo parsear backup metadata: $BACKUP_JSON"
  marcar_actualizacion FALLIDA "El backup se creó pero no se pudo identificar para hacer rollback."
  exit 1
fi

# Validar que el archivo existe físicamente
if [ ! -f "$BACKUP_PATH" ]; then
  log "FATAL: el backup se reporta como creado pero no se encuentra en $BACKUP_PATH"
  marcar_actualizacion FALLIDA "El backup se reportó OK pero el archivo no existe en disco."
  exit 1
fi

# Validar integridad del tar.gz (CRC + estructura)
log "  Validando integridad del backup..."
if ! tar -tzf "$BACKUP_PATH" >/dev/null 2>&1; then
  log "FATAL: el backup ${BACKUP_PATH##*/} está corrupto o no es un tar.gz válido"
  marcar_actualizacion FALLIDA "El backup se creó pero está corrupto (tar -tzf falló). No se puede continuar sin un backup íntegro."
  exit 1
fi

# Validar integridad ADICIONAL del database.sql.gz interno (defensivo:
# backup-now.sh ya tiene `set -o pipefail` pero validar acá protege contra
# corrupción del filesystem o copia parcial).
log "  Validando integridad del .sql.gz interno..."
if ! tar -xzOf "$BACKUP_PATH" --wildcards '*/database.sql.gz' 2>/dev/null | gunzip -t 2>/dev/null; then
  log "FATAL: database.sql.gz dentro del backup está corrupto"
  marcar_actualizacion FALLIDA "El backup contiene un database.sql.gz corrupto. No se puede continuar."
  exit 1
fi

# Insertar manualmente la fila en la tabla `backups`
BACKUP_ID=$(docker exec -i supabase-db psql -U supabase_admin -d postgres -tAc "
INSERT INTO backups (
  nombre, tipo, estado,
  fecha_inicio, fecha_fin, duracion_segundos,
  tamano_db_bytes, tamano_storage_bytes, tamano_total_bytes,
  archivo_unico_path, archivo_unico_tamano_bytes,
  contenido_incluido
) VALUES (
  '${BACKUP_NOMBRE}', 'PRE_UPDATE', 'COMPLETADO',
  now() - interval '${BACKUP_DURACION:-0} seconds', now(), ${BACKUP_DURACION:-0},
  ${BACKUP_DB_SIZE:-0}, ${BACKUP_STORAGE_SIZE:-0}, ${BACKUP_SIZE:-0},
  '${BACKUP_PATH}', ${BACKUP_SIZE:-0},
  '{\"database\":true,\"storage\":true}'::jsonb
)
RETURNING id;
" 2>&1 | head -1 | tr -d '[:space:]')

if [ -z "$BACKUP_ID" ] || [[ ! "$BACKUP_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  log "FATAL: no se pudo registrar el backup en DB. Output: $BACKUP_ID"
  marcar_actualizacion FALLIDA "El backup físico se creó pero no se pudo registrar en DB."
  exit 1
fi

log "  ✓ Backup OK — id=${BACKUP_ID:0:8} path=${BACKUP_PATH##*/} (${BACKUP_DURACION}s, $(numfmt --to=iec ${BACKUP_SIZE:-0}))"
escribir_progreso "BACKUP_OK" 25 "Backup creado y validado"

# A partir de acá, cualquier fallo dispara rollback

# =====================================================================
# Paso 2: git fetch + checkout + validación post-checkout
# =====================================================================

abortar_si_finalizado
log "[2/6] Descargando v${VERSION_NUEVA} desde GitHub..."
escribir_progreso "FETCH" 30 "Descargando código nuevo"

cd "$CRM_DIR" || ejecutar_rollback "No se pudo cd a $CRM_DIR"

git fetch --tags --quiet origin 2>&1 | tee -a "$LOG_FILE"
if [ "${PIPESTATUS[0]}" -ne 0 ]; then
  ejecutar_rollback "git fetch falló. Verificá conexión a internet."
fi

# El tag en GitHub puede tener prefijo `v` o `V` — tolerar ambos.
TAG_USADO=""
if git rev-parse "v${VERSION_NUEVA}" >/dev/null 2>&1; then
  TAG_USADO="v${VERSION_NUEVA}"
elif git rev-parse "V${VERSION_NUEVA}" >/dev/null 2>&1; then
  TAG_USADO="V${VERSION_NUEVA}"
else
  ejecutar_rollback "El tag v${VERSION_NUEVA} no existe en GitHub (probé también V${VERSION_NUEVA})."
fi

# Descartar cambios uncommitted en archivos tracked. Sin esto, si alguien
# editó algo directo en el server (típico: soporte toca un archivo en
# ${CRM_DIR} para debuggear o aplicar un parche caliente), el `git checkout`
# aborta con "Your local changes would be overwritten" y el update entero
# falla. Como la regla es que los commits se hacen en crm-dev y nunca acá,
# cualquier cambio local en este working tree es prescindible.
# Esto NO toca el HEAD (los commits), ni archivos untracked (.env.docker,
# storage/, tmp/, etc.). Solo descarta modificaciones a archivos tracked.
git reset --hard HEAD --quiet 2>&1 | tee -a "$LOG_FILE" || true

git checkout "$TAG_USADO" --quiet 2>&1 | tee -a "$LOG_FILE"
if [ "${PIPESTATUS[0]}" -ne 0 ]; then
  ejecutar_rollback "git checkout $TAG_USADO falló."
fi
CHECKOUT_HECHO=1

# Validación post-checkout: confirmar que package.json realmente cambió
PKG_VERSION_POST=$(grep -oE '"version": *"[^"]+"' "$CRM_DIR/package.json" | head -1 | cut -d'"' -f4)
if [ "$PKG_VERSION_POST" != "$VERSION_NUEVA" ]; then
  ejecutar_rollback "Post-checkout: package.json dice v${PKG_VERSION_POST} pero esperábamos v${VERSION_NUEVA}. El tag puede estar mal apuntado en GitHub."
fi
log "  ✓ Código actualizado a v${VERSION_NUEVA} (package.json verificado)"
escribir_progreso "FETCH_OK" 35 "Código v${VERSION_NUEVA} descargado"

# =====================================================================
# Paso 3: Build de la imagen Docker
# =====================================================================

abortar_si_finalizado
log "[3/6] Building imagen Docker (puede tardar 3-5 minutos)..."
escribir_progreso "BUILD" 45 "Reconstruyendo el sistema (3-5 min)"

# Exportamos NEXT_PUBLIC_APP_VERSION para que docker-compose.yml lo pase como
# build arg al Dockerfile. Sin esto, queda hardcoded en "1.0.0" (default) y el
# sidebar del CRM nuevo muestra una versión incorrecta.
export NEXT_PUBLIC_APP_VERSION="$VERSION_NUEVA"

docker compose build crm 2>&1 | tee -a "$LOG_FILE"
if [ "${PIPESTATUS[0]}" -ne 0 ]; then
  ejecutar_rollback "Build de Docker falló. Revisar log para detalles."
fi
log "  ✓ Imagen built con NEXT_PUBLIC_APP_VERSION=${VERSION_NUEVA}"
escribir_progreso "BUILD_OK" 70 "Sistema reconstruido"

# =====================================================================
# Paso 4: Aplicar migraciones SQL
# =====================================================================

abortar_si_finalizado
log "[4/6] Aplicando migraciones SQL nuevas..."
escribir_progreso "MIGRATIONS" 75 "Aplicando cambios de base de datos"

# Capturamos stdout+stderr a archivo separado para extraer mensaje útil si falla.
MIG_LOG=$(mktemp)
# POSTGRES_HOST="" + CRM_ENV_FILE=/dev/null fuerza modo `docker exec supabase-db psql`
# POSTGRES_USER=supabase_admin garantiza permisos sobre auth.* y todas las tablas.
POSTGRES_HOST= POSTGRES_PORT= POSTGRES_PASSWORD= POSTGRES_DB=postgres \
  POSTGRES_USER=supabase_admin \
  CRM_ENV_FILE=/dev/null \
  bash "$CRM_DIR/scripts/aplicar-migraciones.sh" >"$MIG_LOG" 2>&1
MIG_EXIT=$?
cat "$MIG_LOG" | tee -a "$LOG_FILE"

if [ $MIG_EXIT -ne 0 ]; then
  # Extraer últimas líneas relevantes para mostrar al PAS
  local_resumen=$(tail -10 "$MIG_LOG" | head -5)
  rm -f "$MIG_LOG"
  ejecutar_rollback "Las migraciones SQL fallaron (exit $MIG_EXIT). Resumen: ${local_resumen}"
fi
rm -f "$MIG_LOG"
MIGRACIONES_APLICADAS=1
log "  ✓ Migraciones aplicadas"
escribir_progreso "MIGRATIONS_OK" 85 "Base de datos actualizada"

# =====================================================================
# Paso 5: Recrear container
# =====================================================================

abortar_si_finalizado
log "[5/6] Recreando container con la imagen nueva..."
escribir_progreso "RESTART" 90 "Reiniciando el CRM (puede tardar 30-60s)"

docker compose up -d --force-recreate crm 2>&1 | tee -a "$LOG_FILE"
if [ "${PIPESTATUS[0]}" -ne 0 ]; then
  ejecutar_rollback "Recrear container falló."
fi

# =====================================================================
# Paso 6: Healthcheck robusto
# =====================================================================
#
# No alcanza con curl /login (puede dar 200 con CRM zombi). Hacemos
# healthcheck multi-señal:
#   1. /api/health responde 200 con JSON { ok: true }
#   2. (fallback) /login responde 200 si /api/health no existe todavía
# Max 120s total.

log "  Esperando que el CRM responda (healthcheck robusto)..."
escribir_progreso "HEALTHCHECK" 95 "Verificando que el CRM responde correctamente"
WAIT=0
MAX_WAIT=120
HEALTH_OK=0
while [ $WAIT -lt $MAX_WAIT ]; do
  # Intento 1: endpoint /api/health (preferido)
  HEALTH_RESP=$(curl -sf --max-time 5 "http://localhost:3000/api/health" 2>/dev/null || echo "")
  if [ -n "$HEALTH_RESP" ] && echo "$HEALTH_RESP" | grep -q '"ok":\s*true'; then
    log "  ✓ /api/health respondió OK tras ${WAIT}s"
    HEALTH_OK=1
    break
  fi
  # Intento 2: fallback a /login (compatibilidad si /api/health no existe en la versión)
  if curl -sf --max-time 5 -o /dev/null "http://localhost:3000/login" 2>/dev/null; then
    # /login responde — esperar 5s más para que la app termine de inicializar
    log "  /login responde (fallback) — esperando 5s más por seguridad..."
    sleep 5
    log "  ✓ CRM respondió tras ${WAIT}s (modo fallback /login)"
    HEALTH_OK=1
    break
  fi
  sleep 3
  WAIT=$((WAIT + 3))
done

if [ $HEALTH_OK -eq 0 ]; then
  ejecutar_rollback "El CRM no respondió tras ${MAX_WAIT}s — la imagen nueva puede tener un bug crítico."
fi

# =====================================================================
# Paso 7: Marcar version_actual en DB
# =====================================================================

log "[6/6] Marcando version_actual=${VERSION_NUEVA} en configuración..."

db_exec -c "UPDATE configuracion SET version_actual='${VERSION_NUEVA}';" >/dev/null 2>&1 || \
  log "WARN: no se pudo actualizar version_actual (no es crítico)"

# =====================================================================
# Housekeeping — limpiar cache y capas obsoletas del build.
#
# Cada release deja layers intermedias cacheadas y una imagen anterior sin
# container. Sin limpieza, ~1-2 GB de basura por update. En VPS de 40 GB
# esto llena el disco en 3-6 meses de updates activos.
#
# Se corre acá porque:
#   - El build nuevo ya funcionó (validado por health-check de arriba).
#   - El daemon.json tiene tope de 5 GB como red de seguridad, pero limpiar
#     acá evita que ni siquiera se acerque.
#   - --filter until=24h: mantiene cache de las últimas 24hs por si hay que
#     hacer rollback y volver adelante rápido. Borra lo anterior.
#   - No es crítico: si falla, el daemon.json cubre. Por eso no bloqueamos.
# =====================================================================

log ""
log "Limpiando build cache e imágenes obsoletas..."
docker builder prune -f --filter until=24h >/dev/null 2>&1 || log "WARN: docker builder prune falló (no crítico — daemon.json tope 5GB cubre)"
docker image prune -f --filter until=24h >/dev/null 2>&1 || log "WARN: docker image prune falló (no crítico)"
log "  ✓ Housekeeping completado"

if marcar_completada_atomica; then
  escribir_progreso "DONE" 100 "Actualización completada"
  log ""
  log "═══════════════════════════════════════════════════════════════"
  log "  ✓ Actualización completada con éxito"
  log "  Versión nueva: v${VERSION_NUEVA}"
  log "═══════════════════════════════════════════════════════════════"
else
  # El admin cerró la fila manualmente mientras corríamos. No pisamos su decisión,
  # pero el código nuevo igual quedó aplicado. Loggeamos el estado.
  log ""
  log "═══════════════════════════════════════════════════════════════"
  log "  ⚠ El código nuevo se aplicó pero la fila ya no estaba en EJECUTANDO."
  log "     Otro admin la marcó como cerrada manualmente. No se pisó la decisión."
  log "     Versión efectiva del CRM: v${VERSION_NUEVA}"
  log "═══════════════════════════════════════════════════════════════"
fi

exit 0
