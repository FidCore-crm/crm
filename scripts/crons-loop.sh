#!/bin/bash
# Loop dual de crons del CRM cuando corren como container del compose.
# En el host con systemd se usa crm-crons.timer + crm-crons.service que dispara
# startup-crons.sh (rápidos + lentos en un mismo pase).
#
# Acá separamos:
#   - Rápidos (polizas, notificaciones, cola emails):  cada CRONS_INTERVAL_RAPIDO
#   - Lentos (backups, limpiezas, updates, etc.):      cada CRONS_INTERVAL_LENTO
#
# La lógica es: correr rápidos siempre. Correr lentos solo cuando pasó el
# intervalo lento. Simple y sin dependencias externas.

set -u

INTERVAL_RAPIDO="${CRONS_INTERVAL_RAPIDO:-1200}"  # 20 min por defecto
INTERVAL_LENTO="${CRONS_INTERVAL_LENTO:-7200}"    # 2h por defecto
# Retrocompatibilidad — si el usuario tenía CRONS_INTERVAL_SECONDS seteado,
# lo tomamos como intervalo LENTO (ese era el default histórico).
if [ -n "${CRONS_INTERVAL_SECONDS:-}" ]; then
  INTERVAL_LENTO="$CRONS_INTERVAL_SECONDS"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[crons-loop] Iniciando loop dual"
echo "[crons-loop]   Rápidos cada ${INTERVAL_RAPIDO}s (polizas, notificaciones, emails encolados)"
echo "[crons-loop]   Lentos cada ${INTERVAL_LENTO}s (backups, limpiezas, updates, etc.)"

ultimo_lento=0

while true; do
  # Siempre correr rápidos
  bash "$SCRIPT_DIR/startup-crons-rapidos.sh" || echo "[crons-loop] startup-crons-rapidos.sh terminó con error (continuamos)"

  # Correr lentos si pasó el intervalo lento (o es la primera vez)
  ahora=$(date +%s)
  transcurrido=$((ahora - ultimo_lento))
  if [ $transcurrido -ge $INTERVAL_LENTO ]; then
    echo "[crons-loop] Disparando lentos (transcurrido ${transcurrido}s desde el anterior)"
    bash "$SCRIPT_DIR/startup-crons-lentos.sh" || echo "[crons-loop] startup-crons-lentos.sh terminó con error (continuamos)"
    ultimo_lento=$(date +%s)
  fi

  echo "[crons-loop] Próximo tick rápido en ${INTERVAL_RAPIDO}s"
  sleep "$INTERVAL_RAPIDO"
done
