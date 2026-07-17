#!/bin/bash
set -e

# ============================================================================
# backup-rotate.sh — rotación de backups .crmbak
# ============================================================================
#
# Política por tipo de backup:
#
#   AUTOMATICO / MANUAL / PRE_RESTORE:
#     Grandfather-Father-Son.
#     - Últimos N diarios (default 3)
#     - Últimos N semanales (default 2)
#     - Últimos N mensuales (default 3)
#
#   PRE_UPDATE:
#     Retención especial.
#     - Mantener siempre los últimos N PRE_UPDATE (default 2)
#     - Mantener cualquiera de los últimos M días (default 3)
#     - Quien NO cumpla NINGUNA, se elimina.
#
# Defaults ajustados en v1.0.143: antes 7/4/6 + 5/30 acumulaban ~120 backups
# en ~2 meses ocupando 1 GB. Los nuevos defaults (3/2/3 + 2/3) mantienen
# ~10 backups activos ocupando ~100 MB — suficiente para rollback puntual
# sin desperdiciar disco.
#
# El tipo de cada .crmbak se determina consultando la tabla `backups` por
# `archivo_unico_path`. Si no se encuentra (huérfano), se trata como AUTOMATICO.
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_BASE="/var/backups/crm-seguros"

if [ -f "$PROJECT_DIR/.env.local" ]; then
  set -a
  export $(grep -v '^#' "$PROJECT_DIR/.env.local" | grep -v '^$' | xargs -d '\n' 2>/dev/null) || true
  set +a
fi
if [ -f "$PROJECT_DIR/.env.docker" ]; then
  set -a
  export $(grep -v '^#' "$PROJECT_DIR/.env.docker" | grep -v '^$' | xargs -d '\n' 2>/dev/null) || true
  set +a
fi

# Defaults (v1.0.143 — reducidos de 7/4/6 + 5/30 para ahorrar disco)
RETENER_DIARIOS=3
RETENER_SEMANALES=2
RETENER_MENSUALES=3
RETENER_PRE_UPDATE_MINIMOS=2
RETENER_PRE_UPDATE_DIAS=3

POSTGRES_HOST="${POSTGRES_HOST:-}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-supabase-db}"

# Helper: ejecuta una query y retorna primera celda. Usa TCP si está
# disponible, sino docker exec al container.
psql_query() {
  local sql="$1"
  if [ -n "$POSTGRES_HOST" ] && command -v psql &>/dev/null; then
    PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" \
      -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "$sql" 2>/dev/null || echo ""
  elif command -v docker &>/dev/null && docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
    docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      -tAc "$sql" 2>/dev/null || echo ""
  else
    echo ""
  fi
}

# Cargar políticas desde DB
DB_D=$(psql_query "SELECT retener_diarios FROM configuracion_backups LIMIT 1")
DB_S=$(psql_query "SELECT retener_semanales FROM configuracion_backups LIMIT 1")
DB_M=$(psql_query "SELECT retener_mensuales FROM configuracion_backups LIMIT 1")
DB_PU_MIN=$(psql_query "SELECT retener_pre_update_minimos FROM configuracion_backups LIMIT 1")
DB_PU_DIAS=$(psql_query "SELECT retener_pre_update_dias FROM configuracion_backups LIMIT 1")
[ -n "$DB_D" ] && RETENER_DIARIOS="$DB_D"
[ -n "$DB_S" ] && RETENER_SEMANALES="$DB_S"
[ -n "$DB_M" ] && RETENER_MENSUALES="$DB_M"
[ -n "$DB_PU_MIN" ] && RETENER_PRE_UPDATE_MINIMOS="$DB_PU_MIN"
[ -n "$DB_PU_DIAS" ] && RETENER_PRE_UPDATE_DIAS="$DB_PU_DIAS"

cd "$BACKUP_BASE" 2>/dev/null || exit 0

# Lista TODOS los .crmbak ordenados por fecha desc (más nuevo primero)
BACKUPS=$(ls -1 backup-*.crmbak 2>/dev/null | sort -r || true)

if [ -z "$BACKUPS" ]; then
  echo "  (no hay backups .crmbak para rotar)"
  exit 0
fi

# Helper: determinar el tipo de un archivo .crmbak consultando DB.
# Si no se encuentra el path en la tabla, asume AUTOMATICO (cuidado defensivo).
tipo_de_backup() {
  local archivo="$1"
  local fullpath="${BACKUP_BASE}/${archivo}"
  local tipo
  tipo=$(psql_query "SELECT tipo FROM backups WHERE archivo_unico_path='${fullpath}' LIMIT 1")
  if [ -z "$tipo" ]; then
    echo "AUTOMATICO"
  else
    echo "$tipo"
  fi
}

# ─── Separar archivos por tipo ─────────────────────────────────────────

declare -a BACKUPS_NORMALES   # AUTOMATICO/MANUAL/PRE_RESTORE
declare -a BACKUPS_PRE_UPDATE

for backup in $BACKUPS; do
  TIPO=$(tipo_de_backup "$backup")
  if [ "$TIPO" = "PRE_UPDATE" ]; then
    BACKUPS_PRE_UPDATE+=("$backup")
  else
    BACKUPS_NORMALES+=("$backup")
  fi
done

declare -A A_MANTENER

# ─── Política grandfather-father-son para NORMALES ─────────────────────
#
# Importante: la política se aplica sobre REPRESENTANTES DIARIOS, no sobre
# backups individuales. Si en un mismo día hay varios backups (típico cuando
# el PAS aprieta "Hacer backup ahora" varias veces, o cuando hay restores
# que generan PRE_RESTORE), solo el más reciente del día entra al GFS — el
# resto se elimina automáticamente.
#
# Sin esta agrupación, 5 backups del mismo día consumirían los 7 slots
# diarios y la rotación quedaría "atascada" reteniendo mucho más de lo
# previsto. El bug se manifestó en producción en junio 2026.

declare -A REPRESENTANTE_DIA  # fecha -> archivo (el más reciente del día)
REPRESENTANTES=()             # lista ordenada desc de representantes únicos por día

for backup in "${BACKUPS_NORMALES[@]}"; do
  FECHA=$(echo "$backup" | sed 's/backup-\([0-9-]*\)_.*/\1/')
  [ -z "$FECHA" ] && continue

  if [ -z "${REPRESENTANTE_DIA[$FECHA]+x}" ]; then
    # Primer backup que vemos para esta fecha (iteramos desc, así que es el
    # más reciente del día) — se vuelve el representante.
    REPRESENTANTE_DIA[$FECHA]="$backup"
    REPRESENTANTES+=("$backup")
  fi
  # Los demás backups del mismo día NO entran a A_MANTENER → se eliminan.
done

TOTAL_DIARIOS=0
TOTAL_SEMANALES=0
TOTAL_MENSUALES=0
ULTIMO_DIA_SEMANA=""
ULTIMO_MES=""

for backup in "${REPRESENTANTES[@]}"; do
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

# ─── Política especial para PRE_UPDATE ─────────────────────────────────

AHORA_EPOCH=$(date +%s)
LIMITE_DIAS_EPOCH=$((AHORA_EPOCH - RETENER_PRE_UPDATE_DIAS * 86400))
TOTAL_PU=0

for backup in "${BACKUPS_PRE_UPDATE[@]}"; do
  # Regla 1: mantener los primeros N
  if [ $TOTAL_PU -lt $RETENER_PRE_UPDATE_MINIMOS ]; then
    A_MANTENER[$backup]=1
    TOTAL_PU=$((TOTAL_PU + 1))
    continue
  fi

  # Regla 2: mantener si tiene menos de M días
  FECHA=$(echo "$backup" | sed 's/backup-\([0-9-]*\)_.*/\1/')
  if [ -n "$FECHA" ]; then
    FECHA_EPOCH=$(date -d "$FECHA" +%s 2>/dev/null || echo 0)
    if [ $FECHA_EPOCH -gt $LIMITE_DIAS_EPOCH ]; then
      A_MANTENER[$backup]=1
      continue
    fi
  fi
  # No cumple ninguna: se elimina
done

# ─── Eliminar los que no se mantienen ──────────────────────────────────

ELIMINADOS=0
for backup in $BACKUPS; do
  if [ -z "${A_MANTENER[$backup]+x}" ]; then
    rm -f "$BACKUP_BASE/$backup"
    ELIMINADOS=$((ELIMINADOS + 1))
  fi
done

TOTAL_MANTENIDOS=${#A_MANTENER[@]}
echo "  Rotación: $TOTAL_MANTENIDOS mantenidos (${TOTAL_PU} pre-update, $((TOTAL_MANTENIDOS - TOTAL_PU)) normales), $ELIMINADOS eliminados"
echo "    (config: ${RETENER_DIARIOS}d / ${RETENER_SEMANALES}s / ${RETENER_MENSUALES}m + pre-update: min ${RETENER_PRE_UPDATE_MINIMOS}, ${RETENER_PRE_UPDATE_DIAS}d)"

exit 0
