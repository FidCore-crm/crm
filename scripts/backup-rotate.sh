#!/bin/bash
set -e

# ============================================================================
# backup-rotate.sh — rota archivos .crmbak aplicando política 7/4/6
# (lee valores de configuracion_backups, con fallback a defaults)
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_BASE="/var/backups/crm-seguros"

if [ -f "$PROJECT_DIR/.env.local" ]; then
  set -a
  export $(grep -v '^#' "$PROJECT_DIR/.env.local" | grep -v '^$' | xargs -d '\n' 2>/dev/null) || true
  set +a
fi

RETENER_DIARIOS=7
RETENER_SEMANALES=4
RETENER_MENSUALES=6

POSTGRES_HOST="${POSTGRES_HOST:-}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-supabase-db}"

if [ -n "$POSTGRES_HOST" ] && command -v psql &>/dev/null; then
  # Modo TCP (container)
  DB_D=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT retener_diarios FROM configuracion_backups LIMIT 1" 2>/dev/null || echo "")
  DB_S=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT retener_semanales FROM configuracion_backups LIMIT 1" 2>/dev/null || echo "")
  DB_M=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT retener_mensuales FROM configuracion_backups LIMIT 1" 2>/dev/null || echo "")
  [ -n "$DB_D" ] && RETENER_DIARIOS="$DB_D"
  [ -n "$DB_S" ] && RETENER_SEMANALES="$DB_S"
  [ -n "$DB_M" ] && RETENER_MENSUALES="$DB_M"
elif command -v docker &>/dev/null && docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
  # Modo legacy host
  DB_D=$(docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT retener_diarios FROM configuracion_backups LIMIT 1" 2>/dev/null || echo "")
  DB_S=$(docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT retener_semanales FROM configuracion_backups LIMIT 1" 2>/dev/null || echo "")
  DB_M=$(docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT retener_mensuales FROM configuracion_backups LIMIT 1" 2>/dev/null || echo "")
  [ -n "$DB_D" ] && RETENER_DIARIOS="$DB_D"
  [ -n "$DB_S" ] && RETENER_SEMANALES="$DB_S"
  [ -n "$DB_M" ] && RETENER_MENSUALES="$DB_M"
fi

cd "$BACKUP_BASE" 2>/dev/null || exit 0

BACKUPS=$(ls -1 backup-*.crmbak 2>/dev/null | sort -r || true)

if [ -z "$BACKUPS" ]; then
  echo "  (no hay backups .crmbak para rotar)"
  exit 0
fi

declare -A A_MANTENER
TOTAL_DIARIOS=0
TOTAL_SEMANALES=0
TOTAL_MENSUALES=0
ULTIMO_DIA_SEMANA=""
ULTIMO_MES=""

for backup in $BACKUPS; do
  FECHA=$(echo "$backup" | sed 's/backup-\([0-9-]*\)_.*/\1/')
  [ -z "$FECHA" ] && continue

  if [ $TOTAL_DIARIOS -lt $RETENER_DIARIOS ]; then
    A_MANTENER[$backup]=1
    TOTAL_DIARIOS=$((TOTAL_DIARIOS + 1))
    continue
  fi

  SEMANA_ANIO=$(date -d "$FECHA" +%Y-%V 2>/dev/null || echo "")
  if [ "$SEMANA_ANIO" != "$ULTIMO_DIA_SEMANA" ] && [ $TOTAL_SEMANALES -lt $RETENER_SEMANALES ]; then
    A_MANTENER[$backup]=1
    TOTAL_SEMANALES=$((TOTAL_SEMANALES + 1))
    ULTIMO_DIA_SEMANA=$SEMANA_ANIO
    continue
  fi

  MES_ANIO=$(date -d "$FECHA" +%Y-%m 2>/dev/null || echo "")
  if [ "$MES_ANIO" != "$ULTIMO_MES" ] && [ $TOTAL_MENSUALES -lt $RETENER_MENSUALES ]; then
    A_MANTENER[$backup]=1
    TOTAL_MENSUALES=$((TOTAL_MENSUALES + 1))
    ULTIMO_MES=$MES_ANIO
    continue
  fi
done

ELIMINADOS=0
for backup in $BACKUPS; do
  if [ -z "${A_MANTENER[$backup]}" ]; then
    rm -f "$BACKUP_BASE/$backup"
    ELIMINADOS=$((ELIMINADOS + 1))
  fi
done

TOTAL_MANTENIDOS=${#A_MANTENER[@]}
echo "  Rotacion: $TOTAL_MANTENIDOS mantenidos, $ELIMINADOS eliminados"
echo "    (config: $RETENER_DIARIOS diarios, $RETENER_SEMANALES semanales, $RETENER_MENSUALES mensuales)"

exit 0
