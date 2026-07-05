#!/bin/bash
# Crons LENTOS del CRM (mantenimiento y housekeeping).
# Se ejecutan cada ~2h en el loop dual (no en cada tick del rápido).
#
#   - backup diario:                  snapshot .crmbak
#   - cleanup importaciones:          borrar archivos temporales de imports viejos
#   - cleanup temporales:             /tmp/pdf-procesamientos, /tmp/crm-restauraciones
#   - retencion emails:               archivar/borrar historial de emails viejos
#   - retencion errores:              archivar/borrar errores_sistema viejos
#   - sincronizar modelos anthropic:  refrescar catálogo de modelos vigentes
#   - pdfs huerfanos:                 detectar PDFs en tmp sin procesar
#   - emails/jobs huerfanos:          detectar emails ENVIANDO estancados
#   - purga personas/siniestros:      hard delete de la papelera >30d
#   - licencias:                      rotar activa→expirada, promover encoladas
#   - verificar updates:              chequear si hay release nueva en GitHub
#   - limpiar updates viejas:         borrar registros históricos
#   - campañas programadas:           disparar mailing_campanas cuya fecha llegó
#   - heartbeat panel:                reportar estado al panel FidCore (si aplica)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/crons-lib.sh"

esperar_crm || exit 1

run_cron "backup diario"          /api/cron/backups
run_cron "cleanup importaciones"  /api/cron/importacion-cleanup
run_cron "cleanup temporales"     /api/cron/limpiar-temporales
run_cron "retencion emails"       /api/cron/limpiar-historial-emails
run_cron "retencion errores"      /api/cron/limpiar-errores
run_cron "sincronizar modelos"    /api/cron/sincronizar-modelos-anthropic
run_cron "pdfs huerfanos"         /api/cron/recuperar-pdfs-huerfanos
run_cron "emails/jobs huerfanos"  /api/cron/recuperar-huerfanos
run_cron "purga personas"         /api/cron/personas-purgar
run_cron "purga siniestros"       /api/cron/siniestros-purgar
run_cron "licencias"              /api/cron/licencias
run_cron "verificar updates"      /api/cron/verificar-actualizaciones
run_cron "limpiar updates viejas" /api/cron/limpiar-actualizaciones-viejas
run_cron "campanas programadas"   /api/cron/ejecutar-campanas-programadas --max-time 320
run_cron "heartbeat panel"        /api/cron/heartbeat-panel
