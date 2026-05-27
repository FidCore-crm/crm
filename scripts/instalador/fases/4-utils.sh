#!/bin/bash
# Fase 4 — Utilidades de operación.
#
# Instala Portainer (gestión visual de containers, solo en localhost) y deja
# Tailscale instalado pero apagado (el cliente lo prende cuando necesita soporte).

fase_utils_ejecutar() {
  ui_seccion "Utilidades de operación"

  # ============ Portainer ============
  if dckr ps --filter "name=portainer" --format '{{.Names}}' 2>/dev/null | grep -q "^portainer$"; then
    ui_ok "Portainer ya está corriendo"
  else
    ui_info "Levantando Portainer en localhost:9443..."

    # Volume si no existe
    if ! dckr volume inspect portainer_data > /dev/null 2>&1; then
      dckr volume create portainer_data > /dev/null
    fi

    if ! dckr run -d \
        --name portainer \
        --restart=always \
        -p 127.0.0.1:9443:9443 \
        -v /var/run/docker.sock:/var/run/docker.sock \
        -v portainer_data:/data \
        portainer/portainer-ce:latest > /dev/null 2>&1; then
      ui_warn "No se pudo levantar Portainer (no es crítico, podés instalarlo después)."
    else
      ui_ok "Portainer corriendo en https://localhost:9443"
      ui_desc "Solo accesible vía SSH tunnel desde tu máquina (no expuesto a internet/LAN)."
    fi
  fi

  # ============ Tailscale ============
  echo ""
  ui_info "Tailscale: queda instalado pero apagado. El cliente lo prende solo cuando te necesita."
  echo ""

  if command -v tailscale > /dev/null 2>&1; then
    ui_ok "Tailscale ya instalado ($(tailscale version | head -1))"
  else
    if ! ui_spin "Instalando Tailscale..." -- bash -c "curl -fsSL https://tailscale.com/install.sh | sh"; then
      ui_warn "No se pudo instalar Tailscale (no es crítico para que el CRM funcione)."
      ui_desc "Lo podés instalar después con: curl -fsSL https://tailscale.com/install.sh | sh"
      fase_completar "utils"
      return 0
    fi
    ui_ok "Tailscale instalado"
  fi

  # Preguntar si tiene auth key para registrarlo ya
  if ui_confirm "¿Tenés un auth key de Tailscale para registrar este server ahora?"; then
    local tskey
    tskey=$(ui_input "Auth key (empieza con tskey-...):" "tskey-auth-XXXX")
    if [[ -n "$tskey" ]]; then
      if sudo tailscale up --auth-key="$tskey" --advertise-tags=tag:pulzar-prod 2>&1 | tail -5; then
        local ts_ip
        ts_ip=$(sudo tailscale ip -4 | head -1)
        ui_ok "Tailscale registrado. IP: $ts_ip"
        estado_set TAILSCALE_IP "$ts_ip"
      else
        ui_warn "El registro de Tailscale falló. Lo podés hacer después manualmente."
      fi
    fi
  else
    ui_info "Saltando el registro de Tailscale. Cuando quieras: sudo tailscale up --auth-key=tskey-XXXX"
  fi

  # Apagar tailscale (el cliente lo enciende cuando necesita soporte)
  if sudo systemctl is-active --quiet tailscaled; then
    sudo systemctl disable --now tailscaled > /dev/null 2>&1 || true
    ui_ok "Tailscale apagado (queda instalado, el cliente lo prende manualmente)"
  fi

  fase_completar "utils"
  return 0
}
