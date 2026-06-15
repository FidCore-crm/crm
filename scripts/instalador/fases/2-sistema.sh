#!/bin/bash
# Fase 2 — Configuración del sistema operativo.
#
# Aplica actualizaciones de paquetes, fija la zona horaria a Argentina y
# habilita unattended-upgrades para los parches de seguridad. NO instala Docker
# todavía (eso va en la fase 3).

fase_sistema_ejecutar() {
  ui_seccion "Configuración del sistema"

  # 1. apt update + upgrade
  ui_info "Actualizando paquetes del sistema (puede tardar varios minutos)..."
  if ! sudo apt-get update -qq 2>&1 | tail -5; then
    ui_error "Falló apt-get update."
    return 1
  fi

  if ! ui_spin "Aplicando upgrades..." -- sudo apt-get upgrade -y -qq; then
    ui_warn "Algunos paquetes no se pudieron actualizar. Reviso a continuación."
    sudo apt-get upgrade -y 2>&1 | tail -20
    if ! ui_confirm "¿Continuar igual?"; then
      return 1
    fi
  fi
  ui_ok "Paquetes actualizados"

  # 2. Zona horaria
  local tz_actual
  tz_actual=$(timedatectl show -p Timezone --value 2>/dev/null || echo "desconocida")
  if [[ "$tz_actual" != "America/Argentina/Buenos_Aires" ]]; then
    ui_info "Cambiando zona horaria a Argentina/Buenos Aires (actual: $tz_actual)..."
    sudo timedatectl set-timezone America/Argentina/Buenos_Aires
  fi
  ui_ok "Zona horaria: $(timedatectl show -p Timezone --value)"

  # 3. unattended-upgrades (parches de seguridad automáticos)
  if ! dpkg -l unattended-upgrades 2>/dev/null | grep -q "^ii"; then
    ui_info "Instalando unattended-upgrades..."
    if ! sudo apt-get install -y unattended-upgrades > /dev/null 2>&1; then
      ui_error "No se pudo instalar unattended-upgrades."
      return 1
    fi
  fi

  # Habilitar (modo no-interactivo, equivalente al "Yes" del dpkg-reconfigure)
  echo 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";' | sudo tee /etc/apt/apt.conf.d/20auto-upgrades > /dev/null

  # Blacklistear paquetes que NO queremos que se reinicien de madrugada sin
  # supervisión: Docker (un restart inesperado mata todos los containers del
  # CRM) y kernel (requiere reboot manual planeado).
  sudo tee /etc/apt/apt.conf.d/51unattended-upgrades-fidcore > /dev/null <<'EOF'
// Excluciones agregadas por el instalador de FidCore CRM.
// Estos paquetes requieren reinicio del servicio/sistema y deben actualizarse
// en una ventana planeada, no a las 6 AM automáticamente.
Unattended-Upgrade::Package-Blacklist {
    "docker-ce";
    "docker-ce-cli";
    "containerd.io";
    "docker-buildx-plugin";
    "docker-compose-plugin";
    "linux-image";
    "linux-headers";
    "linux-generic";
};
EOF

  ui_ok "unattended-upgrades habilitado (con blacklist de docker y kernel)"

  # 4. Verificar reloj sincronizado (NTP)
  if timedatectl show -p NTPSynchronized --value 2>/dev/null | grep -q "yes"; then
    ui_ok "Reloj sincronizado con NTP"
  else
    ui_warn "El reloj no está sincronizado con NTP. Esto puede romper certificados TLS."
    sudo timedatectl set-ntp true 2>/dev/null || true
  fi

  fase_completar "sistema"
  return 0
}
