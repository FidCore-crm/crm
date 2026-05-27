#!/bin/bash
# ============================================================================
# Pulzar CRM — Instalador interactivo
#
# Uso: bash scripts/instalador/instalar.sh
#
# Prerequisitos:
#   - Ubuntu Server 22.04+ (recomendado 24.04 LTS)
#   - Tu usuario con sudo
#   - Internet
#   - El repo del CRM ya clonado en disco (este script vive adentro)
#   - Cloudflare Tunnel ya creado en el dashboard (necesitás el token)
#
# El script es idempotente: si una fase falla, podés volver a correrlo y elegir
# desde dónde retomar (estado en /etc/pulzar/instalador.{env,progreso}).
# ============================================================================

# `-u` falla si se usa una variable no seteada.
# `-o pipefail` propaga el exit code del primer comando que falla en un pipe.
# NO usamos `-e` porque el flujo del menú depende de comandos que devuelven
# no-cero como flujo de control normal (`ui_confirm`, validaciones, etc.).
# Los fallos de cada fase se manejan explícitamente con `if ! _correr_fase`.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Cargar librerías
# shellcheck source=lib/ui.sh
source "$SCRIPT_DIR/lib/ui.sh"
# shellcheck source=lib/validar.sh
source "$SCRIPT_DIR/lib/validar.sh"
# shellcheck source=lib/estado.sh
source "$SCRIPT_DIR/lib/estado.sh"

# Lista canónica de fases en orden de ejecución.
# Cada item: "id|nombre legible|función a ejecutar"
FASES=(
  "prereqs|Verificación de prerequisitos|fase_prereqs_ejecutar"
  "datos|Recolección de datos del cliente|fase_datos_ejecutar"
  "sistema|Configuración del sistema (apt, timezone, unattended-upgrades)|fase_sistema_ejecutar"
  "docker|Docker Engine + Compose|fase_docker_ejecutar"
  "utils|Portainer + Tailscale|fase_utils_ejecutar"
  "supabase|Supabase self-hosted|fase_supabase_ejecutar"
  "crm|CRM (env, migraciones, build, up)|fase_crm_ejecutar"
  "cloudflared|Cloudflare Tunnel|fase_cloudflared_ejecutar"
  "smoke|Smoke test final|fase_smoke_ejecutar"
)

_cargar_fases() {
  # shellcheck source=fases/0-prereqs.sh
  source "$SCRIPT_DIR/fases/0-prereqs.sh"
  # shellcheck source=fases/1-datos.sh
  source "$SCRIPT_DIR/fases/1-datos.sh"
  # shellcheck source=fases/2-sistema.sh
  source "$SCRIPT_DIR/fases/2-sistema.sh"
  # shellcheck source=fases/3-docker.sh
  source "$SCRIPT_DIR/fases/3-docker.sh"
  # shellcheck source=fases/4-utils.sh
  source "$SCRIPT_DIR/fases/4-utils.sh"
  # shellcheck source=fases/5-supabase.sh
  source "$SCRIPT_DIR/fases/5-supabase.sh"
  # shellcheck source=fases/6-crm.sh
  source "$SCRIPT_DIR/fases/6-crm.sh"
  # shellcheck source=fases/7-cloudflared.sh
  source "$SCRIPT_DIR/fases/7-cloudflared.sh"
  # shellcheck source=fases/8-smoke.sh
  source "$SCRIPT_DIR/fases/8-smoke.sh"
}

# ----- Bootstrap mínimo si gum no está aún -----
_bootstrap_sin_gum() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════════════"
  echo "  Pulzar CRM — Instalador"
  echo "═══════════════════════════════════════════════════════════════════════"
  echo ""
  echo "gum no está instalado todavía. Lo instalo ahora para tener una UI mejor..."
  echo ""

  if [[ "$EUID" -eq 0 ]]; then
    echo "ERROR: No corras este instalador como root."
    echo "       Corré como tu usuario habitual: bash $0"
    exit 1
  fi

  if ! command -v sudo > /dev/null 2>&1; then
    echo "ERROR: 'sudo' no está disponible. Instalalo primero o usá un usuario con sudo."
    exit 1
  fi

  sudo -v || { echo "ERROR: no se pudo obtener sudo."; exit 1; }

  sudo mkdir -p /etc/apt/keyrings
  curl -fsSL https://repo.charm.sh/apt/gpg.key 2>/dev/null | \
    sudo gpg --dearmor -o /etc/apt/keyrings/charm.gpg 2>/dev/null
  echo "deb [signed-by=/etc/apt/keyrings/charm.gpg] https://repo.charm.sh/apt/ * *" | \
    sudo tee /etc/apt/sources.list.d/charm.list > /dev/null

  echo "  Actualizando repos..."
  sudo apt-get update -qq > /dev/null 2>&1

  echo "  Instalando gum..."
  if ! sudo apt-get install -y gum > /dev/null 2>&1; then
    echo "ERROR: no se pudo instalar gum."
    echo "       Probá manualmente: sudo apt-get install -y gum"
    exit 1
  fi

  echo "  ✓ gum instalado."
  echo ""
}

if ! command -v gum > /dev/null 2>&1; then
  _bootstrap_sin_gum
fi

_cargar_fases
estado_init

# ----- Banner principal -----
mostrar_banner_principal() {
  clear
  ui_banner "Pulzar CRM" "Instalador del servidor"

  ui_box "Instalación 100% guiada. El wizard te va a pedir los datos del cliente,
levantar Docker, Supabase y el CRM, aplicar migraciones, y dejar todo listo
para que el PAS se cree su admin.

Tiempo estimado: ~15-20 min (sin contar download de containers).

El estado se guarda en /etc/pulzar/instalador.* — si algo falla podés
volver a correr y elegir 'Reanudar desde la última fase completada'."
  echo ""
}

# ----- Menú principal -----
menu_principal() {
  local opciones=(
    "▶ Empezar instalación completa"
    "↻ Reanudar desde la última fase completada"
    "▷ Correr UNA fase específica"
    "✎ Solo recolectar/actualizar datos del cliente"
    "📋 Ver progreso (fases completadas)"
    "🗑  Reset total del estado"
    "✗ Salir"
  )

  local opcion
  opcion=$(ui_choose "¿Qué querés hacer?" "${opciones[@]}")

  case "$opcion" in
    "▶ Empezar instalación completa")
      flujo_completo
      ;;
    "↻ Reanudar desde la última fase completada")
      flujo_reanudar
      ;;
    "▷ Correr UNA fase específica")
      flujo_una_fase
      ;;
    "✎ Solo recolectar/actualizar datos del cliente")
      fase_datos_ejecutar
      ;;
    "📋 Ver progreso (fases completadas)")
      ver_progreso
      ;;
    "🗑  Reset total del estado")
      if ui_confirm "Esto borra los datos guardados (tunnel token, slug, etc.). ¿Seguro?"; then
        estado_reset
        ui_ok "Estado reseteado."
      fi
      ;;
    "✗ Salir")
      exit 0
      ;;
  esac
}

ver_progreso() {
  ui_seccion "Progreso de la instalación"
  echo ""
  for fase_def in "${FASES[@]}"; do
    local id nombre
    id=$(echo "$fase_def" | cut -d'|' -f1)
    nombre=$(echo "$fase_def" | cut -d'|' -f2)
    if fase_esta_completa "$id"; then
      ui_ok "$nombre"
    else
      ui_desc "○ $nombre (pendiente)"
    fi
  done
  echo ""
  ui_pausa
}

# Devuelve la lista de IDs de fases anteriores a la dada (excluyendo la misma).
_fases_anteriores() {
  local id="$1"
  for fase_def in "${FASES[@]}"; do
    local fid
    fid=$(echo "$fase_def" | cut -d'|' -f1)
    if [[ "$fid" == "$id" ]]; then return 0; fi
    echo "$fid"
  done
}

# Avisa si la fase tiene prereqs incompletos y pide confirmación para continuar.
# Útil cuando el operador elige "correr una fase específica" y se saltea pasos.
_validar_prereqs_fase() {
  local id="$1"
  local faltantes=()
  while IFS= read -r prereq; do
    [[ -z "$prereq" ]] && continue
    if ! fase_esta_completa "$prereq"; then
      faltantes+=("$prereq")
    fi
  done < <(_fases_anteriores "$id")

  if [[ ${#faltantes[@]} -eq 0 ]]; then return 0; fi

  ui_warn "[$id] Hay fases anteriores incompletas: ${faltantes[*]}"
  if ! ui_confirm "¿Continuar de todos modos? (puede fallar si dependía de algo previo)"; then
    return 1
  fi
  return 0
}

# Ejecuta una fase y termina el flujo si falla
_correr_fase() {
  local id="$1"
  local nombre="$2"
  local funcion="$3"

  if fase_esta_completa "$id"; then
    if ! ui_confirm "[$id] Ya está completa. ¿Volver a ejecutar?"; then
      return 0
    fi
  fi

  if ! _validar_prereqs_fase "$id"; then
    return 1
  fi

  if ! "$funcion"; then
    ui_error "La fase '$nombre' falló."
    ui_desc "Podés revisar el error arriba y volver a correr el instalador para reintentar."
    return 1
  fi

  return 0
}

# ----- Flujo completo (todas las fases en orden) -----
flujo_completo() {
  for fase_def in "${FASES[@]}"; do
    local id nombre funcion
    id=$(echo "$fase_def" | cut -d'|' -f1)
    nombre=$(echo "$fase_def" | cut -d'|' -f2)
    funcion=$(echo "$fase_def" | cut -d'|' -f3)

    if ! _correr_fase "$id" "$nombre" "$funcion"; then
      return 1
    fi
  done

  ui_ok "Instalación completa."
}

# ----- Reanudar desde la primera no-completada -----
flujo_reanudar() {
  local empezar_desde=""
  for fase_def in "${FASES[@]}"; do
    local id
    id=$(echo "$fase_def" | cut -d'|' -f1)
    if ! fase_esta_completa "$id"; then
      empezar_desde="$id"
      break
    fi
  done

  if [[ -z "$empezar_desde" ]]; then
    ui_ok "Todas las fases ya están completas. Nada que reanudar."
    if ui_confirm "¿Re-correr el smoke test?"; then
      fase_smoke_ejecutar
    fi
    return
  fi

  ui_info "Reanudando desde: $empezar_desde"
  local empezando=0
  for fase_def in "${FASES[@]}"; do
    local id nombre funcion
    id=$(echo "$fase_def" | cut -d'|' -f1)
    nombre=$(echo "$fase_def" | cut -d'|' -f2)
    funcion=$(echo "$fase_def" | cut -d'|' -f3)

    if [[ "$id" == "$empezar_desde" ]]; then empezando=1; fi
    [[ "$empezando" == "1" ]] || continue

    if ! _correr_fase "$id" "$nombre" "$funcion"; then
      return 1
    fi
  done

  ui_ok "Reanudación completa."
}

# ----- Ejecutar una sola fase específica -----
flujo_una_fase() {
  local opciones=()
  for fase_def in "${FASES[@]}"; do
    local id nombre
    id=$(echo "$fase_def" | cut -d'|' -f1)
    nombre=$(echo "$fase_def" | cut -d'|' -f2)
    local marca="○"
    fase_esta_completa "$id" && marca="✓"
    opciones+=("$marca [$id] $nombre")
  done

  local eleccion
  eleccion=$(ui_choose "¿Qué fase querés correr?" "${opciones[@]}")

  # Extraer el id (entre corchetes)
  local id
  id=$(echo "$eleccion" | sed -E 's/.*\[([^]]+)\].*/\1/')

  for fase_def in "${FASES[@]}"; do
    local fid fnombre ffuncion
    fid=$(echo "$fase_def" | cut -d'|' -f1)
    fnombre=$(echo "$fase_def" | cut -d'|' -f2)
    ffuncion=$(echo "$fase_def" | cut -d'|' -f3)
    if [[ "$fid" == "$id" ]]; then
      _correr_fase "$fid" "$fnombre" "$ffuncion"
      return
    fi
  done

  ui_error "Fase no encontrada: $id"
}

# ----- Main loop -----
mostrar_banner_principal
while true; do
  menu_principal
  echo ""
  if ! ui_confirm "¿Volver al menú principal?"; then
    break
  fi
  mostrar_banner_principal
done

echo ""
ui_info "Sesión del instalador finalizada."
echo ""
