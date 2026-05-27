#!/bin/bash
# Ejecuta los crons del CRM una vez (catch-up al boot + cada 4h via timer/loop).
# Funciona en dos modos:
#   - HOST/systemd:  ENV_FILE=/home/.../.env.local, CRM_BASE_URL=http://localhost:3000
#   - DOCKER:        CRON_SECRET en env, CRM_BASE_URL=http://crm:3000
#
# El ENV_FILE se respeta si CRON_SECRET no viene en env. Si tampoco hay archivo,
# el script avisa y sigue (las llamadas serán rechazadas pero no abortamos).

ENV_FILE="${CRM_ENV_FILE:-/home/nahuel/crm-seguros/.env.local}"
CRM_BASE_URL="${CRM_BASE_URL:-http://localhost:3000}"

if [ -z "$CRON_SECRET" ] && [ -f "$ENV_FILE" ]; then
  CRON_SECRET=$(grep '^CRON_SECRET=' "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'")
fi

if [ -z "$CRON_SECRET" ]; then
  echo "[crm-crons] WARN: CRON_SECRET vacío — los endpoints de cron rechazarán las llamadas"
fi

AUTH_HEADER="Authorization: Bearer $CRON_SECRET"
MAX_WAIT=120
WAITED=0

echo "[crm-crons] Esperando a que el CRM responda en $CRM_BASE_URL ..."
while [ $WAITED -lt $MAX_WAIT ]; do
  if curl -sf -o /dev/null "$CRM_BASE_URL/" 2>/dev/null; then
    echo "[crm-crons] CRM listo tras ${WAITED}s"
    break
  fi
  sleep 3
  WAITED=$((WAITED + 3))
done

if [ $WAITED -ge $MAX_WAIT ]; then
  echo "[crm-crons] ERROR: el CRM no respondió tras ${MAX_WAIT}s. Abortando."
  exit 1
fi

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

run_cron "polizas"                /api/cron/polizas
run_cron "notificaciones"         /api/cron/notificaciones
run_cron "backup diario"          /api/cron/backups
run_cron "cleanup importaciones"  /api/cron/importacion-cleanup
run_cron "cleanup temporales"     /api/cron/limpiar-temporales
run_cron "cola emails"            /api/cron/enviar-emails-encolados --max-time 320
run_cron "retencion emails"       /api/cron/limpiar-historial-emails
run_cron "retencion errores"      /api/cron/limpiar-errores
run_cron "sincronizar modelos"    /api/cron/sincronizar-modelos-anthropic
run_cron "pdfs huerfanos"         /api/cron/recuperar-pdfs-huerfanos
run_cron "emails/jobs huerfanos"  /api/cron/recuperar-huerfanos
run_cron "purga personas"         /api/cron/personas-purgar
run_cron "purga siniestros"       /api/cron/siniestros-purgar
run_cron "licencias"              /api/cron/licencias
