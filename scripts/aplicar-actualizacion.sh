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
# Flujo:
#   1. Capturar el commit actual (para rollback de git si algo falla)
#   2. Crear backup pre-update (.crmbak con DB + storage) + validar tar
#   3. git fetch + checkout del tag nuevo + validar package.json
#   4. docker compose build crm
#   5. Aplicar migraciones SQL nuevas (idempotente)
#   6. docker compose up -d --force-recreate crm
#   7. Esperar healthcheck (curl /login)
#   8. Actualizar version_actual en DB → marcar COMPLETADA
#
# Si CUALQUIER paso después del backup falla, dispara rollback automático.
#
# Mecanismos defensivos:
#   - Trap EXIT garantiza que la fila NUNCA quede en EJECUTANDO si el
#     script termina sin marcar COMPLETADA/FALLIDA explícito (crash, kill).
#   - Timeout máximo global (TIMEOUT_TOTAL_SEC = 1800 = 30 min): si el script
#     no terminó en ese tiempo, lo matamos para liberar la fila.
#   - Logs rotados a 5 MB para no crecer indefinidamente.
#   - Validación tar -tzf del backup antes de considerarlo válido.
#   - Validación post-checkout que el package.json realmente tenga la versión.
#   - progress.json escrito en cada paso para que el frontend tenga estado real.
#
# Variables esperadas (las pasa el trigger script):
#   ACTUALIZACION_ID    UUID de la fila en `actualizaciones`
#   VERSION_NUEVA       Tag a aplicar (ej: 1.2.0)
#   CRM_DIR             Directorio root del CRM en el host

set -u

# Defaults
CRM_DIR="${CRM_DIR:-/home/nahuel/crm-seguros}"
LOG_FILE="${CRM_DIR}/tmp/updates/last-run.log"
TRIGGER_FILE="${CRM_DIR}/tmp/updates/pending.json"
PROGRESS_FILE="${CRM_DIR}/tmp/updates/progress.json"
LOG_MAX_BYTES=$((5 * 1024 * 1024))   # 5 MB
TIMEOUT_TOTAL_SEC=1800               # 30 min

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

# Escribe un snapshot del paso actual + porcentaje al PROGRESS_FILE.
# El frontend lo lee via /api/actualizaciones/estado.
escribir_progreso() {
  local paso="$1"          # ej: BACKUP, FETCH, BUILD, MIGRATIONS, RESTART, HEALTH, DONE
  local porcentaje="${2:-0}"
  local mensaje="${3:-}"
  cat > "$PROGRESS_FILE" <<EOF
{
  "actualizacion_id": "${ACTUALIZACION_ID:-}",
  "paso": "${paso}",
  "porcentaje": ${porcentaje},
  "mensaje": "${mensaje}",
  "actualizado_en": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
}

# Variables que se llenan durante la ejecución (para uso del rollback)
COMMIT_PRE_UPDATE=""
BACKUP_ID=""
BACKUP_PATH=""
MIGRACIONES_APLICADAS=0
CHECKOUT_HECHO=0
ESTADO_FINAL_MARCADO=0

# Marca el estado de la actualización en DB. Args: $1=estado, $2=mensaje opcional.
# Setea ESTADO_FINAL_MARCADO=1 cuando llega a COMPLETADA/FALLIDA/CANCELADA, así
# el trap defensivo no pisa el resultado.
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

  case "$estado" in
    EJECUTANDO) sql="$sql, fecha_inicio_ejecucion=now()" ;;
    COMPLETADA|FALLIDA|CANCELADA)
      sql="$sql, fecha_fin_ejecucion=now()"
      ESTADO_FINAL_MARCADO=1
      ;;
  esac

  sql="$sql WHERE id='${ACTUALIZACION_ID}';"
  db_exec -c "$sql" >> "$LOG_FILE" 2>&1 || log "WARN: db_exec falló para estado=$estado"
}

# Guarda el log completo del run en DB. Logs largos o con caracteres especiales
# romperían si los pasamos via `-c "UPDATE ... SET log='${escaped}'"`. Solución:
# pasamos el log via stdin a un script SQL inline que usa `\copy` para leer
# desde stdin a una tabla temporal, y después un UPDATE que lee de ahí.
guardar_log_completo() {
  [ -f "$LOG_FILE" ] || return 0
  # Truncar a 256 KB para no saturar la fila
  local truncated
  truncated=$(tail -c 262144 "$LOG_FILE")

  # Usamos cat | docker exec con HEREDOC: el contenido del log viaja por stdin
  # del psql. \copy lee desde STDIN (el stdin del psql) a una tabla temporal.
  # Después UPDATE lee de la tabla temporal hacia actualizaciones.log_completo.
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
#
# Se llama cuando un paso después del backup falla. Reglas claras:
#   - Restaurar DB → SOLO si las migraciones se aplicaron (la DB cambió).
#   - Restaurar storage → SIEMPRE si hay backup (cualquier paso puede haber
#     tocado archivos sin querer; restaurar es defensivo y barato).
#   - Rebuild + restart → SIEMPRE si ya hicimos checkout (el container nuevo
#     puede estar arriba con código nuevo + DB vieja).
ejecutar_rollback() {
  local motivo_fallo="$1"

  log ""
  log "═══════════════════════════════════════════════════════════════"
  log "  ⚠ EL UPDATE FALLÓ — Iniciando rollback automático"
  log "  Motivo: ${motivo_fallo}"
  log "═══════════════════════════════════════════════════════════════"

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
      WORK_DIR=$(mktemp -d -t pulzar-rollback-XXXXXX)

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
    log ""
    log "  ✓ Rollback completado. El CRM está corriendo v${version_actual}."
  else
    marcar_actualizacion FALLIDA "$motivo_fallo. ⚠ EL ROLLBACK TAMBIÉN FALLÓ — revisar manualmente el servidor."
    log ""
    log "  ⚠ Rollback INCOMPLETO. El servidor puede estar en estado inconsistente."
    log "  Acción manual: SSH al servidor y verificar 'docker ps' + estado de DB."
  fi

  escribir_progreso "FAILED" 100 "$motivo_fallo"
  exit 1
}

# =====================================================================
# Trap EXIT defensivo
# =====================================================================
#
# Se ejecuta SIEMPRE al salir del script (éxito, error, signal, exit).
# Responsabilidades:
#   - Borrar el trigger file (que actualizacion-trigger.sh no re-dispare).
#   - Guardar log_completo en DB (para que admin vea en historial).
#   - Si la fila quedó en EJECUTANDO sin marcar resultado explícito,
#     marcarla FALLIDA con mensaje "Script terminó sin marcar resultado".
#     Esto cubre crashes (kill -9, OOM, set -u con var faltante, etc.).
cleanup() {
  local exit_code=$?
  rm -f "$TRIGGER_FILE"

  if [ "$ESTADO_FINAL_MARCADO" -eq 0 ] && [ -n "${ACTUALIZACION_ID:-}" ]; then
    log ""
    log "  ⚠ El script terminó (exit=$exit_code) sin marcar resultado explícito."
    log "  Marcando actualización como FALLIDA para que la UI no quede stuck."
    marcar_actualizacion FALLIDA "El script terminó inesperadamente (exit $exit_code). Revisar log_completo."
    escribir_progreso "FAILED" 100 "El script terminó inesperadamente"
  fi

  guardar_log_completo
}
trap cleanup EXIT

# Timeout total: si el script entero supera TIMEOUT_TOTAL_SEC, kill -TERM.
# Asegura que la fila nunca quede stuck más allá del límite.
(
  sleep "$TIMEOUT_TOTAL_SEC"
  if kill -0 $$ 2>/dev/null; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] FATAL: timeout total ${TIMEOUT_TOTAL_SEC}s alcanzado, matando script" >> "$LOG_FILE"
    kill -TERM $$ 2>/dev/null
  fi
) &
TIMEOUT_PID=$!
# Matar el watcher al salir
trap 'rm -f "$TRIGGER_FILE"; kill "$TIMEOUT_PID" 2>/dev/null; cleanup' EXIT

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

log "═══════════════════════════════════════════════════════════════"
log "  Aplicando actualización a Pulzar v${VERSION_NUEVA}"
log "  ID: ${ACTUALIZACION_ID}"
log "  Directorio: ${CRM_DIR}"
log "  Timeout total: ${TIMEOUT_TOTAL_SEC}s"
log "═══════════════════════════════════════════════════════════════"

marcar_actualizacion EJECUTANDO
escribir_progreso "INICIANDO" 1 "Preparando actualización"

# Capturar commit actual ANTES de tocar nada (para rollback)
cd "$CRM_DIR" || { log "FATAL: no se pudo cd a $CRM_DIR"; exit 1; }
COMMIT_PRE_UPDATE=$(git rev-parse HEAD)
log "Commit pre-update: ${COMMIT_PRE_UPDATE:0:12}"

# =====================================================================
# Paso 1: Backup pre-update
# =====================================================================

log "[1/6] Creando backup pre-update..."
escribir_progreso "BACKUP" 10 "Creando backup del sistema"

# Ejecutamos backup-now.sh DENTRO del container (pg_dump 15 vive ahí, no en host)
BACKUP_OUTPUT=$(docker exec pulzar-crm bash /app/scripts/backup-now.sh --tipo=PRE_UPDATE 2>&1)
BACKUP_EXIT=$?

if [ $BACKUP_EXIT -ne 0 ]; then
  log "FATAL: backup-now.sh falló (exit $BACKUP_EXIT):"
  echo "$BACKUP_OUTPUT" | tail -20 | tee -a "$LOG_FILE"
  marcar_actualizacion FALLIDA "El backup pre-update falló. Revisar log para detalles."
  exit 1
fi

# Parsear BACKUP_RESULT_JSON={...} del output del script
BACKUP_JSON=$(echo "$BACKUP_OUTPUT" | grep -oE 'BACKUP_RESULT_JSON=\{.*\}' | sed 's/^BACKUP_RESULT_JSON=//')
if [ -z "$BACKUP_JSON" ]; then
  log "FATAL: backup-now.sh no devolvió BACKUP_RESULT_JSON. Output:"
  echo "$BACKUP_OUTPUT" | tail -20 | tee -a "$LOG_FILE"
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

log "[4/6] Aplicando migraciones SQL nuevas..."
escribir_progreso "MIGRATIONS" 75 "Aplicando cambios de base de datos"

# IMPORTANTE: forzamos POSTGRES_HOST="" + CRM_ENV_FILE=/dev/null para que el script
# de migraciones use el modo `docker exec supabase-db psql` en vez de TCP a
# `supabase-db:5432` (que es un hostname Docker, no resuelve desde el host).
# El check `if [ -z "${!key+x}" ]` del script hijo respeta vars vacías (no las pisa).
# POSTGRES_USER=supabase_admin garantiza permisos sobre auth.* y todas las tablas.
POSTGRES_HOST= POSTGRES_PORT= POSTGRES_PASSWORD= POSTGRES_DB=postgres \
  POSTGRES_USER=supabase_admin \
  CRM_ENV_FILE=/dev/null \
  bash "$CRM_DIR/scripts/aplicar-migraciones.sh" 2>&1 | tee -a "$LOG_FILE"
if [ "${PIPESTATUS[0]}" -ne 0 ]; then
  ejecutar_rollback "Las migraciones SQL fallaron."
fi
MIGRACIONES_APLICADAS=1
log "  ✓ Migraciones aplicadas"
escribir_progreso "MIGRATIONS_OK" 85 "Base de datos actualizada"

# =====================================================================
# Paso 5: Recrear container + healthcheck
# =====================================================================

log "[5/6] Recreando container con la imagen nueva..."
escribir_progreso "RESTART" 90 "Reiniciando el CRM"

docker compose up -d --force-recreate crm 2>&1 | tee -a "$LOG_FILE"
if [ "${PIPESTATUS[0]}" -ne 0 ]; then
  ejecutar_rollback "Recrear container falló."
fi

# Esperar healthcheck (max 120s)
log "  Esperando que el CRM responda..."
escribir_progreso "HEALTHCHECK" 95 "Esperando que el CRM responda"
WAIT=0
MAX_WAIT=120
while [ $WAIT -lt $MAX_WAIT ]; do
  if curl -sf -o /dev/null "http://localhost:3000/login" 2>/dev/null; then
    log "  ✓ CRM respondió tras ${WAIT}s"
    break
  fi
  sleep 3
  WAIT=$((WAIT + 3))
done

if [ $WAIT -ge $MAX_WAIT ]; then
  ejecutar_rollback "El CRM no arrancó tras ${MAX_WAIT}s — la imagen nueva puede tener un bug crítico."
fi

# =====================================================================
# Paso 6: Marcar version_actual en DB
# =====================================================================

log "[6/6] Marcando version_actual=${VERSION_NUEVA} en configuración..."

db_exec -c "UPDATE configuracion SET version_actual='${VERSION_NUEVA}';" >/dev/null 2>&1 || \
  log "WARN: no se pudo actualizar version_actual (no es crítico)"

marcar_actualizacion COMPLETADA
escribir_progreso "DONE" 100 "Actualización completada"
log ""
log "═══════════════════════════════════════════════════════════════"
log "  ✓ Actualización completada con éxito"
log "  Versión nueva: v${VERSION_NUEVA}"
log "═══════════════════════════════════════════════════════════════"

exit 0
