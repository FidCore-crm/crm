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
#   2. Crear backup pre-update (.crmbak con DB + storage)
#   3. git fetch + checkout del tag nuevo
#   4. docker compose build crm
#   5. Aplicar migraciones SQL nuevas (idempotente)
#   6. docker compose up -d --force-recreate crm
#   7. Esperar healthcheck (curl /login)
#   8. Actualizar version_actual en DB → marcar COMPLETADA
#
# Si CUALQUIER paso después del backup falla, dispara rollback automático:
#   a. git reset --hard al commit pre-update
#   b. Restaurar DB del backup
#   c. Restaurar storage del backup
#   d. docker compose build + up -d (con el código viejo)
#   e. Marcar actualización como FALLIDA con detalle del fallo
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

# Carga variables del .env.docker (CRON_SECRET, POSTGRES_PASSWORD, etc.)
if [ -f "${CRM_DIR}/.env.docker" ]; then
  set -a
  source "${CRM_DIR}/.env.docker"
  set +a
fi

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"
}

db_exec() {
  docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"
}

# Variables que se llenan durante la ejecución (para uso del rollback)
COMMIT_PRE_UPDATE=""
BACKUP_ID=""
BACKUP_PATH=""
MIGRACIONES_APLICADAS=0
CHECKOUT_HECHO=0

# Marca el estado de la actualización en DB. Args: $1=estado, $2=mensaje opcional.
marcar_actualizacion() {
  local estado="$1"
  local mensaje="${2:-}"
  local sql="UPDATE actualizaciones SET estado='${estado}'"

  if [ -n "$mensaje" ]; then
    local mensaje_escaped="${mensaje//\'/\'\'}"
    sql="$sql, error_mensaje='${mensaje_escaped}'"
  fi
  if [ -n "$BACKUP_ID" ]; then
    sql="$sql, backup_id='${BACKUP_ID}'"
  fi

  case "$estado" in
    EJECUTANDO) sql="$sql, fecha_inicio_ejecucion=now()" ;;
    COMPLETADA|FALLIDA) sql="$sql, fecha_fin_ejecucion=now()" ;;
  esac

  sql="$sql WHERE id='${ACTUALIZACION_ID}';"
  db_exec -c "$sql" >> "$LOG_FILE" 2>&1 || log "WARN: db_exec falló para estado=$estado"
}

guardar_log_completo() {
  local log_content
  log_content=$(cat "$LOG_FILE")
  local log_escaped="${log_content//\'/\'\'}"
  db_exec -c "UPDATE actualizaciones SET log_completo='${log_escaped}' WHERE id='${ACTUALIZACION_ID}';" \
    >/dev/null 2>&1 || log "WARN: no se pudo guardar log_completo en DB"
}

# =====================================================================
# ROLLBACK AUTOMÁTICO
# =====================================================================
#
# Se llama cuando un paso después del backup falla. Intenta revertir el
# sistema al estado anterior al update:
#   - git reset --hard al commit pre-update (si ya se hizo checkout)
#   - Restaurar DB del backup (si ya se ejecutaron migraciones)
#   - Restaurar storage del backup (siempre, por las dudas)
#   - Rebuild + restart del container con el código viejo
#
# Si el rollback también falla, queda como FALLIDA con un mensaje
# explícito de "REVISAR MANUALMENTE" para que el PAS llame a soporte.
ejecutar_rollback() {
  local motivo_fallo="$1"

  log ""
  log "═══════════════════════════════════════════════════════════════"
  log "  ⚠ EL UPDATE FALLÓ — Iniciando rollback automático"
  log "  Motivo: ${motivo_fallo}"
  log "═══════════════════════════════════════════════════════════════"

  local rollback_exitoso=1

  # Paso A: volver al commit anterior si ya hicimos checkout
  if [ $CHECKOUT_HECHO -eq 1 ] && [ -n "$COMMIT_PRE_UPDATE" ]; then
    log "  [rollback A] git reset --hard ${COMMIT_PRE_UPDATE}"
    cd "$CRM_DIR" || rollback_exitoso=0
    if [ $rollback_exitoso -eq 1 ]; then
      git reset --hard "$COMMIT_PRE_UPDATE" 2>&1 | tee -a "$LOG_FILE"
      if [ ${PIPESTATUS[0]} -ne 0 ]; then
        log "  WARN: git reset falló"
        rollback_exitoso=0
      else
        log "  ✓ Código volvió al commit anterior"
      fi
    fi
  fi

  # Paso B: restaurar DB y storage del backup (solo si ya creamos el backup)
  # Si las migraciones se aplicaron, la DB cambió y SÍ hay que restaurar.
  # Si no, la DB está intacta y no necesita rollback.
  if [ -n "$BACKUP_PATH" ] && [ -f "$BACKUP_PATH" ]; then
    if [ $MIGRACIONES_APLICADAS -eq 1 ] || [ $rollback_exitoso -eq 1 ]; then
      log "  [rollback B] Restaurando backup ${BACKUP_PATH##*/}..."

      # Extraer el .crmbak a un work dir temporal
      local WORK_DIR
      WORK_DIR=$(mktemp -d -t pulzar-rollback-XXXXXX)

      if tar -xzf "$BACKUP_PATH" -C "$WORK_DIR" 2>&1 | tee -a "$LOG_FILE"; then
        bash "$CRM_DIR/scripts/backup-restore.sh" \
          --work-dir="$WORK_DIR" \
          --restaurar-db=1 \
          --restaurar-storage=1 \
          2>&1 | tee -a "$LOG_FILE"
        if [ ${PIPESTATUS[0]} -eq 0 ]; then
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
    fi
  fi

  # Paso C: rebuild + restart del container con el código (ahora viejo)
  if [ $CHECKOUT_HECHO -eq 1 ]; then
    log "  [rollback C] Reconstruyendo container con código anterior..."
    cd "$CRM_DIR" || rollback_exitoso=0
    docker compose build crm 2>&1 | tee -a "$LOG_FILE"
    if [ ${PIPESTATUS[0]} -ne 0 ]; then
      log "  ⚠ Build del rollback falló — el CRM puede quedar inaccesible"
      rollback_exitoso=0
    fi
    docker compose up -d --force-recreate crm 2>&1 | tee -a "$LOG_FILE"
    if [ ${PIPESTATUS[0]} -ne 0 ]; then
      log "  ⚠ Restart del rollback falló"
      rollback_exitoso=0
    fi
  fi

  # Paso D: marcar la actualización con el mensaje apropiado
  if [ $rollback_exitoso -eq 1 ]; then
    marcar_actualizacion FALLIDA "$motivo_fallo. Rollback aplicado: el sistema volvió a v$(grep -oE '\"version\": \"[^\"]+\"' "$CRM_DIR/package.json" | head -1 | cut -d'\"' -f4)."
    log ""
    log "  ✓ Rollback completado. El CRM está corriendo la versión anterior."
  else
    marcar_actualizacion FALLIDA "$motivo_fallo. ⚠ EL ROLLBACK TAMBIÉN FALLÓ — revisar manualmente el servidor."
    log ""
    log "  ⚠ Rollback INCOMPLETO. El servidor puede estar en estado inconsistente."
    log "  Acción manual: SSH al servidor y verificar 'docker ps' + estado de DB."
  fi

  exit 1
}

# Trap: cleanup del trigger file y guardado de log al salir, sea como sea.
cleanup() {
  rm -f "$TRIGGER_FILE"
  guardar_log_completo
}
trap cleanup EXIT

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
log "═══════════════════════════════════════════════════════════════"

marcar_actualizacion EJECUTANDO

# Capturar commit actual ANTES de tocar nada (para rollback)
cd "$CRM_DIR" || { log "FATAL: no se pudo cd a $CRM_DIR"; exit 1; }
COMMIT_PRE_UPDATE=$(git rev-parse HEAD)
log "Commit pre-update: ${COMMIT_PRE_UPDATE:0:12}"

# =====================================================================
# Paso 1: Backup pre-update
# =====================================================================

log "[1/6] Creando backup pre-update..."

# Ejecutamos backup-now.sh DENTRO del container del CRM (no en el host)
# porque ahí sí está instalado pg_dump 15. El host no tiene
# postgresql-client y queremos evitar tener que instalarlo en cada mini-PC.
#
# Como `/var/backups/crm-seguros/` está bind-mounted, el .crmbak resultante
# aparece en el host inmediatamente.
#
# Después de crear el archivo, insertamos manualmente la fila en `backups`
# con SQL directo — evitamos depender del endpoint HTTP que requiere auth
# de usuario admin.

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

# Insertar manualmente la fila en la tabla `backups`
BACKUP_NOTA="Backup automático pre-actualización a v${VERSION_NUEVA}"
BACKUP_NOTA_ESC="${BACKUP_NOTA//\'/\'\'}"
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
" 2>&1 | tr -d '[:space:]')

if [ -z "$BACKUP_ID" ] || [[ ! "$BACKUP_ID" =~ ^[0-9a-f-]+$ ]]; then
  log "FATAL: no se pudo registrar el backup en DB. Output: $BACKUP_ID"
  marcar_actualizacion FALLIDA "El backup físico se creó pero no se pudo registrar en DB."
  exit 1
fi

log "  ✓ Backup OK — id=${BACKUP_ID:0:8} path=${BACKUP_PATH##*/} (${BACKUP_DURACION}s)"

# Verificar que el archivo del backup existe (defensivo)
if [ ! -f "$BACKUP_PATH" ]; then
  log "FATAL: el backup se reporta como creado pero no se encuentra en $BACKUP_PATH"
  marcar_actualizacion FALLIDA "El backup se reportó OK pero el archivo no existe en disco."
  exit 1
fi

# A partir de acá, cualquier fallo dispara rollback

# =====================================================================
# Paso 2: git fetch + checkout
# =====================================================================

log "[2/6] Descargando v${VERSION_NUEVA} desde GitHub..."

cd "$CRM_DIR" || ejecutar_rollback "No se pudo cd a $CRM_DIR"

git fetch --tags --quiet origin 2>&1 | tee -a "$LOG_FILE"
if [ ${PIPESTATUS[0]} -ne 0 ]; then
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
if [ ${PIPESTATUS[0]} -ne 0 ]; then
  ejecutar_rollback "git checkout $TAG_USADO falló."
fi
CHECKOUT_HECHO=1
log "  ✓ Código actualizado a v${VERSION_NUEVA}"

# =====================================================================
# Paso 3: Build de la imagen Docker
# =====================================================================

log "[3/6] Building imagen Docker (puede tardar 3-5 minutos)..."

docker compose build crm 2>&1 | tee -a "$LOG_FILE"
if [ ${PIPESTATUS[0]} -ne 0 ]; then
  ejecutar_rollback "Build de Docker falló. Revisar log para detalles."
fi
log "  ✓ Imagen built"

# =====================================================================
# Paso 4: Aplicar migraciones SQL
# =====================================================================

log "[4/6] Aplicando migraciones SQL nuevas..."

bash "$CRM_DIR/scripts/aplicar-migraciones.sh" 2>&1 | tee -a "$LOG_FILE"
if [ ${PIPESTATUS[0]} -ne 0 ]; then
  ejecutar_rollback "Las migraciones SQL fallaron."
fi
MIGRACIONES_APLICADAS=1
log "  ✓ Migraciones aplicadas"

# =====================================================================
# Paso 5: Recrear container
# =====================================================================

log "[5/6] Recreando container con la imagen nueva..."

docker compose up -d --force-recreate crm 2>&1 | tee -a "$LOG_FILE"
if [ ${PIPESTATUS[0]} -ne 0 ]; then
  ejecutar_rollback "Recrear container falló."
fi

# Esperar healthcheck (max 120s)
log "  Esperando que el CRM responda..."
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
log ""
log "═══════════════════════════════════════════════════════════════"
log "  ✓ Actualización completada con éxito"
log "  Versión nueva: v${VERSION_NUEVA}"
log "═══════════════════════════════════════════════════════════════"

exit 0
