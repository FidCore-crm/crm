#!/bin/bash
# =====================================================================
# FidCore CRM — Instalador automático
# =====================================================================
#
# Automatiza el manual INSTALACION.md.
#
# MODOS DE USO:
#
#   1) Interactivo (recomendado) — wizard con gum pregunta lo que necesita:
#      sudo bash install.sh
#
#   2) No-interactivo (CI/scripts) — todas las vars por env, salta el wizard:
#      sudo NO_WIZARD=1 \
#        SLUG_CLIENTE=juanperez \
#        MODO_INSTALACION=APPLIANCE \
#        CRM_REPO_URL="https://USER:PAT@github.com/FidCore-crm/crm.git" \
#        bash install.sh
#
#   3) Mixto — algunas vars por env, el wizard pregunta el resto:
#      sudo SLUG_CLIENTE=juanperez bash install.sh
#
# ETAPAS:
#   1. Preflight (sudo, OS, conectividad).
#   2. Dependencias mínimas (curl, gpg, gum).
#   3. Wizard interactivo (o usa env vars si NO_WIZARD=1).
#   4. Validación de configuración.
#   5. Resto de dependencias del host (git, python3, openssl, jq).
#   6. Docker Engine + Compose.
#   7. Generación de secrets.
#   8. Clonar y configurar Supabase + patch kong.yml.
#   9. Levantar Supabase.
#  10. Clonar el CRM + generar .env.docker + permisos.
#  11. Migraciones SQL.
#  12. Build + arranque del CRM.
#  13. Activar auth hook (reiniciar container auth).
#  14. Activar auth hook (reiniciar container auth).
#  15. Levantar Cloudflare Tunnel (si TUNNEL_TOKEN está seteado).
#  16. APPLIANCE-only: sudoers + sistema-trigger.sh + cron del host.
#  17. Cron del host para actualizaciones automáticas (ambos modos).
#  18. Tailscale (APPLIANCE + opcional, solo si TAILSCALE_AUTHKEY está).
#  19. Smoke test final.
#  20. Resumen con hand-off al PAS.

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# shellcheck source=lib/output.sh
. "${SCRIPT_DIR}/lib/output.sh"
# shellcheck source=lib/instalar-gum.sh
. "${SCRIPT_DIR}/lib/instalar-gum.sh"
# shellcheck source=lib/wizard.sh
. "${SCRIPT_DIR}/lib/wizard.sh"

# =====================================================================
# Defaults configurables via env vars
# =====================================================================

# Slug del cliente (obligatorio) — ej: juanperez. Solo minúsculas, números, guiones.
SLUG_CLIENTE="${SLUG_CLIENTE:-}"

# Modo de instalación: APPLIANCE (mini PC físico) o VPS.
MODO_INSTALACION="${MODO_INSTALACION:-APPLIANCE}"

# Dominio base. El subdominio final será <slug>.<dominio>.
DOMINIO_BASE="${DOMINIO_BASE:-fidcore.com.ar}"

# Carpetas de instalación
INSTALACION_DIR_SUPABASE="${INSTALACION_DIR_SUPABASE:-/opt/supabase}"
INSTALACION_DIR_CRM="${INSTALACION_DIR_CRM:-/opt/crm-fidcore}"
BACKUPS_DIR="${BACKUPS_DIR:-/var/backups/crm-seguros}"

# Repo del CRM. Por default usa el repo público (mantenido por FidCore en la
# organización FidCore-crm de GitHub). Sin PAT necesario.
CRM_REPO_URL="${CRM_REPO_URL:-https://github.com/FidCore-crm/crm.git}"
CRM_REPO_BRANCH="${CRM_REPO_BRANCH:-main}"

# Repo de Supabase (oficial)
SUPABASE_REPO_URL="${SUPABASE_REPO_URL:-https://github.com/supabase/supabase.git}"

# Puerto público de Kong en LAN (8001 es lo que el CRM espera)
KONG_HTTP_PORT="${KONG_HTTP_PORT:-8001}"

# Usuario que va a ser dueño de las carpetas y correr Docker.
# Si no se pasa, usa $SUDO_USER (el usuario que invocó sudo) o $USER.
USUARIO_INSTALACION="${USUARIO_INSTALACION:-${SUDO_USER:-$USER}}"

# Archivo de log (se crea en /tmp si no se pasa)
LOG_FILE="${LOG_FILE:-/tmp/fidcore-install-$(date -u +%Y%m%d-%H%M%S).log}"
export LOG_FILE

# Variables derivadas (se completan en validar_config)
URL_PUBLICA=""

# =====================================================================
# Pre-flight
# =====================================================================

fase_preflight_minimo() {
  fase "Pre-flight: validaciones del sistema"

  paso "Validando que se corre con sudo"
  if [ "$(id -u)" -ne 0 ]; then
    abortar "Tenés que correr con sudo: sudo bash install.sh"
  fi
  ok "Corriendo como root (via sudo)"

  paso "Validando usuario destinatario"
  if [ "$USUARIO_INSTALACION" = "root" ] || [ -z "$USUARIO_INSTALACION" ]; then
    abortar "USUARIO_INSTALACION es root o vacío. Corré con sudo desde un usuario regular o pasá USUARIO_INSTALACION=<user>."
  fi
  if ! id "$USUARIO_INSTALACION" >/dev/null 2>&1; then
    abortar "El usuario '$USUARIO_INSTALACION' no existe en el sistema"
  fi
  ok "Usuario destinatario: $USUARIO_INSTALACION"

  paso "Validando OS"
  if ! grep -q "^ID=ubuntu" /etc/os-release 2>/dev/null; then
    abortar "Este instalador soporta solo Ubuntu Server (detectado: $(. /etc/os-release; echo $PRETTY_NAME))"
  fi
  local version
  version="$(. /etc/os-release && echo "$VERSION_ID")"
  case "$version" in
    22.04|24.04)
      ok "Ubuntu $version detectado"
      ;;
    *)
      warn "Ubuntu $version no está testeado oficialmente. Continúo igual."
      ;;
  esac

  paso "Validando arquitectura"
  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) ok "Arquitectura $arch soportada" ;;
    aarch64|arm64) ok "Arquitectura $arch soportada" ;;
    *) abortar "Arquitectura no soportada: $arch (esperado x86_64 o arm64)" ;;
  esac

  paso "Validando conectividad"
  if ! curl -sSf -o /dev/null --max-time 10 https://github.com 2>/dev/null; then
    # curl puede no estar instalado todavía — chequear ese caso
    if ! command -v curl >/dev/null 2>&1; then
      info "curl no instalado, lo instalo en la próxima fase"
    else
      abortar "Sin conectividad a github.com. Verificá la red."
    fi
  else
    ok "Conectividad OK"
  fi

  paso "Log de instalación"
  info "Se guarda en: $LOG_FILE"
  : > "$LOG_FILE"
  _log_a_archivo "FidCore Installer - Inicio: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

fase_dependencias_iniciales() {
  fase "Dependencias mínimas para el wizard"

  paso "apt update + paquetes base (curl, gpg, ca-certificates)"
  apt-get update -qq >>"$LOG_FILE" 2>&1
  apt-get install -y -qq curl ca-certificates gnupg >>"$LOG_FILE" 2>&1
  ok "Paquetes base instalados"

  instalar_gum_si_falta
}

fase_wizard() {
  # Si modo no-interactivo, salta el wizard pero igual valida las vars en
  # fase_validar_config. Si interactivo, lanza el wizard de gum.
  fase "Configuración del cliente"
  correr_wizard
}

fase_validar_config() {
  fase "Validación de la configuración"

  paso "Validando SLUG_CLIENTE"
  if [ -z "${SLUG_CLIENTE:-}" ]; then
    abortar "Falta SLUG_CLIENTE. Corré el wizard o seteá la env var."
  fi
  if ! [[ "$SLUG_CLIENTE" =~ ^[a-z0-9-]+$ ]]; then
    abortar "SLUG_CLIENTE inválido: '$SLUG_CLIENTE'. Solo minúsculas, números y guiones."
  fi
  ok "Slug: $SLUG_CLIENTE"

  paso "Validando MODO_INSTALACION"
  if [ "$MODO_INSTALACION" != "APPLIANCE" ] && [ "$MODO_INSTALACION" != "VPS" ]; then
    abortar "MODO_INSTALACION inválido: '$MODO_INSTALACION'. Esperado APPLIANCE o VPS."
  fi
  ok "Modo: $MODO_INSTALACION"

  paso "Validando CRM_REPO_URL"
  if [ -z "${CRM_REPO_URL:-}" ]; then
    abortar "Falta CRM_REPO_URL. Corré el wizard o seteá la env var."
  fi
  ok "Repo CRM: $(echo "$CRM_REPO_URL" | sed -E 's#https?://[^@]+@#https://***@#')"

  URL_PUBLICA="https://${SLUG_CLIENTE}.${DOMINIO_BASE}"
  ok "URL pública: $URL_PUBLICA"

  _log_a_archivo "Slug: $SLUG_CLIENTE | Modo: $MODO_INSTALACION | Usuario: $USUARIO_INSTALACION"
}

# =====================================================================
# Dependencias del host
# =====================================================================

fase_dependencias_host() {
  fase "Resto de dependencias del host"

  paso "Instalando git, python3, openssl, jq"
  apt-get install -y -qq git python3 openssl jq >>"$LOG_FILE" 2>&1
  for p in git openssl jq; do
    command -v "$p" >/dev/null 2>&1 || abortar "Falló la instalación de '$p'"
  done
  command -v python3 >/dev/null 2>&1 || abortar "python3 no disponible después del install"
  ok "git, python3, openssl, jq listos"
}

# =====================================================================
# Docker
# =====================================================================

fase_docker() {
  fase "Docker Engine + Docker Compose"

  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    ok "Docker ya instalado: $(docker --version)"
    ok "Compose ya instalado: $(docker compose version)"
  else
    paso "Configurando repo oficial de Docker"
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
      gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    local codename
    codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu ${codename} stable" \
      > /etc/apt/sources.list.d/docker.list
    ok "Repo de Docker configurado"

    paso "Instalando Docker Engine + Compose"
    apt-get update -qq
    apt-get install -y -qq \
      docker-ce docker-ce-cli containerd.io \
      docker-buildx-plugin docker-compose-plugin >/dev/null
    ok "Docker $(docker --version)"
    ok "Compose $(docker compose version)"
  fi

  paso "Agregando $USUARIO_INSTALACION al grupo docker"
  if id -nG "$USUARIO_INSTALACION" | tr ' ' '\n' | grep -qx docker; then
    ok "Ya está en el grupo docker"
  else
    usermod -aG docker "$USUARIO_INSTALACION"
    ok "Agregado (necesita reloguear o usar 'newgrp docker' para aplicar)"
  fi
}

# =====================================================================
# Generar secrets
# =====================================================================

fase_generar_secrets() {
  fase "Generación de secrets"

  paso "Generando POSTGRES_PASSWORD (24 bytes hex)"
  POSTGRES_PASSWORD="$(openssl rand -hex 24)"
  ok "POSTGRES_PASSWORD generado"

  paso "Generando JWT_SECRET (base64 48 bytes)"
  JWT_SECRET="$(openssl rand -base64 48 | tr -d '\n=' | tr '+/' '-_' | cut -c1-64)"
  ok "JWT_SECRET generado (${#JWT_SECRET} chars)"

  paso "Generando ANON_KEY y SERVICE_ROLE_KEY firmados con HS256"
  ANON_KEY="$(python3 "${SCRIPT_DIR}/lib/generar-jwt.py" "$JWT_SECRET" anon)"
  SERVICE_ROLE_KEY="$(python3 "${SCRIPT_DIR}/lib/generar-jwt.py" "$JWT_SECRET" service_role)"
  [ -n "$ANON_KEY" ] || abortar "Falló la generación de ANON_KEY"
  [ -n "$SERVICE_ROLE_KEY" ] || abortar "Falló la generación de SERVICE_ROLE_KEY"
  ok "ANON_KEY y SERVICE_ROLE_KEY generados"

  paso "Generando ENCRYPTION_KEY (32 bytes hex)"
  ENCRYPTION_KEY="$(openssl rand -hex 32)"
  ok "ENCRYPTION_KEY generado"

  paso "Generando CRON_SECRET (32 bytes hex)"
  CRON_SECRET="$(openssl rand -hex 32)"
  ok "CRON_SECRET generado"

  paso "Generando DASHBOARD_PASSWORD (16 bytes hex)"
  DASHBOARD_PASSWORD="$(openssl rand -hex 16)"
  DASHBOARD_USERNAME="fidcore"
  ok "Credenciales del Supabase Studio: $DASHBOARD_USERNAME / $DASHBOARD_PASSWORD"
}

# =====================================================================
# Supabase
# =====================================================================

fase_clonar_supabase() {
  fase "Clonado y configuración de Supabase"

  paso "Clonando repo en $INSTALACION_DIR_SUPABASE"
  if [ -d "$INSTALACION_DIR_SUPABASE" ]; then
    warn "$INSTALACION_DIR_SUPABASE ya existe, salteando clonado"
  else
    mkdir -p "$(dirname "$INSTALACION_DIR_SUPABASE")"
    git clone --depth 1 "$SUPABASE_REPO_URL" "$INSTALACION_DIR_SUPABASE" 2>>"$LOG_FILE"
    chown -R "$USUARIO_INSTALACION:$USUARIO_INSTALACION" "$INSTALACION_DIR_SUPABASE"
    ok "Supabase clonado"
  fi

  paso "Generando .env de Supabase"
  local env_path="$INSTALACION_DIR_SUPABASE/docker/.env"
  if [ -f "$env_path" ]; then
    warn ".env existente, lo respaldo a .env.bak antes de pisarlo"
    cp -f "$env_path" "${env_path}.bak"
  fi
  cp "$INSTALACION_DIR_SUPABASE/docker/.env.example" "$env_path"

  _set_env_var() {
    local key="$1" value="$2" file="$3"
    if grep -q "^${key}=" "$file"; then
      # Usar # como delimitador porque los valores pueden contener /
      sed -i "s#^${key}=.*#${key}=${value}#" "$file"
    else
      echo "${key}=${value}" >> "$file"
    fi
  }

  _set_env_var POSTGRES_PASSWORD "$POSTGRES_PASSWORD" "$env_path"
  _set_env_var JWT_SECRET "$JWT_SECRET" "$env_path"
  _set_env_var ANON_KEY "$ANON_KEY" "$env_path"
  _set_env_var SERVICE_ROLE_KEY "$SERVICE_ROLE_KEY" "$env_path"
  _set_env_var DASHBOARD_USERNAME "$DASHBOARD_USERNAME" "$env_path"
  _set_env_var DASHBOARD_PASSWORD "$DASHBOARD_PASSWORD" "$env_path"
  _set_env_var KONG_HTTP_PORT "$KONG_HTTP_PORT" "$env_path"
  _set_env_var API_EXTERNAL_URL "${URL_PUBLICA}/supabase" "$env_path"
  _set_env_var SITE_URL "$URL_PUBLICA" "$env_path"
  _set_env_var SUPABASE_PUBLIC_URL "${URL_PUBLICA}/supabase" "$env_path"
  ok ".env configurado"

  paso "Creando docker-compose.override.yml para el auth hook"
  local override_path="$INSTALACION_DIR_SUPABASE/docker/docker-compose.override.yml"
  cat > "$override_path" <<'EOF'
services:
  auth:
    environment:
      GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED: "true"
      GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI: "pg-functions://postgres/public/custom_access_token_hook"
EOF
  chown "$USUARIO_INSTALACION:$USUARIO_INSTALACION" "$override_path"
  ok "Override del auth hook listo"
}

# =====================================================================
# Patch del kong.yml
# =====================================================================

fase_patch_kong() {
  fase "Patch de kong.yml (prefijo /supabase/*)"

  local kong_path="$INSTALACION_DIR_SUPABASE/docker/volumes/api/kong.yml"
  if [ ! -f "$kong_path" ]; then
    abortar "No encontré $kong_path — Supabase no se clonó correctamente"
  fi

  # Respaldo
  cp -f "$kong_path" "${kong_path}.bak"
  ok "Backup en ${kong_path}.bak"

  # Patcheamos con Python — es más confiable que sed para YAML.
  # Para cada service en la lista, si ya tiene un path con prefijo /supabase, lo dejamos.
  # Si no, agregamos un segundo path al array de `paths`.
  python3 - "$kong_path" <<'PYEOF'
import sys
import re

path = sys.argv[1]
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Mapeo service-name → path a agregar
services_paths = {
    "auth-v1-open": "/supabase/auth/v1/verify",
    "auth-v1-open-callback": "/supabase/auth/v1/callback",
    "auth-v1-open-authorize": "/supabase/auth/v1/authorize",
    "auth-v1": "/supabase/auth/v1/",
    "rest-v1": "/supabase/rest/v1/",
    "graphql-v1": "/supabase/graphql/v1",
    "realtime-v1-ws": "/supabase/realtime/v1/",
    "realtime-v1-rest": "/supabase/realtime/v1/api",
    "storage-v1": "/supabase/storage/v1/",
    "functions-v1": "/supabase/functions/v1/",
}

cambios = 0
for service, supabase_path in services_paths.items():
    # Buscar bloque de service por "  - name: <service>" hasta el siguiente "  - name:" o EOF
    # Regex para detectar si ya tiene el path /supabase/...
    if supabase_path in content:
        continue

    # Pattern más simple: buscar el bloque "paths:" del service, agregar línea con el path.
    # Asumimos que kong.yml tiene estructura YAML con:
    #   - name: <service>
    #     ...
    #     routes:
    #       - name: ...
    #         strip_path: true
    #         paths:
    #           - /algo
    # Vamos a usar regex multilínea para encontrar el path /algo del service específico
    # y agregar después una línea más.

    # Capturamos el bloque del service
    service_re = re.compile(
        r"(  - name: " + re.escape(service) + r"\n(?:    .*\n)+?)",
        re.MULTILINE
    )
    m = service_re.search(content)
    if not m:
        continue
    bloque = m.group(1)
    # Dentro del bloque, encontrar la primera línea "          - /..."
    path_line_re = re.compile(r"(          - /[^\n]+\n)")
    pm = path_line_re.search(bloque)
    if not pm:
        continue
    bloque_nuevo = bloque[:pm.end()] + "          - " + supabase_path + "\n" + bloque[pm.end():]
    content = content[:m.start()] + bloque_nuevo + content[m.end():]
    cambios += 1

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print(f"OK_PATCH:{cambios}")
PYEOF

  ok "Paths con prefijo /supabase agregados a kong.yml"
}

# =====================================================================
# Levantar Supabase
# =====================================================================

fase_levantar_supabase() {
  fase "Levantando Supabase"

  paso "Descargando imágenes (puede tardar varios minutos)"
  (cd "$INSTALACION_DIR_SUPABASE/docker" && docker compose pull >>"$LOG_FILE" 2>&1)
  ok "Imágenes descargadas"

  paso "docker compose up -d"
  (cd "$INSTALACION_DIR_SUPABASE/docker" && docker compose up -d >>"$LOG_FILE" 2>&1)
  ok "Containers iniciados"

  paso "Esperando que Supabase esté listo (max 3 min)"
  local intentos=0
  local max_intentos=36
  while [ $intentos -lt $max_intentos ]; do
    if curl -sf -o /dev/null "http://localhost:${KONG_HTTP_PORT}/rest/v1/" \
         -H "apikey: $ANON_KEY" 2>/dev/null; then
      ok "Supabase respondiendo en :${KONG_HTTP_PORT}"
      return 0
    fi
    sleep 5
    intentos=$((intentos + 1))
    [ $((intentos % 6)) -eq 0 ] && info "Esperando... ($((intentos * 5))s)"
  done
  abortar "Supabase no respondió en 3 minutos. Revisá: docker logs en $INSTALACION_DIR_SUPABASE/docker"
}

# =====================================================================
# CRM
# =====================================================================

fase_clonar_crm() {
  fase "Clonado y configuración del CRM"

  paso "Clonando repo en $INSTALACION_DIR_CRM"
  if [ -d "$INSTALACION_DIR_CRM/.git" ]; then
    warn "$INSTALACION_DIR_CRM ya existe con repo git, salteando clonado"
  else
    mkdir -p "$(dirname "$INSTALACION_DIR_CRM")"
    git clone --branch "$CRM_REPO_BRANCH" --depth 50 "$CRM_REPO_URL" "$INSTALACION_DIR_CRM" 2>>"$LOG_FILE"
    chown -R "$USUARIO_INSTALACION:$USUARIO_INSTALACION" "$INSTALACION_DIR_CRM"
    ok "CRM clonado (branch $CRM_REPO_BRANCH)"
  fi

  paso "Generando .env.docker"
  local env_path="$INSTALACION_DIR_CRM/.env.docker"
  local env_example="$INSTALACION_DIR_CRM/.env.docker.example"
  if [ -f "$env_path" ]; then
    warn ".env.docker existente, lo respaldo a .env.docker.bak"
    cp -f "$env_path" "${env_path}.bak"
  fi
  if [ -f "$env_example" ]; then
    cp "$env_example" "$env_path"
  else
    : > "$env_path"
  fi

  # Reusar el helper
  _set_env_var() {
    local key="$1" value="$2" file="$3"
    if grep -q "^${key}=" "$file"; then
      sed -i "s#^${key}=.*#${key}=${value}#" "$file"
    else
      echo "${key}=${value}" >> "$file"
    fi
  }

  _set_env_var NEXT_PUBLIC_SUPABASE_URL "${URL_PUBLICA}/supabase" "$env_path"
  _set_env_var NEXT_PUBLIC_SUPABASE_PORT_LOCAL "$KONG_HTTP_PORT" "$env_path"
  _set_env_var NEXT_PUBLIC_SUPABASE_ANON_KEY "$ANON_KEY" "$env_path"
  _set_env_var SUPABASE_SERVICE_ROLE_KEY "$SERVICE_ROLE_KEY" "$env_path"
  _set_env_var SUPABASE_JWT_SECRET "$JWT_SECRET" "$env_path"
  _set_env_var SUPABASE_INTERNAL_URL "http://supabase-kong:8000" "$env_path"
  _set_env_var POSTGRES_HOST "supabase-db" "$env_path"
  _set_env_var POSTGRES_PORT "5432" "$env_path"
  _set_env_var POSTGRES_USER "supabase_admin" "$env_path"
  _set_env_var POSTGRES_DB "postgres" "$env_path"
  _set_env_var POSTGRES_PASSWORD "$POSTGRES_PASSWORD" "$env_path"
  _set_env_var ENCRYPTION_KEY "$ENCRYPTION_KEY" "$env_path"
  _set_env_var CRON_SECRET "$CRON_SECRET" "$env_path"
  _set_env_var URL_CRM_PUBLICA "$URL_PUBLICA" "$env_path"
  _set_env_var URL_PORTAL_CLIENTE "$URL_PUBLICA" "$env_path"
  _set_env_var URL_FORMULARIO_PUBLICO "${URL_PUBLICA}/denuncia" "$env_path"
  _set_env_var NEXT_PUBLIC_FIDCORE_MODO "$MODO_INSTALACION" "$env_path"
  _set_env_var SLUG_CLIENTE "$SLUG_CLIENTE" "$env_path"

  # CF Tunnel queda vacío — se configura en Fase 2 con el wizard
  if ! grep -q "^TUNNEL_TOKEN=" "$env_path"; then
    echo "TUNNEL_TOKEN=" >> "$env_path"
  fi

  chown "$USUARIO_INSTALACION:$USUARIO_INSTALACION" "$env_path"
  chmod 0600 "$env_path"
  ok ".env.docker generado (modo $MODO_INSTALACION)"

  paso "Configurando permisos de carpetas (UID 1000 del container 'node')"
  # El container corre como user 'node' (UID 1000) que coincide con el
  # primer usuario no-root de Ubuntu por convención. Si $USUARIO_INSTALACION
  # ya es UID 1000, el chown es redundante pero no daña. Si las carpetas se
  # crearon corriendo como root (sudo), el chown es necesario.
  mkdir -p "$INSTALACION_DIR_CRM/storage" "$INSTALACION_DIR_CRM/tmp" "$BACKUPS_DIR"
  chown -R 1000:1000 \
    "$INSTALACION_DIR_CRM/storage" \
    "$INSTALACION_DIR_CRM/tmp" \
    "$BACKUPS_DIR"
  chmod -R u+rwX,g+rwX \
    "$INSTALACION_DIR_CRM/storage" \
    "$INSTALACION_DIR_CRM/tmp" \
    "$BACKUPS_DIR"
  ok "storage/, tmp/ y $BACKUPS_DIR con dueño UID 1000"
}

# =====================================================================
# Migraciones
# =====================================================================

fase_migraciones() {
  fase "Aplicando migraciones SQL"

  local script="$INSTALACION_DIR_CRM/scripts/aplicar-migraciones.sh"
  if [ ! -x "$script" ]; then
    abortar "No encuentro $script o no es ejecutable"
  fi

  paso "Ejecutando scripts/aplicar-migraciones.sh"
  (cd "$INSTALACION_DIR_CRM" && POSTGRES_HOST="" bash "$script" 2>&1 | tee -a "$LOG_FILE")
  ok "Migraciones aplicadas"
}

# =====================================================================
# Seed de URLs públicas en la fila singleton de `configuracion`
# =====================================================================
#
# El CRM lee de `configuracion.url_crm`, `url_portal_cliente` y
# `url_formulario_publico` para armar los links de los emails. Sin esto
# los emails llegan con `http://localhost:3000` o con un host random.
#
# Filosofía: la URL pública la sabe el técnico (es `<slug>.fidcore.com.ar`),
# NO el PAS. Si la dejáramos vacía para que el PAS la cargue, nunca la
# completaría y los emails saldrían rotos. Por eso la inyectamos acá.
#
# Las 3 columnas reciben el mismo valor inicial (mismo dominio). El PAS
# después puede diferenciarlas desde /crm/configuracion/perfil si quiere
# (ej: cuando compre su propio dominio).
#
# Idempotente: si la fila ya existe, hace UPDATE; si no, INSERT.
# =====================================================================

fase_seed_urls_publicas() {
  fase "Sembrando URLs públicas en la configuración"

  local url_publica="https://${SLUG_CLIENTE}.${DOMINIO_BASE}"
  paso "URL del CRM = $url_publica"

  local sql="
    INSERT INTO public.configuracion (url_crm, url_portal_cliente, url_formulario_publico)
    SELECT '$url_publica', '$url_publica', '$url_publica'
    WHERE NOT EXISTS (SELECT 1 FROM public.configuracion);

    UPDATE public.configuracion
       SET url_crm = '$url_publica',
           url_portal_cliente = '$url_publica',
           url_formulario_publico = '$url_publica';
  "

  if ! echo "$sql" | docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 >>"$LOG_FILE" 2>&1; then
    abortar "No se pudo sembrar las URLs públicas en configuracion"
  fi
  ok "URLs públicas guardadas: url_crm = url_portal_cliente = url_formulario_publico = $url_publica"
}

# =====================================================================
# Build y arranque del CRM
# =====================================================================

fase_build_crm() {
  fase "Build y arranque del CRM"

  paso "docker compose build (puede tardar 3-5 min)"
  (cd "$INSTALACION_DIR_CRM" && docker compose build crm >>"$LOG_FILE" 2>&1)
  ok "Build completado"

  paso "docker compose up -d"
  (cd "$INSTALACION_DIR_CRM" && docker compose up -d >>"$LOG_FILE" 2>&1)
  ok "Containers del CRM iniciados"

  paso "Esperando que el CRM responda (max 2 min)"
  local intentos=0
  local max_intentos=24
  while [ $intentos -lt $max_intentos ]; do
    if curl -sf -o /dev/null --max-time 3 "http://localhost:3000/" 2>/dev/null; then
      ok "CRM respondiendo en :3000"
      return 0
    fi
    sleep 5
    intentos=$((intentos + 1))
    [ $((intentos % 6)) -eq 0 ] && info "Esperando... ($((intentos * 5))s)"
  done
  warn "CRM no respondió en 2 minutos pero el container está arriba. Revisá los logs con: docker logs fidcore-crm"
}

# =====================================================================
# Reiniciar auth hook
# =====================================================================

fase_activar_auth_hook() {
  fase "Activando auth hook de Supabase"

  paso "Reiniciando container 'auth' para que tome el override"
  (cd "$INSTALACION_DIR_SUPABASE/docker" && docker compose up -d auth >>"$LOG_FILE" 2>&1)
  sleep 3
  ok "Auth hook activo"
}

# =====================================================================
# Cloudflare Tunnel
# =====================================================================

fase_levantar_cloudflared() {
  fase "Cloudflare Tunnel"

  if [ -z "${TUNNEL_TOKEN:-}" ]; then
    warn "TUNNEL_TOKEN no configurado — salteando arranque de cloudflared"
    info "Para activar después: editá $INSTALACION_DIR_CRM/.env.docker y completá TUNNEL_TOKEN=..."
    info "Luego: cd $INSTALACION_DIR_CRM && docker compose --profile tunnel up -d cloudflared"
    return 0
  fi

  paso "Levantando container cloudflared con el token"
  (cd "$INSTALACION_DIR_CRM" && docker compose --profile tunnel up -d cloudflared >>"$LOG_FILE" 2>&1)

  paso "Esperando registro del tunnel (max 60s)"
  local intentos=0
  local max_intentos=20
  while [ $intentos -lt $max_intentos ]; do
    if docker logs fidcore-cloudflared 2>&1 | grep -q "Registered tunnel connection"; then
      ok "Tunnel registrado — el CRM ya es accesible en ${URL_PUBLICA}"
      return 0
    fi
    sleep 3
    intentos=$((intentos + 1))
  done

  warn "El tunnel no reportó 'Registered tunnel connection' en 60s. Revisá: docker logs fidcore-cloudflared"
}

# =====================================================================
# APPLIANCE: sudoers + sistema-trigger en host
# =====================================================================

fase_appliance_setup() {
  fase "Setup de APPLIANCE (sudoers + sistema-trigger)"

  if [ "$MODO_INSTALACION" != "APPLIANCE" ]; then
    info "Modo VPS — salteando configuración del host para apagar/reiniciar"
    return 0
  fi

  local script_src="$INSTALACION_DIR_CRM/scripts/sistema-trigger.sh"
  local script_dst="/usr/local/bin/fidcore-sistema-trigger.sh"

  paso "Copiando sistema-trigger.sh al host"
  if [ ! -f "$script_src" ]; then
    warn "$script_src no existe (puede que el repo del CRM no la tenga aún)"
    return 0
  fi
  install -m 0755 "$script_src" "$script_dst"
  ok "Script en $script_dst"

  paso "Configurando sudoers (NOPASSWD para shutdown/reboot)"
  local sudoers_file="/etc/sudoers.d/fidcore-sistema"
  cat > "$sudoers_file" <<EOF
# FidCore — permite al usuario $USUARIO_INSTALACION apagar/reiniciar el host
# sin password. Necesario para que el watcher procese los flags del CRM.
$USUARIO_INSTALACION ALL=(root) NOPASSWD: /sbin/shutdown, /sbin/reboot
EOF
  chmod 0440 "$sudoers_file"
  # Validar sintaxis del sudoers
  if ! visudo -c -f "$sudoers_file" >>"$LOG_FILE" 2>&1; then
    rm -f "$sudoers_file"
    abortar "El archivo sudoers generado tiene sintaxis inválida — se revirtió"
  fi
  ok "sudoers configurado en $sudoers_file"

  paso "Registrando cron del usuario $USUARIO_INSTALACION"
  local cron_line="* * * * * CRM_DIR=${INSTALACION_DIR_CRM} ${script_dst} >> ${INSTALACION_DIR_CRM}/tmp/sistema/cron.log 2>&1"
  local existing_cron
  existing_cron="$(crontab -u "$USUARIO_INSTALACION" -l 2>/dev/null || true)"
  if echo "$existing_cron" | grep -qF "fidcore-sistema-trigger.sh"; then
    info "Cron ya registrado — sin cambios"
  else
    (echo "$existing_cron"; echo "$cron_line") | crontab -u "$USUARIO_INSTALACION" -
    ok "Cron registrado (* * * * *)"
  fi
}

# =====================================================================
# Cron del host para actualizaciones automáticas (ambos modos)
# =====================================================================

fase_setup_cron_updates() {
  fase "Cron del host para actualizaciones automáticas"

  local script_src="$INSTALACION_DIR_CRM/scripts/actualizacion-trigger.sh"
  if [ ! -f "$script_src" ]; then
    warn "$script_src no existe — salteando cron de updates"
    return 0
  fi

  paso "Registrando cron del usuario $USUARIO_INSTALACION"
  # Igual que actualizacion-trigger.sh espera que CRM_DIR esté seteada
  local cron_line="* * * * * CRM_DIR=${INSTALACION_DIR_CRM} ${script_src} >> ${INSTALACION_DIR_CRM}/tmp/updates/cron.log 2>&1"
  local existing_cron
  existing_cron="$(crontab -u "$USUARIO_INSTALACION" -l 2>/dev/null || true)"
  if echo "$existing_cron" | grep -qF "actualizacion-trigger.sh"; then
    info "Cron de updates ya registrado — sin cambios"
  else
    (echo "$existing_cron"; echo "$cron_line") | crontab -u "$USUARIO_INSTALACION" -
    ok "Cron de updates registrado"
  fi
}

# =====================================================================
# Setup de rclone para sync de backups a Google Drive
# =====================================================================
# El binario de rclone ya está dentro del container (Dockerfile lo instala
# vía apt). Lo que falta resolver es:
#
# 1. La carpeta del host donde rclone guarda su config (~/.config/rclone)
#    tiene que existir CON EL OWNERSHIP del usuario instalador antes de
#    que docker-compose monte el volume. Sino Docker la crea como root y
#    el `rclone config` interactivo después falla con permission denied.
#
# 2. La activación real del sync (correr `rclone config` y autenticarse
#    contra Google) es interactiva y requiere un browser + cuenta del PAS,
#    así que NO la hacemos acá. El instalador deja todo listo y el técnico
#    de soporte (o el PAS técnico) corre `rclone config` cuando quiera.
#
# El instalador también instala rclone en el host. Eso es opcional pero
# útil porque permite probar `rclone lsd gdrive:` desde el shell del host
# sin tener que entrar al container.

fase_setup_rclone() {
  fase "Setup de rclone para backups a Google Drive"

  local config_dir="/home/${USUARIO_INSTALACION}/.config/rclone"

  paso "Instalando rclone en el host (si no está)"
  if command -v rclone >/dev/null 2>&1; then
    info "rclone ya instalado en el host: $(rclone version | head -1)"
  else
    apt-get install -y rclone >/dev/null 2>&1 || {
      warn "No se pudo instalar rclone en el host. El sync de backups va a fallar hasta que se instale manualmente."
      return 0
    }
    ok "rclone instalado en el host"
  fi

  paso "Pre-creando $config_dir con ownership de $USUARIO_INSTALACION"
  install -d -m 0700 -o "$USUARIO_INSTALACION" -g "$USUARIO_INSTALACION" "$config_dir"
  ok "Carpeta de config lista"

  paso "Generando README de configuración"
  local readme="${config_dir}/README.txt"
  if [ ! -f "$readme" ]; then
    cat > "$readme" <<'EOF'
# Configuración de rclone para backups del CRM a Google Drive

Esta carpeta se monta dentro del container del CRM como solo-lectura. Cuando
ejecutes `rclone config` y crees un remote llamado `gdrive`, automáticamente
queda visible para el CRM.

## Cómo configurar (técnico)

1. Ejecutar:

       rclone config

2. Elegir: n (New remote) → name `gdrive` → Storage: `drive` (Google Drive)
3. client_id/client_secret: dejar vacíos (Enter en ambos)
4. scope: 1 (Full access)
5. service_account_file: vacío
6. Edit advanced config? n
7. Use auto config? n (estamos en server sin browser)
8. Va a mostrar `rclone authorize "drive" "<token>"`. **NO CERRAR ESTA TERMINAL.**
9. En otra computadora con browser (Windows/Mac), ejecutar ese comando completo
   (instalar rclone primero si hace falta: https://rclone.org/downloads/).
10. El browser se abre, login con la cuenta de Google del PAS, autorizar.
11. La terminal de la otra computadora devuelve un JSON. **Copiar entero.**
12. Volver a la terminal del server, pegar el JSON (clic derecho del mouse,
    NO Ctrl+V) y Enter.
13. Configure as team drive? n
14. Yes this is OK? y
15. q (Quit)

## Verificar

    rclone lsd gdrive:

Si lista las carpetas del Drive, está OK.

## Cómo activarlo en el CRM

1. Configuración → Backups → Sincronización con Google Drive
2. Activar el toggle "Sincronizar a remoto"
3. Remote name: `gdrive` (el mismo nombre que pusiste en rclone config)
4. Carpeta remota: `fidcore-backups` (o vacío para la raíz del Drive)
5. Guardar

## Importante

- La cuenta de Google donde vas a guardar los backups **DEBE tener
  verificación en 2 pasos activada**. Es la única protección real del
  archivo en la nube (los .crmbak NO están cifrados).
- Si el PAS perdió el archivo de config y querés reconectar la misma cuenta:
      rclone config reconnect gdrive:
EOF
    chown "${USUARIO_INSTALACION}:${USUARIO_INSTALACION}" "$readme"
    chmod 0600 "$readme"
    ok "README dejado en $readme"
  else
    info "README ya existe — no se sobreescribió"
  fi

  paso "Verificando que el container ve el config"
  if docker ps --filter "name=fidcore-crm" --filter "status=running" -q | grep -q .; then
    if docker exec fidcore-crm test -d /home/node/.config/rclone 2>/dev/null; then
      ok "El container fidcore-crm tiene acceso a la carpeta de config"
    else
      warn "El container está corriendo pero no ve la carpeta de rclone. Probablemente arrancó antes de este paso — reiniciar con: docker compose -f ${INSTALACION_DIR_CRM}/docker-compose.yml up -d --force-recreate crm crons"
    fi
  else
    info "El container fidcore-crm aún no corre — se va a montar el config en el próximo arranque"
  fi

  info "rclone.conf todavía NO está creado (es esperado en una instalación nueva)."
  info "Para activar sync a Drive: ver ${config_dir}/README.txt"
}

# =====================================================================
# Tailscale (APPLIANCE + opcional)
# =====================================================================

fase_tailscale() {
  fase "Tailscale (soporte remoto del técnico)"

  if [ "$MODO_INSTALACION" != "APPLIANCE" ]; then
    info "Modo VPS — Tailscale no aplica (acceso por SSH directo)"
    return 0
  fi

  if [ -z "${TAILSCALE_AUTHKEY:-}" ]; then
    info "TAILSCALE_AUTHKEY no configurado — salteando instalación de Tailscale"
    info "IMPORTANTE: sin Tailscale no podés acceder al server cuando el PAS te pida soporte."
    info "El PAS no tiene acceso SSH ni conocimiento técnico para prenderlo manualmente."
    info "Para instalarlo después: curl -fsSL https://tailscale.com/install.sh | sh"
    info "Luego: sudo tailscale up --auth-key=tskey-XXXX  (queda activo permanente)"
    return 0
  fi

  if command -v tailscale >/dev/null 2>&1; then
    ok "Tailscale ya instalado: $(tailscale --version 2>/dev/null | head -1)"
  else
    paso "Instalando Tailscale"
    curl -fsSL https://tailscale.com/install.sh | sh >>"$LOG_FILE" 2>&1
    command -v tailscale >/dev/null 2>&1 || abortar "Falló la instalación de Tailscale"
    ok "Tailscale instalado"
  fi

  paso "Habilitando systemd service (arranque automático al boot)"
  # Tailscale tiene que estar SIEMPRE encendido — el PAS no tiene acceso al
  # server ni conocimientos para prenderlo a pedido. Sin esto, en cuanto el
  # server reboote (corte de luz, update, etc.) perdés el acceso remoto.
  systemctl enable --now tailscaled >>"$LOG_FILE" 2>&1
  ok "tailscaled habilitado y arrancado"

  paso "Conectando con la auth-key (queda persistente)"
  tailscale up --auth-key="$TAILSCALE_AUTHKEY" --advertise-tags=tag:fidcore-prod >>"$LOG_FILE" 2>&1 || \
    abortar "Falló tailscale up — revisá la auth-key. Sin Tailscale no podés dar soporte remoto."

  # Mostrar IP de Tailscale para que Nahuel la anote
  local ts_ip
  ts_ip="$(tailscale ip -4 2>/dev/null | head -1)"
  ok "Tailscale activo y siempre on. IP: ${ts_ip:-pendiente}"
  info "Vos entrás por SSH a esa IP cuando el PAS pida soporte."
}

# =====================================================================
# Smoke test
# =====================================================================

fase_smoke_test() {
  fase "Smoke test final"

  local errores=0

  paso "Container del CRM responde local"
  if curl -sf -o /dev/null --max-time 5 "http://localhost:3000/" 2>/dev/null; then
    ok "CRM responde 200 en localhost:3000"
  else
    warn "CRM no respondió en localhost:3000 (revisá: docker logs fidcore-crm)"
    errores=$((errores + 1))
  fi

  paso "Containers del CRM activos"
  local containers_crm
  containers_crm=$(docker ps --filter "name=fidcore-crm" --format '{{.Names}}' | wc -l)
  if [ "$containers_crm" -ge 3 ]; then
    ok "$containers_crm containers del CRM activos"
  else
    warn "Solo $containers_crm containers del CRM activos (esperados al menos 3: crm + crons + importacion-runner)"
    errores=$((errores + 1))
  fi

  paso "Containers de Supabase activos"
  local containers_supabase
  containers_supabase=$(docker ps --filter "name=supabase-" --format '{{.Names}}' | wc -l)
  if [ "$containers_supabase" -ge 8 ]; then
    ok "$containers_supabase containers de Supabase activos"
  else
    warn "Solo $containers_supabase containers de Supabase activos (esperados al menos 8)"
    errores=$((errores + 1))
  fi

  if [ -n "${TUNNEL_TOKEN:-}" ]; then
    paso "Cloudflare Tunnel activo"
    if docker ps --filter "name=fidcore-cloudflared" --format '{{.Names}}' | grep -q fidcore-cloudflared; then
      ok "Container cloudflared corriendo"

      paso "URL pública responde"
      # Le damos 10s — CF puede tardar en propagar
      sleep 5
      if curl -sf -o /dev/null --max-time 10 "${URL_PUBLICA}/" 2>/dev/null; then
        ok "${URL_PUBLICA} responde"
      else
        warn "${URL_PUBLICA} no responde todavía (puede tardar 1-2 min en propagar DNS/CF)"
      fi
    else
      warn "Container cloudflared NO está corriendo"
      errores=$((errores + 1))
    fi
  fi

  if [ "$MODO_INSTALACION" = "APPLIANCE" ]; then
    paso "Cron del sistema-trigger registrado"
    if crontab -u "$USUARIO_INSTALACION" -l 2>/dev/null | grep -q "fidcore-sistema-trigger.sh"; then
      ok "Cron del sistema-trigger en crontab"
    else
      warn "Cron del sistema-trigger NO está en crontab"
      errores=$((errores + 1))
    fi
  fi

  echo
  if [ $errores -eq 0 ]; then
    ok "Todos los chequeos pasaron"
  else
    warn "$errores chequeo(s) con problemas. El CRM puede estar funcional igual — revisá los logs."
  fi
}

# =====================================================================
# Resumen
# =====================================================================

fase_resumen() {
  fase "Instalación completada"

  local cf_status="pendiente — configurar después"
  if [ -n "${TUNNEL_TOKEN:-}" ]; then
    if docker ps --filter "name=fidcore-cloudflared" --format '{{.Names}}' | grep -q fidcore-cloudflared; then
      cf_status="activo (container fidcore-cloudflared corriendo)"
    else
      cf_status="token cargado pero container no levantó"
    fi
  fi

  local ts_status="no instalado"
  if [ "$MODO_INSTALACION" = "APPLIANCE" ] && command -v tailscale >/dev/null 2>&1; then
    local ts_ip
    ts_ip="$(tailscale ip -4 2>/dev/null | head -1)"
    if systemctl is-active tailscaled >/dev/null 2>&1; then
      ts_status="activo, siempre on (IP: ${ts_ip:-pendiente})"
    else
      ts_status="instalado pero inactivo — revisá con: systemctl status tailscaled"
    fi
  fi

  local lic_status="pendiente — cargar desde el CRM"
  if [ -n "${LICENCIA_PATH:-}" ]; then
    lic_status="archivo en ${LICENCIA_PATH} — subir desde /crm/configuracion/licencia"
  fi

  cat <<EOF

${C_BOLD}${C_GREEN}🎉  FidCore CRM instalado correctamente${C_RESET}

  Slug del cliente:    ${C_BOLD}${SLUG_CLIENTE}${C_RESET}
  Modo:                ${C_BOLD}${MODO_INSTALACION}${C_RESET}
  URL pública:         ${C_BOLD}${URL_PUBLICA}${C_RESET}
  Supabase Studio:     http://$(hostname -I | awk '{print $1}'):${KONG_HTTP_PORT}
    Usuario: ${DASHBOARD_USERNAME}
    Password: ${DASHBOARD_PASSWORD}

  CF Tunnel:           ${cf_status}
  Tailscale:           ${ts_status}
  Licencia:            ${lic_status}

  Carpetas:
    CRM:       ${INSTALACION_DIR_CRM}
    Supabase:  ${INSTALACION_DIR_SUPABASE}
    Backups:   ${BACKUPS_DIR}

  Log completo de la instalación: ${LOG_FILE}

${C_BOLD}${C_BLUE}📋  HAND-OFF AL PAS:${C_RESET}

  1. El PAS entra a ${URL_PUBLICA}/setup y crea su cuenta admin.
  2. Configura nombre, logo, color de marca en /crm/configuracion/perfil.
  3. Configura SMTP en /crm/configuracion/correos.
  4. Configura agente IA en /crm/configuracion/agente-ia (si querés activarlo desde el día 1).
  5. Configura rclone para backups remotos en /crm/configuracion/backups.
EOF

  if [ -z "${LICENCIA_PATH:-}" ]; then
    cat <<EOF
  6. Carga la licencia desde /crm/configuracion/licencia.
     (Vos generás la .lic con scripts/emitir-licencia.js de tu carpeta offline.)
EOF
  fi

  if [ -z "${TUNNEL_TOKEN:-}" ]; then
    echo
    cat <<EOF
${C_BOLD}${C_YELLOW}⚠   Cloudflare Tunnel pendiente:${C_RESET}
  - Generar token en CF Zero Trust → Networks → Tunnels → Create.
  - Editar ${INSTALACION_DIR_CRM}/.env.docker → completar TUNNEL_TOKEN=...
  - cd ${INSTALACION_DIR_CRM} && docker compose --profile tunnel up -d cloudflared
EOF
  fi

  if [ "$MODO_INSTALACION" = "APPLIANCE" ] && [ -z "${TAILSCALE_AUTHKEY:-}" ]; then
    cat <<EOF

${C_BOLD}${C_RED}⚠   Tailscale NO instalado — esto bloquea el soporte remoto:${C_RESET}
  - Sin Tailscale, vos solo podés entrar al server si estás en la LAN de la
    oficina del PAS. Imposible dar soporte a distancia.
  - El PAS NO tiene acceso al server ni conocimientos para prender Tailscale
    a pedido. Tiene que estar siempre on desde el día 1.
  - Para activarlo ahora (Tailscale arranca solo en cada boot):
       curl -fsSL https://tailscale.com/install.sh | sh
       sudo systemctl enable --now tailscaled
       sudo tailscale up --auth-key=tskey-XXXX --advertise-tags=tag:fidcore-prod
       tailscale ip -4   # anotá esta IP, es por donde entrás
EOF
  fi

  echo
}

# =====================================================================
# Main
# =====================================================================

main() {
  fase_preflight_minimo
  fase_dependencias_iniciales
  fase_wizard
  fase_validar_config
  fase_dependencias_host
  fase_docker
  fase_generar_secrets
  fase_clonar_supabase
  fase_patch_kong
  fase_levantar_supabase
  fase_clonar_crm
  fase_migraciones
  fase_seed_urls_publicas
  fase_build_crm
  fase_activar_auth_hook
  fase_levantar_cloudflared
  fase_appliance_setup
  fase_setup_cron_updates
  fase_setup_rclone
  fase_tailscale
  fase_smoke_test
  fase_resumen
}

main "$@"
