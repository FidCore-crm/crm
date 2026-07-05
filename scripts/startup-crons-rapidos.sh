#!/bin/bash
# Crons RÁPIDOS del CRM (afectan la operación diaria del PAS).
# Se ejecutan en cada tick del loop (default 20 min).
#
#   - polizas:              transiciones VIGENTE→NO_VIGENTE, PROGRAMADA→VIGENTE, etc.
#   - notificaciones:       generar alertas al PAS (vencimientos, tareas atrasadas, etc.)
#   - enviar-emails:        procesar cola de emails ENCOLADOS

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/crons-lib.sh"

esperar_crm || exit 1

run_cron "polizas"          /api/cron/polizas
run_cron "notificaciones"   /api/cron/notificaciones
run_cron "cola emails"      /api/cron/enviar-emails-encolados --max-time 320
