#!/bin/bash
# Fase 0 — Verificar prerequisitos del sistema.
#
# Esto NO instala nada del CRM. Solo chequea que el ambiente esté listo:
# Ubuntu 24.04+, no estás corriendo como root, tenés internet, y tenés gum.
# Si falta gum, lo instalamos.

fase_prereqs_ejecutar() {
  ui_seccion "Verificación de prerequisitos"

  # 1. No estamos corriendo como root
  if [[ "$EUID" -eq 0 ]]; then
    ui_error "Este instalador NO se corre como root."
    ui_desc "Corré como tu usuario habitual (te va a pedir sudo cuando lo necesite)."
    ui_desc "Ejemplo: bash scripts/instalador/instalar.sh"
    return 1
  fi
  ui_ok "Corriendo como usuario normal: $USER"

  # 2. El usuario puede usar sudo
  if ! sudo -n true 2>/dev/null; then
    ui_info "El instalador necesita sudo para muchos pasos. Te pide la password una sola vez:"
    if ! sudo -v; then
      ui_error "No se pudo obtener sudo. Verificá que tu usuario esté en el grupo sudo."
      return 1
    fi
  fi
  # Mantener vivo el sudo cache en background mientras corre el instalador
  ( while true; do sudo -n true; sleep 60; kill -0 "$$" 2>/dev/null || exit; done ) 2>/dev/null &
  ui_ok "Sudo disponible"

  # 3. Sistema operativo
  if [[ ! -f /etc/os-release ]]; then
    ui_error "No se puede detectar la versión del SO (falta /etc/os-release)."
    return 1
  fi
  # shellcheck disable=SC1091
  source /etc/os-release
  if [[ "$ID" != "ubuntu" ]]; then
    ui_warn "Detecté $PRETTY_NAME. El instalador está probado en Ubuntu Server 24.04 LTS."
    if ! ui_confirm "¿Querés continuar igual?"; then
      return 1
    fi
  else
    local version_mayor="${VERSION_ID%%.*}"
    if [[ "$version_mayor" -lt 22 ]]; then
      ui_error "Ubuntu $VERSION_ID es demasiado viejo. Necesitás 22.04 o superior (recomendado: 24.04)."
      return 1
    fi
    ui_ok "Sistema: $PRETTY_NAME"
  fi

  # 4. Arquitectura
  local arch
  arch=$(uname -m)
  if [[ "$arch" != "x86_64" ]] && [[ "$arch" != "aarch64" ]]; then
    ui_error "Arquitectura $arch no soportada. Necesitás x86_64 o aarch64."
    return 1
  fi
  ui_ok "Arquitectura: $arch"

  # 5. Internet
  if ! curl -sI --max-time 5 https://github.com > /dev/null 2>&1; then
    ui_error "No hay conexión a internet (no se pudo alcanzar github.com)."
    ui_desc "Verificá la red y volvé a intentar."
    return 1
  fi
  ui_ok "Internet OK"

  # 6. gum instalado
  if ! command -v gum > /dev/null 2>&1; then
    ui_warn "gum no está instalado. Lo instalo ahora..."
    if ! _instalar_gum; then
      ui_error "No se pudo instalar gum."
      return 1
    fi
  fi
  ui_ok "gum disponible ($(gum --version 2>&1 | head -1))"

  # 7. Herramientas básicas
  local faltantes=()
  for cmd in curl git openssl jq tar gzip; do
    if ! command -v "$cmd" > /dev/null 2>&1; then
      faltantes+=("$cmd")
    fi
  done
  if [[ ${#faltantes[@]} -gt 0 ]]; then
    ui_warn "Faltan herramientas: ${faltantes[*]}. Las instalo ahora..."
    if ! sudo apt-get install -y "${faltantes[@]}" > /dev/null 2>&1; then
      ui_error "No se pudieron instalar: ${faltantes[*]}"
      return 1
    fi
  fi
  ui_ok "Herramientas básicas: curl, git, openssl, jq, tar, gzip"

  # 8. Puertos requeridos disponibles
  # Puertos que el stack del CRM necesita escuchar en el host:
  #   3000  → Next.js / CRM
  #   8001  → Kong (API gateway de Supabase) + Studio
  #   54321 → Supabase API interna (opcional pero usual)
  #   9443  → Portainer
  if ! _verificar_puertos_disponibles 3000 8001 9443; then
    return 1
  fi

  echo ""
  ui_ok "Sistema listo para la instalación."
  fase_completar "prereqs"
  return 0
}

# Chequea con `ss` si algún puerto está siendo escuchado. Lista los procesos
# que lo tienen ocupado para que el operador pueda matarlos o decidir abortar.
_verificar_puertos_disponibles() {
  local ocupados=()
  local detalles=()
  for puerto in "$@"; do
    if ss -tln 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${puerto}\$"; then
      ocupados+=("$puerto")
      # Procesos que lo tienen abierto (best effort, requiere sudo)
      local proc
      proc=$(sudo ss -tlnp 2>/dev/null | awk -v p=":${puerto}" '$4 ~ p {print $NF}' | head -1)
      detalles+=("$puerto → ${proc:-desconocido}")
    fi
  done

  if [[ ${#ocupados[@]} -eq 0 ]]; then
    ui_ok "Puertos requeridos libres: $*"
    return 0
  fi

  ui_warn "Hay puertos ocupados:"
  for d in "${detalles[@]}"; do
    ui_desc "  • $d"
  done
  ui_desc "Si son del CRM anterior podés seguir; si son de otra cosa, liberalos primero."
  if ! ui_confirm "¿Continuar igual?"; then
    return 1
  fi
  return 0
}

_instalar_gum() {
  # Repo oficial de Charm (https://github.com/charmbracelet/gum)
  sudo mkdir -p /etc/apt/keyrings
  curl -fsSL https://repo.charm.sh/apt/gpg.key 2>/dev/null | \
    sudo gpg --dearmor -o /etc/apt/keyrings/charm.gpg 2>/dev/null
  echo "deb [signed-by=/etc/apt/keyrings/charm.gpg] https://repo.charm.sh/apt/ * *" | \
    sudo tee /etc/apt/sources.list.d/charm.list > /dev/null
  sudo apt-get update -qq > /dev/null 2>&1
  sudo apt-get install -y gum > /dev/null 2>&1
}
