#!/bin/bash
# Fase 3 — Instalación de Docker Engine + Docker Compose plugin.
#
# Usa el repo oficial de Docker (no el de Ubuntu, que suele venir con versiones
# viejas). Agrega al usuario actual al grupo docker para correr sin sudo.

fase_docker_ejecutar() {
  ui_seccion "Docker Engine + Compose"

  # 1. Si ya está instalado, skip
  if command -v docker > /dev/null 2>&1 && docker compose version > /dev/null 2>&1; then
    ui_ok "Docker ya instalado ($(docker --version | head -1))"
    ui_ok "Docker Compose ya instalado ($(docker compose version | head -1))"
    if groups "$USER" | grep -qw docker; then
      ui_ok "Usuario $USER ya está en el grupo docker"
      fase_completar "docker"
      return 0
    fi
  fi

  # 2. Repo oficial de Docker
  ui_info "Agregando el repo oficial de Docker..."
  sudo install -m 0755 -d /etc/apt/keyrings

  if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
    if ! curl -fsSL https://download.docker.com/linux/ubuntu/gpg 2>/dev/null | \
        sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null; then
      ui_error "No se pudo descargar la GPG key de Docker."
      return 1
    fi
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
  fi

  local codename
  codename=$(. /etc/os-release && echo "$VERSION_CODENAME")
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $codename stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

  if ! ui_spin "Actualizando índice de paquetes..." -- sudo apt-get update -qq; then
    ui_error "Falló apt-get update tras agregar el repo de Docker."
    return 1
  fi

  # 3. Instalar Docker + Compose
  if ! ui_spin "Instalando Docker Engine + Compose..." -- \
      sudo apt-get install -y -qq \
        docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin; then
    ui_error "Falló la instalación de Docker."
    return 1
  fi

  ui_ok "Docker instalado: $(docker --version | head -1)"
  ui_ok "Compose instalado: $(docker compose version | head -1)"

  # 4. Agregar usuario al grupo docker
  if ! groups "$USER" | grep -qw docker; then
    sudo usermod -aG docker "$USER"
    ui_ok "Usuario $USER agregado al grupo docker"
    ui_warn "OJO: tu shell actual NO tiene el grupo nuevo todavía."
    ui_desc "Las próximas fases corren docker con sudo para no fallar. Tras terminar"
    ui_desc "la instalación, cerrá la sesión y volvé a entrar para usar docker sin sudo."
  fi

  # 5. Verificar que el daemon arrancó
  if ! sudo systemctl is-active --quiet docker; then
    ui_info "Arrancando docker.service..."
    sudo systemctl enable --now docker
  fi
  ui_ok "docker.service activo"

  fase_completar "docker"
  return 0
}

# Helper: corre docker como sudo si el usuario no tiene el grupo activo todavía.
# Las fases posteriores deberían usar `dckr` en lugar de `docker` directo.
dckr() {
  if groups | grep -qw docker; then
    docker "$@"
  else
    sudo docker "$@"
  fi
}

dckr_compose() {
  if groups | grep -qw docker; then
    docker compose "$@"
  else
    sudo docker compose "$@"
  fi
}
