#!/bin/bash
# Loop persistente que dispara el runner de jobs de importación cada 30 segundos.
# Diseñado para correr como systemd service (host) o como container del compose.
#
# Modos:
#   - HOST/systemd:  ENV_FILE=/home/.../.env.local, CRM_BASE_URL=http://localhost:3000
#   - DOCKER:        CRON_SECRET en env, CRM_BASE_URL=http://crm:3000
#
# Uso (host):
#   sudo cp scripts/crm-importacion-runner.service /etc/systemd/system/
#   sudo systemctl daemon-reload
#   sudo systemctl enable --now crm-importacion-runner.service

set -u

ENV_FILE="${CRM_ENV_FILE:-/home/nahuel/crm-seguros/.env.local}"
CRM_BASE_URL="${CRM_BASE_URL:-http://localhost:3000}"
INTERVAL_SECONDS="${IMPORTACION_RUNNER_INTERVAL_SECONDS:-30}"

if [ -z "${CRON_SECRET:-}" ] && [ -f "$ENV_FILE" ]; then
  CRON_SECRET=$(grep '^CRON_SECRET=' "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'")
fi

if [ -z "${CRON_SECRET:-}" ]; then
  echo "[importacion-runner] FATAL: CRON_SECRET vacío" >&2
  exit 1
fi

URL="$CRM_BASE_URL/api/cron/importacion-runner"
AUTH_HEADER="Authorization: Bearer $CRON_SECRET"

# Backoff exponencial cuando la cola está vacía. En idle (sin importaciones
# corriendo), el ciclo "cada 30s" hace 2.880 ticks/día × 2 queries = ~5.760
# round-trips innecesarios contra Postgres. El PAS típico hace 1-2
# importaciones por mes; la cola está vacía el 99.9% del tiempo.
#
# Estrategia:
#   - Tick activo (procesados>0 o en_cola>0): mantener INTERVAL_SECONDS (30s).
#   - Tick idle: cada N idle consecutivos duplicamos la espera hasta MAX_IDLE_SLEEP.
#   - Al recibir un tick activo, volvemos al base.
#
# Latencia máxima para empezar a procesar un job nuevo = MAX_IDLE_SLEEP (5 min).
# Es transparente para el PAS: arranca una importación y a más tardar 5 min
# después el runner se entera.
MAX_IDLE_SLEEP=300
IDLE_TICKS=0

echo "[importacion-runner] Iniciando loop base ${INTERVAL_SECONDS}s (backoff hasta ${MAX_IDLE_SLEEP}s en idle) → $URL"

# Esperar que Next.js esté arriba antes del primer tick
MAX_WAIT=120
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
  if curl -sf -o /dev/null "$CRM_BASE_URL/" 2>/dev/null; then
    break
  fi
  sleep 3
  WAITED=$((WAITED + 3))
done

while true; do
  RESPONSE=$(curl -sf -m 60 -H "$AUTH_HEADER" "$URL" 2>&1)
  EXIT_CODE=$?
  if [ $EXIT_CODE -ne 0 ]; then
    echo "[importacion-runner] WARN curl exit $EXIT_CODE: $RESPONSE" >&2
    IDLE_TICKS=$((IDLE_TICKS + 1))
  else
    # Parseo sin jq: contamos "procesados":N y "en_cola":M en el JSON
    PROCESADOS=$(echo "$RESPONSE" | grep -oE '"procesados":[0-9]+' | grep -oE '[0-9]+$' || echo 0)
    EN_COLA=$(echo "$RESPONSE" | grep -oE '"en_cola":[0-9]+' | grep -oE '[0-9]+$' || echo 0)
    if [ "${PROCESADOS:-0}" -gt 0 ] || [ "${EN_COLA:-0}" -gt 0 ]; then
      if [ $IDLE_TICKS -gt 0 ]; then
        echo "[importacion-runner] cola activa (proc=$PROCESADOS, en_cola=$EN_COLA) — reseteando backoff"
      fi
      IDLE_TICKS=0
    else
      IDLE_TICKS=$((IDLE_TICKS + 1))
    fi
  fi

  # Sleep dinámico: base × 2^(IDLE_TICKS-1) capeado a MAX_IDLE_SLEEP
  if [ $IDLE_TICKS -le 1 ]; then
    SLEEP_SECS=$INTERVAL_SECONDS
  else
    EXP=$((IDLE_TICKS - 1))
    MULTIPLIER=$((1 << EXP))
    SLEEP_SECS=$((INTERVAL_SECONDS * MULTIPLIER))
    if [ $SLEEP_SECS -gt $MAX_IDLE_SLEEP ]; then
      SLEEP_SECS=$MAX_IDLE_SLEEP
    fi
  fi

  sleep $SLEEP_SECS
done
