#!/bin/bash
# Biblioteca compartida por startup-crons-rapidos.sh y startup-crons-lentos.sh.
# Provee: leer CRON_SECRET del env o del .env.local, esperar al CRM, disparar
# un endpoint de cron con autenticación.

ENV_FILE="${CRM_ENV_FILE:-/home/nahuel/crm-seguros/.env.local}"
CRM_BASE_URL="${CRM_BASE_URL:-http://localhost:3000}"

if [ -z "${CRON_SECRET:-}" ] && [ -f "$ENV_FILE" ]; then
  CRON_SECRET=$(grep '^CRON_SECRET=' "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'")
fi

if [ -z "${CRON_SECRET:-}" ]; then
  echo "[crm-crons] WARN: CRON_SECRET vacío — los endpoints de cron rechazarán las llamadas"
fi

AUTH_HEADER="Authorization: Bearer $CRON_SECRET"

# Espera a que el CRM esté listo (solo la primera vez que se llama por proceso).
esperar_crm() {
  local MAX_WAIT=120
  local WAITED=0
  echo "[crm-crons] Esperando a que el CRM responda en $CRM_BASE_URL ..."
  while [ $WAITED -lt $MAX_WAIT ]; do
    if curl -sf -o /dev/null "$CRM_BASE_URL/" 2>/dev/null; then
      echo "[crm-crons] CRM listo tras ${WAITED}s"
      return 0
    fi
    sleep 3
    WAITED=$((WAITED + 3))
  done
  echo "[crm-crons] ERROR: el CRM no respondió tras ${MAX_WAIT}s"
  return 1
}

# run_cron <nombre-legible> <path-de-cron> [opcional: --max-time XX]
run_cron() {
  local nombre="$1"
  local path="$2"
  shift 2
  local extra_args=("$@")

  echo "[crm-crons] Ejecutando: $nombre ..."
  local result
  result=$(curl -sf -H "$AUTH_HEADER" "${extra_args[@]}" "$CRM_BASE_URL$path" 2>&1)
  local code=$?

  if [ $code -eq 0 ]; then
    echo "[crm-crons] OK $nombre: $result"
  else
    echo "[crm-crons] ERROR $nombre (exit $code): $result"
  fi
}
