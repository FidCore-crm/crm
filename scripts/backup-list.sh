#!/bin/bash

BACKUP_BASE="/var/backups/crm-seguros"

if [ ! -d "$BACKUP_BASE" ]; then
  echo "Directorio de backups no existe: $BACKUP_BASE"
  exit 1
fi

echo "Backups disponibles:"
echo ""
printf "%-30s %-12s %-20s %s\n" "NOMBRE" "TAMANO" "FECHA" "TIPO"
echo "----------------------------------------------------------------------"

for backup in $(ls -1dt "$BACKUP_BASE"/backup-* 2>/dev/null); do
  NOMBRE=$(basename "$backup")
  TAMANO=$(du -sh "$backup" 2>/dev/null | cut -f1)
  FECHA=$(stat -c '%y' "$backup" | cut -d. -f1)

  # Extraer tipo del metadata si existe
  TIPO="-"
  if [ -f "$backup/metadata.json" ]; then
    TIPO=$(grep -o '"tipo": *"[^"]*"' "$backup/metadata.json" | sed 's/.*"tipo": *"\(.*\)"/\1/')
  fi

  printf "%-30s %-12s %-20s %s\n" "$NOMBRE" "$TAMANO" "$FECHA" "$TIPO"
done

echo ""
TOTAL=$(du -sh "$BACKUP_BASE" 2>/dev/null | cut -f1)
COUNT=$(ls -1d "$BACKUP_BASE"/backup-* 2>/dev/null | wc -l)
echo "Total: $COUNT backup(s), $TOTAL"
