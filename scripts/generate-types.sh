#!/usr/bin/env bash
# ============================================================
# Regenera src/types/database.generated.ts desde el schema
# actual del Postgres de Supabase (container supabase-db).
#
# Uso: npm run types:generate
#
# Requiere:
#   - Docker corriendo con el container supabase-db
#   - Password en /home/nahuel/supabase/docker/.env (POSTGRES_PASSWORD)
#   - npx (viene con Node)
# ============================================================

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="$PROJECT_DIR/src/types/database.generated.ts"
SUPABASE_ENV="/home/nahuel/supabase/docker/.env"

# 1) Obtener IP del container supabase-db
DB_IP="$(docker inspect supabase-db --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null || true)"

if [[ -z "$DB_IP" ]]; then
  echo "ERROR: no se encontró el container 'supabase-db' corriendo." >&2
  echo "       Verificá con: docker ps | grep supabase-db" >&2
  exit 1
fi

# 2) Obtener password del .env de Supabase
if [[ ! -f "$SUPABASE_ENV" ]]; then
  echo "ERROR: no se encontró $SUPABASE_ENV" >&2
  exit 1
fi

DB_PASS="$(grep -E '^POSTGRES_PASSWORD=' "$SUPABASE_ENV" | cut -d= -f2-)"

if [[ -z "$DB_PASS" ]]; then
  echo "ERROR: POSTGRES_PASSWORD vacío en $SUPABASE_ENV" >&2
  exit 1
fi

# 3) Generar y guardar
echo "→ Generando types desde postgresql://postgres:***@$DB_IP:5432/postgres ..."

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

npx --yes supabase gen types typescript \
  --db-url "postgresql://postgres:$DB_PASS@$DB_IP:5432/postgres" \
  --schema public > "$TMP"

# Sacar la línea "Connecting to..." que la CLI imprime al inicio
sed -i '/^Connecting to /d' "$TMP"

# Insertar header de auto-gen
{
  cat <<'EOF'
// ============================================================
// ARCHIVO AUTO-GENERADO — NO EDITAR A MANO
// ============================================================
// Regenerar con: npm run types:generate
//
// Refleja el schema actual del Postgres de Supabase.
// Las interfaces enriquecidas (con relaciones, JSONB tipado,
// unions nominales) viven en src/types/database.ts y extienden
// de los tipos `Row` exportados acá.
// ============================================================

EOF
  cat "$TMP"
} > "$OUTPUT"

LINES="$(wc -l < "$OUTPUT")"
echo "✓ Generado: $OUTPUT ($LINES líneas)"
