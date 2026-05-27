#!/bin/bash
# Generación de secrets para la instalación.
# Todo con openssl puro (no requiere node/python en el host).

# Genera un hex de N bytes (default 32 → 64 chars hex)
generar_hex() {
  local bytes="${1:-32}"
  openssl rand -hex "$bytes"
}

# Genera un base64 url-safe sin padding (estilo JWT)
_base64url() {
  openssl base64 -A | tr '+/' '-_' | tr -d '='
}

# Genera un JWT HS256 firmado con el secret pasado.
# Uso: generar_jwt "<JWT_SECRET>" '<payload_json>'
generar_jwt() {
  local secret="$1"
  local payload_json="$2"

  local header_json='{"alg":"HS256","typ":"JWT"}'
  local header_b64
  local payload_b64
  header_b64=$(printf '%s' "$header_json" | _base64url)
  payload_b64=$(printf '%s' "$payload_json" | _base64url)

  local signing_input="${header_b64}.${payload_b64}"
  local signature
  signature=$(printf '%s' "$signing_input" | \
    openssl dgst -sha256 -hmac "$secret" -binary | _base64url)

  echo "${signing_input}.${signature}"
}

# Genera ANON_KEY de Supabase (rol "anon", expira en 10 años)
# Uso: generar_anon_key "<JWT_SECRET>"
generar_anon_key() {
  local secret="$1"
  local iat
  local exp
  iat=$(date +%s)
  exp=$((iat + 60 * 60 * 24 * 365 * 10))
  local payload
  payload=$(printf '{"iss":"supabase","role":"anon","iat":%d,"exp":%d}' "$iat" "$exp")
  generar_jwt "$secret" "$payload"
}

# Genera SERVICE_ROLE_KEY de Supabase (rol "service_role")
generar_service_role_key() {
  local secret="$1"
  local iat
  local exp
  iat=$(date +%s)
  exp=$((iat + 60 * 60 * 24 * 365 * 10))
  local payload
  payload=$(printf '{"iss":"supabase","role":"service_role","iat":%d,"exp":%d}' "$iat" "$exp")
  generar_jwt "$secret" "$payload"
}

# Valida que un JWT generado se pueda parsear (sanity check)
validar_jwt_estructura() {
  local jwt="$1"
  # Debe tener exactamente 3 partes separadas por punto
  local partes
  partes=$(echo "$jwt" | awk -F'.' '{print NF}')
  if [[ "$partes" != "3" ]]; then
    return 1
  fi
  return 0
}
