#!/bin/bash
# Persistencia del progreso del instalador.
# Permite reanudar una instalación interrumpida sin volver a preguntar todo.
#
# Estructura:
#   /etc/fidcore/instalador.env  →  variables recolectadas (slug, tokens, etc.)
#   /etc/fidcore/instalador.progreso  →  marcas de fase completada
#
# Las marcas son fase=NOMBRE\nfecha=ISO una línea por fase.

ESTADO_DIR="/etc/fidcore"
ESTADO_ENV="$ESTADO_DIR/instalador.env"
ESTADO_PROGRESO="$ESTADO_DIR/instalador.progreso"

estado_init() {
  sudo mkdir -p "$ESTADO_DIR"
  sudo chmod 700 "$ESTADO_DIR"
  if [[ ! -f "$ESTADO_ENV" ]]; then
    sudo touch "$ESTADO_ENV"
    sudo chmod 600 "$ESTADO_ENV"
  fi
  if [[ ! -f "$ESTADO_PROGRESO" ]]; then
    sudo touch "$ESTADO_PROGRESO"
    sudo chmod 600 "$ESTADO_PROGRESO"
  fi
}

# Guarda una variable en el .env del instalador
# Uso: estado_set CLIENTE_SLUG "juanperez"
# Valida que la clave matchee [A-Z_][A-Z0-9_]* y que el valor no tenga
# saltos de línea, para evitar inyección al archivo del estado.
estado_set() {
  local clave="$1"
  local valor="$2"
  if [[ ! "$clave" =~ ^[A-Z_][A-Z0-9_]*$ ]]; then
    echo "ERROR estado_set: clave inválida: '$clave'" >&2
    return 1
  fi
  if [[ "$valor" == *$'\n'* || "$valor" == *$'\r'* ]]; then
    echo "ERROR estado_set: el valor de '$clave' contiene saltos de línea" >&2
    return 1
  fi
  # Eliminar línea anterior si existe + agregar la nueva
  sudo sed -i "/^${clave}=/d" "$ESTADO_ENV"
  printf '%s=%s\n' "$clave" "$valor" | sudo tee -a "$ESTADO_ENV" > /dev/null
}

# Lee una variable del estado (o devuelve el default si no existe)
# Uso: slug=$(estado_get CLIENTE_SLUG)
estado_get() {
  local clave="$1"
  local default="${2:-}"
  if [[ -f "$ESTADO_ENV" ]]; then
    local valor
    valor=$(sudo grep "^${clave}=" "$ESTADO_ENV" 2>/dev/null | head -1 | cut -d= -f2-)
    if [[ -n "$valor" ]]; then
      echo "$valor"
      return 0
    fi
  fi
  echo "$default"
}

# Carga TODAS las variables del estado al entorno actual (export).
#
# IMPORTANTE: NO usamos `source` porque ese archivo puede contener tokens
# generados por el PAS / operador, y si alguno tuviese ` $(rm -rf) ` por
# error, `source` lo ejecutaría. Parseamos línea por línea con regex.
estado_load_all() {
  if [[ ! -f "$ESTADO_ENV" ]]; then return 0; fi
  local linea clave valor
  while IFS= read -r linea; do
    # Saltar líneas vacías y comentarios
    [[ -z "$linea" || "$linea" =~ ^# ]] && continue
    # Aceptar solo CLAVE=VALOR donde CLAVE matchee [A-Z_][A-Z0-9_]*
    if [[ "$linea" =~ ^([A-Z_][A-Z0-9_]*)=(.*)$ ]]; then
      clave="${BASH_REMATCH[1]}"
      valor="${BASH_REMATCH[2]}"
      # Asignar sin ejecutar el valor
      printf -v "$clave" '%s' "$valor"
      export "$clave"
    fi
  done < <(sudo cat "$ESTADO_ENV")
}

# Marca una fase como completada
fase_completar() {
  local fase="$1"
  if ! fase_esta_completa "$fase"; then
    echo "$fase|$(date -Iseconds)" | sudo tee -a "$ESTADO_PROGRESO" > /dev/null
  fi
}

# Chequea si una fase ya está completa
fase_esta_completa() {
  local fase="$1"
  sudo grep -q "^${fase}|" "$ESTADO_PROGRESO" 2>/dev/null
}

# Lista todas las fases completas (una por línea)
fases_completas() {
  if [[ -f "$ESTADO_PROGRESO" ]]; then
    sudo cut -d'|' -f1 "$ESTADO_PROGRESO"
  fi
}

# Reset del estado (útil para empezar de cero)
estado_reset() {
  sudo rm -f "$ESTADO_ENV" "$ESTADO_PROGRESO"
  estado_init
}
