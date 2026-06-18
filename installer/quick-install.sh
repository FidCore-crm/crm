#!/bin/bash
# =====================================================================
# FidCore CRM — Quick installer (curl-bash wrapper)
# =====================================================================
#
# Pensado para correr en una sola línea desde un server fresh:
#
#   curl -fsSL https://raw.githubusercontent.com/FidCore-crm/crm/main/installer/quick-install.sh \
#     | sudo bash
#
# Lo único que hace es:
#   1. Verifica que corre como root (via sudo).
#   2. Instala git si falta.
#   3. Clona el repo del CRM en /tmp/fidcore-installer (descartable).
#   4. Ejecuta installer/install.sh desde ahí, pasando los argumentos recibidos.
#
# Variables de entorno respetadas (pasadas al install.sh):
#   - FIDCORE_BRANCH    rama a clonar (default: main)
#   - FIDCORE_REPO_URL  URL del repo (default: https://github.com/FidCore-crm/crm.git)
#   - Cualquier otra env var del install.sh (NO_WIZARD, SLUG_CLIENTE, etc.).

set -euo pipefail

FIDCORE_REPO_URL="${FIDCORE_REPO_URL:-https://github.com/FidCore-crm/crm.git}"
FIDCORE_BRANCH="${FIDCORE_BRANCH:-main}"
TMP_DIR="${TMP_DIR:-/tmp/fidcore-installer}"

echo
echo "=================================================================="
echo "  FidCore CRM — quick install"
echo "=================================================================="
echo

# 1) Root check
if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: Tenés que correr esto con sudo:" >&2
  echo "  curl -fsSL <url> | sudo bash" >&2
  exit 1
fi

# 2) Instalar git si falta
if ! command -v git >/dev/null 2>&1; then
  echo "▸ Instalando git..."
  apt-get update -qq
  apt-get install -y -qq git ca-certificates
  echo "  ✓ git instalado"
fi

# 3) Limpiar instalación previa abortada
if [ -d "$TMP_DIR" ]; then
  echo "▸ Limpiando $TMP_DIR (instalación previa)"
  rm -rf "$TMP_DIR"
fi

# 4) Clonar el repo
echo "▸ Clonando $FIDCORE_REPO_URL (branch: $FIDCORE_BRANCH)"
git clone --depth 1 --branch "$FIDCORE_BRANCH" "$FIDCORE_REPO_URL" "$TMP_DIR" 2>&1 | sed 's/^/  /'

if [ ! -x "$TMP_DIR/installer/install.sh" ]; then
  echo "ERROR: $TMP_DIR/installer/install.sh no existe o no es ejecutable" >&2
  echo "       Revisá que el repo tenga la carpeta installer/" >&2
  exit 1
fi

# 5) Ejecutar install.sh
echo
echo "▸ Lanzando installer/install.sh..."
echo
exec bash "$TMP_DIR/installer/install.sh" "$@"
