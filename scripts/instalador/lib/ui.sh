#!/bin/bash
# Wrappers de gum para la UI del instalador.
# Si gum no está instalado, lo instalamos primero (ver fases/0-prereqs.sh).

# Colores Pulzar (naranja del logo)
COLOR_PRIMARIO="#FF6B35"
COLOR_OK="#22c55e"
COLOR_WARN="#f59e0b"
COLOR_ERROR="#ef4444"
COLOR_INFO="#3b82f6"

# Banner grande con título
ui_banner() {
  local titulo="$1"
  local subtitulo="${2:-}"
  echo ""
  gum style \
    --foreground "$COLOR_PRIMARIO" \
    --border double \
    --border-foreground "$COLOR_PRIMARIO" \
    --padding "1 4" \
    --align center \
    --width 70 \
    "$titulo" "$subtitulo"
  echo ""
}

# Encabezado de sección (más liviano que el banner)
ui_seccion() {
  echo ""
  gum style \
    --foreground "$COLOR_PRIMARIO" \
    --bold \
    --border-foreground "$COLOR_PRIMARIO" \
    --border-bottom \
    --width 70 \
    "▶ $1"
  echo ""
}

# Mensajes con icono
ui_ok()    { gum style --foreground "$COLOR_OK"    "✓ $1"; }
ui_warn()  { gum style --foreground "$COLOR_WARN"  "⚠ $1"; }
ui_error() { gum style --foreground "$COLOR_ERROR" "✗ $1"; }
ui_info()  { gum style --foreground "$COLOR_INFO"  "ℹ $1"; }

# Texto plano con sangría (para descripciones de paso)
ui_desc() {
  gum style --margin "0 2" --foreground 244 "$1"
}

# Input simple
ui_input() {
  local prompt="$1"
  local placeholder="${2:-}"
  local valor_default="${3:-}"
  gum input \
    --prompt "$prompt " \
    --prompt.foreground "$COLOR_PRIMARIO" \
    --placeholder "$placeholder" \
    --value "$valor_default" \
    --width 60
}

# Input con validación (re-pregunta hasta que pase)
# Uso: ui_input_validado "Slug del cliente" "ej: juanperez" "funcion_validadora"
ui_input_validado() {
  local prompt="$1"
  local placeholder="$2"
  local validador="$3"
  local valor_default="${4:-}"
  local valor
  while true; do
    valor=$(ui_input "$prompt" "$placeholder" "$valor_default")
    if "$validador" "$valor"; then
      echo "$valor"
      return 0
    fi
    # validador imprime el error a stderr
  done
}

# Input para secrets (oculta lo tipeado)
ui_password() {
  local prompt="$1"
  gum input \
    --prompt "$prompt " \
    --prompt.foreground "$COLOR_PRIMARIO" \
    --password \
    --width 60
}

# Confirmación sí/no
ui_confirm() {
  local pregunta="$1"
  gum confirm \
    --prompt.foreground "$COLOR_PRIMARIO" \
    --selected.background "$COLOR_PRIMARIO" \
    "$pregunta"
}

# Menú de opciones (devuelve la elegida)
ui_choose() {
  local titulo="$1"
  shift
  echo "$titulo" >&2
  gum choose \
    --cursor.foreground "$COLOR_PRIMARIO" \
    --selected.foreground "$COLOR_PRIMARIO" \
    "$@"
}

# Spinner mientras corre un comando
# Uso: ui_spin "Aplicando migraciones..." -- bash -c "comando"
ui_spin() {
  local titulo="$1"
  shift
  gum spin \
    --spinner dot \
    --spinner.foreground "$COLOR_PRIMARIO" \
    --title "$titulo" \
    -- "$@"
}

# Pausa hasta que apriete Enter
ui_pausa() {
  local msg="${1:-Apretá Enter para continuar}"
  gum input --prompt "" --placeholder "$msg (Enter)" --width 60 > /dev/null
}

# Muestra un bloque de texto multilinea con borde
ui_box() {
  gum style \
    --border rounded \
    --border-foreground 244 \
    --padding "1 2" \
    --margin "0 2" \
    --width 70 \
    "$@"
}

# Línea separadora
ui_hr() {
  gum style --foreground 240 --width 70 --align center "────────────────────────────────────────────────────────────"
}
