#!/bin/bash
set -e

# ============================================================================
# backup-now.sh — genera un backup .crmbak (tar.gz sin cifrar)
#
# Contenido del .crmbak:
#   backup-<timestamp>/
#     ├── database.sql.gz   (pg_dump comprimido)
#     ├── storage.tar.gz    (todos los archivos de /storage)
#     └── metadata.json     (fecha, tipo, versiones, tamaños, contenido)
#
# La seguridad recae en permisos Linux + cuenta de Google Drive con 2FA.
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

if [ -f .env.local ]; then
  set -a
  export $(grep -v '^#' .env.local | grep -v '^$' | xargs -d '\n' 2>/dev/null) || true
  set +a
fi

BACKUP_BASE="/var/backups/crm-seguros"
# Timestamp en UTC para consistencia
TIMESTAMP=$(date -u +"%Y-%m-%d_%H-%M-%S")
BACKUP_NAME="backup-$TIMESTAMP"
WORK_DIR="/tmp/crm-backup-$TIMESTAMP"
STAGE_DIR="$WORK_DIR/$BACKUP_NAME"
FINAL_FILE="$BACKUP_BASE/${BACKUP_NAME}.crmbak"
STORAGE_DIR="$PROJECT_DIR/storage"

TIPO="AUTOMATICO"
USUARIO_ID=""
for arg in "$@"; do
  case $arg in
    --tipo=*) TIPO="${arg#*=}" ;;
    --usuario-id=*) USUARIO_ID="${arg#*=}" ;;
  esac
done

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

mkdir -p "$STAGE_DIR"
mkdir -p "$BACKUP_BASE"

echo "=========================================="
echo "Backup CRM Seguros (.crmbak)"
echo "Nombre: $BACKUP_NAME"
echo "Tipo: $TIPO"
echo "Destino: $FINAL_FILE"
echo "=========================================="

START_TIME=$(date +%s)

# === 1. DUMP DE BASE DE DATOS ===
echo ""
echo "[1/4] Dumping base de datos..."
DB_DUMP_FILE="$STAGE_DIR/database.sql.gz"

# Conexión a Postgres por TCP. Variables del entorno (.env.local o env del
# container). Si POSTGRES_HOST no está seteado, usamos `docker exec` como
# fallback para no romper la instalación host (legacy systemd).
POSTGRES_HOST="${POSTGRES_HOST:-}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"

if [ -n "$POSTGRES_HOST" ]; then
  # Modo Docker / TCP — el container del CRM habla con supabase-db por red.
  echo "  Modo TCP: $POSTGRES_USER@$POSTGRES_HOST:$POSTGRES_PORT/$POSTGRES_DB"
  if PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$DB_DUMP_FILE"; then
    DB_SIZE=$(stat -c%s "$DB_DUMP_FILE")
    echo "  DB dump: $DB_SIZE bytes"
  else
    echo "  Error al hacer dump de la DB (TCP)"
    exit 1
  fi
else
  # Modo legacy host — el script corre en el host con docker socket disponible.
  POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-supabase-db}"
  echo "  Modo docker exec: container=$POSTGRES_CONTAINER user=$POSTGRES_USER db=$POSTGRES_DB"
  if docker exec "$POSTGRES_CONTAINER" pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$DB_DUMP_FILE"; then
    DB_SIZE=$(stat -c%s "$DB_DUMP_FILE")
    echo "  DB dump: $DB_SIZE bytes"
  else
    echo "  Error al hacer dump de la DB (docker exec)"
    exit 1
  fi
fi

# === 2. STORAGE ===
echo ""
echo "[2/4] Empaquetando archivos de storage..."
STORAGE_TAR="$STAGE_DIR/storage.tar.gz"
STORAGE_INCLUDED="false"

if [ -d "$STORAGE_DIR" ]; then
  if tar -czf "$STORAGE_TAR" -C "$PROJECT_DIR" storage/ 2>/dev/null; then
    STORAGE_SIZE=$(stat -c%s "$STORAGE_TAR")
    STORAGE_INCLUDED="true"
    echo "  Storage tar: $STORAGE_SIZE bytes"
  else
    echo "  Error al empaquetar storage (continuando)"
    STORAGE_SIZE=0
    touch "$STORAGE_TAR"
  fi
else
  echo "  Carpeta storage no existe, tar vacío"
  tar -czf "$STORAGE_TAR" -T /dev/null
  STORAGE_SIZE=0
fi

# === 3. METADATA ===
echo ""
echo "[3/4] Generando metadata..."
VERSION_CRM="1.0"
if [ -f "$PROJECT_DIR/package.json" ]; then
  VERSION_CRM=$(grep -m1 '"version"' "$PROJECT_DIR/package.json" | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
fi

SCHEMA_VERSION=$(node "$SCRIPT_DIR/get-schema-version.js" 2>/dev/null || echo "0")
SCHEMA_VERSION=$(echo "$SCHEMA_VERSION" | tr -d '\n')

TOTAL_PLAIN=$((DB_SIZE + STORAGE_SIZE))

cat > "$STAGE_DIR/metadata.json" <<EOF
{
  "backup_id": "$BACKUP_NAME",
  "nombre": "$BACKUP_NAME",
  "fecha": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "tipo": "$TIPO",
  "version_crm": "$VERSION_CRM",
  "version_schema": "$SCHEMA_VERSION",
  "contenido": {
    "database": true,
    "storage": $STORAGE_INCLUDED
  },
  "tamano_db_bytes": $DB_SIZE,
  "tamano_storage_bytes": $STORAGE_SIZE,
  "tamano_plain_total_bytes": $TOTAL_PLAIN
}
EOF

# === 4. Empaquetar en .crmbak ===
echo ""
echo "[4/4] Empaquetando .crmbak..."
cd "$WORK_DIR"
tar -czf "$FINAL_FILE" "$BACKUP_NAME"

# Verificación de integridad: que el tar.gz no esté corrupto
if ! tar -tzf "$FINAL_FILE" > /dev/null 2>&1; then
  echo "ERROR: el .crmbak resultante está corrupto"
  rm -f "$FINAL_FILE"
  exit 1
fi

FINAL_SIZE=$(stat -c%s "$FINAL_FILE")
echo "  .crmbak: $FINAL_SIZE bytes"

# Rotación
if [ -f "$SCRIPT_DIR/backup-rotate.sh" ]; then
  bash "$SCRIPT_DIR/backup-rotate.sh"
fi

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo "=========================================="
echo "Backup completado en ${DURATION}s"
echo "  Archivo: $FINAL_FILE"
echo "  Tamaño:  $(numfmt --to=iec $FINAL_SIZE)"
echo "=========================================="

# JSON result para backup-runner.ts
cat <<EOF
BACKUP_RESULT_JSON={"nombre":"$BACKUP_NAME","ruta":"$FINAL_FILE","duracion":$DURATION,"tamano_db":$DB_SIZE,"tamano_storage":$STORAGE_SIZE,"tamano_total":$FINAL_SIZE,"archivo_unico_path":"$FINAL_FILE","archivo_unico_tamano_bytes":$FINAL_SIZE,"contenido_incluido":{"database":true,"storage":$STORAGE_INCLUDED}}
EOF

exit 0
