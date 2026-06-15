#!/bin/bash
# instalar-gum.sh — verifica/instala gum (charm.sh) para el wizard interactivo.
# Se sourcea desde install.sh con: . "${SCRIPT_DIR}/lib/instalar-gum.sh"
#
# gum es un toolkit CLI con prompts bonitos (input, choose, confirm, file picker).
# Repo oficial: https://github.com/charmbracelet/gum

instalar_gum_si_falta() {
  if command -v gum >/dev/null 2>&1; then
    ok "gum ya instalado: $(gum --version 2>/dev/null | head -1)"
    return 0
  fi

  paso "Instalando gum desde el repo oficial de Charm"

  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://repo.charm.sh/apt/gpg.key | \
    gpg --dearmor --yes -o /etc/apt/keyrings/charm.gpg 2>>"$LOG_FILE"
  chmod a+r /etc/apt/keyrings/charm.gpg

  echo "deb [signed-by=/etc/apt/keyrings/charm.gpg] https://repo.charm.sh/apt/ * *" \
    > /etc/apt/sources.list.d/charm.list

  apt-get update -qq >>"$LOG_FILE" 2>&1
  apt-get install -y -qq gum >>"$LOG_FILE" 2>&1

  if ! command -v gum >/dev/null 2>&1; then
    abortar "Falló la instalación de gum. Revisá $LOG_FILE"
  fi
  ok "gum instalado: $(gum --version 2>/dev/null | head -1)"
}

# Detecta si la sesión es interactiva (tiene TTY). Si no, el wizard no puede
# correr y hay que usar el modo no-interactivo con env vars + NO_WIZARD=1.
sesion_es_interactiva() {
  [ -t 0 ] && [ -t 1 ]
}
