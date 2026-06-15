#!/bin/bash
# output.sh — helpers para mostrar progreso de la instalación.
# Se sourcea desde install.sh con: . "$(dirname "$0")/lib/output.sh"

# Colores (solo si stdout es terminal y no se forzó NO_COLOR)
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\e[0m'
  C_BOLD=$'\e[1m'
  C_DIM=$'\e[2m'
  C_RED=$'\e[31m'
  C_GREEN=$'\e[32m'
  C_YELLOW=$'\e[33m'
  C_BLUE=$'\e[34m'
  C_CYAN=$'\e[36m'
else
  C_RESET=''; C_BOLD=''; C_DIM=''
  C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_CYAN=''
fi

# Logueo a archivo además de stdout (si LOG_FILE está seteada)
_log_a_archivo() {
  if [ -n "${LOG_FILE:-}" ]; then
    # Quitar códigos ANSI antes de escribir al archivo
    printf '%s\n' "$1" | sed -E 's/\x1B\[[0-9;]*[mK]//g' >> "$LOG_FILE"
  fi
}

fase() {
  local msg="$1"
  local linea="================================================================"
  echo
  echo "${C_BOLD}${C_BLUE}${linea}${C_RESET}"
  echo "${C_BOLD}${C_BLUE}  ${msg}${C_RESET}"
  echo "${C_BOLD}${C_BLUE}${linea}${C_RESET}"
  _log_a_archivo ""
  _log_a_archivo "================================================================"
  _log_a_archivo "  ${msg}"
  _log_a_archivo "================================================================"
}

paso() {
  echo
  echo "${C_BOLD}${C_CYAN}▸ $1${C_RESET}"
  _log_a_archivo ""
  _log_a_archivo "▸ $1"
}

info() {
  echo "  ${C_DIM}$1${C_RESET}"
  _log_a_archivo "  $1"
}

ok() {
  echo "  ${C_GREEN}✓${C_RESET} $1"
  _log_a_archivo "  ✓ $1"
}

warn() {
  echo "  ${C_YELLOW}⚠${C_RESET}  $1"
  _log_a_archivo "  ⚠  $1"
}

# Imprime a stderr y NO sale — el caller decide si abortar
error() {
  echo "  ${C_RED}✗${C_RESET} $1" >&2
  _log_a_archivo "  ✗ $1"
}

# Sale del script con código 1 — usar para errores fatales
abortar() {
  echo >&2
  echo "  ${C_BOLD}${C_RED}✗ FATAL: $1${C_RESET}" >&2
  echo >&2
  _log_a_archivo ""
  _log_a_archivo "  ✗ FATAL: $1"
  _log_a_archivo ""
  exit 1
}

# Pregunta sí/no — retorna 0 (sí) o 1 (no)
# Uso: if confirmar "¿Continuar?"; then ...; fi
# El segundo arg opcional es el default ('s' o 'n')
confirmar() {
  local pregunta="$1"
  local default="${2:-n}"
  local prompt
  if [ "$default" = "s" ]; then
    prompt="[S/n]"
  else
    prompt="[s/N]"
  fi
  local respuesta
  while true; do
    read -r -p "  ${C_BOLD}?${C_RESET} ${pregunta} ${prompt} " respuesta
    respuesta="${respuesta:-$default}"
    case "$respuesta" in
      [sSyY])  return 0 ;;
      [nN])    return 1 ;;
      *) echo "  ${C_YELLOW}Respondé 's' o 'n'.${C_RESET}" ;;
    esac
  done
}

# Lee una variable. Si la var ya está en env, la usa silencioso.
# Si no, prompt al usuario.
# Uso: leer_var NOMBRE_VAR "Pregunta al usuario" [default]
leer_var() {
  local var_name="$1"
  local pregunta="$2"
  local default="${3:-}"
  local valor_actual
  valor_actual="$(eval "echo \${$var_name:-}")"
  if [ -n "$valor_actual" ]; then
    info "${var_name} ya seteada en env, usando ese valor"
    return 0
  fi
  local prompt_extra=""
  [ -n "$default" ] && prompt_extra=" [${default}]"
  local respuesta
  read -r -p "  ${C_BOLD}?${C_RESET} ${pregunta}${prompt_extra}: " respuesta
  respuesta="${respuesta:-$default}"
  eval "${var_name}=\"\$respuesta\""
}
