#!/bin/bash
# Validadores de inputs del instalador.
# Cada validador devuelve 0 si OK, 1 si error (y escribe el motivo a stderr).

validar_slug() {
  local slug="$1"
  if [[ -z "$slug" ]]; then
    ui_error "El slug no puede estar vacío." >&2
    return 1
  fi
  if [[ ! "$slug" =~ ^[a-z0-9-]+$ ]]; then
    ui_error "El slug solo puede tener minúsculas, números y guiones (sin espacios, sin acentos, sin ñ)." >&2
    return 1
  fi
  if [[ ${#slug} -lt 3 ]] || [[ ${#slug} -gt 30 ]]; then
    ui_error "El slug debe tener entre 3 y 30 caracteres." >&2
    return 1
  fi
  if [[ "$slug" =~ ^- ]] || [[ "$slug" =~ -$ ]]; then
    ui_error "El slug no puede empezar ni terminar con guión." >&2
    return 1
  fi
  return 0
}

validar_email() {
  local email="$1"
  if [[ ! "$email" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
    ui_error "Email con formato inválido." >&2
    return 1
  fi
  return 0
}

validar_url_https() {
  local url="$1"
  if [[ ! "$url" =~ ^https://[a-zA-Z0-9.-]+(/.*)?$ ]]; then
    ui_error "La URL debe empezar con https:// y tener un dominio válido." >&2
    return 1
  fi
  return 0
}

# Tokens de Cloudflare son JWT-like (3 partes base64.base64.base64) o blobs
# largos base64. Validación laxa: solo chequea que sea largo.
validar_tunnel_token() {
  local token="$1"
  if [[ ${#token} -lt 100 ]]; then
    ui_error "El tunnel token parece muy corto. Verificá que copiaste el token completo." >&2
    return 1
  fi
  if [[ "$token" =~ [[:space:]] ]]; then
    ui_error "El tunnel token no debería tener espacios. ¿Lo copiaste entero?" >&2
    return 1
  fi
  return 0
}

# Sentry DSN: https://xxx@yyy.ingest.sentry.io/zzz
validar_sentry_dsn() {
  local dsn="$1"
  # Permite vacío (Sentry es opcional)
  [[ -z "$dsn" ]] && return 0
  if [[ ! "$dsn" =~ ^https://[a-f0-9]+@[a-zA-Z0-9.-]+\.sentry\.io/[0-9]+$ ]]; then
    ui_error "El DSN de Sentry tiene un formato inesperado. Debería ser https://xxx@oNNN.ingest.sentry.io/PPP" >&2
    return 1
  fi
  return 0
}

validar_archivo_existe() {
  local ruta="$1"
  if [[ ! -f "$ruta" ]]; then
    ui_error "No existe el archivo: $ruta" >&2
    return 1
  fi
  return 0
}

# Para inputs opcionales que pueden quedar vacíos
validar_opcional() {
  return 0
}
