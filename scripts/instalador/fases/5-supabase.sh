#!/bin/bash
# Fase 5 — Supabase self-hosted.
#
# Clona el repo, genera todos los secrets (POSTGRES_PASSWORD, JWT_SECRET,
# ANON_KEY, SERVICE_ROLE_KEY, DASHBOARD_PASSWORD), completa el .env, agrega el
# auth hook override, parcha el kong.yml con paths /supabase/..., y levanta
# todos los containers.

SUPABASE_DIR="/opt/supabase"

fase_supabase_ejecutar() {
  ui_seccion "Supabase self-hosted"

  # shellcheck source=../lib/secrets.sh
  source "$SCRIPT_DIR/lib/secrets.sh"

  local slug
  slug=$(estado_get CLIENTE_SLUG)
  if [[ -z "$slug" ]]; then
    ui_error "Falta el slug del cliente. Corré la fase 'Datos' primero."
    return 1
  fi

  # 1. Clonar Supabase
  if [[ -d "$SUPABASE_DIR/docker" ]]; then
    ui_ok "Repo de Supabase ya clonado en $SUPABASE_DIR"
  else
    ui_info "Clonando repo oficial de Supabase en $SUPABASE_DIR..."
    if ! sudo git clone --depth 1 https://github.com/supabase/supabase.git "$SUPABASE_DIR" > /dev/null 2>&1; then
      ui_error "Falló el git clone de Supabase."
      return 1
    fi
    sudo chown -R "$USER:$USER" "$SUPABASE_DIR"
    ui_ok "Supabase clonado"
  fi

  # 2. Copiar .env.example → .env (si no existe ya)
  if [[ ! -f "$SUPABASE_DIR/docker/.env" ]]; then
    cp "$SUPABASE_DIR/docker/.env.example" "$SUPABASE_DIR/docker/.env"
    chmod 600 "$SUPABASE_DIR/docker/.env"
    ui_ok ".env creado desde .env.example"
  else
    ui_warn ".env de Supabase ya existe. Lo preservo (no piso secrets existentes)."
    if ui_confirm "¿Querés REGENERAR los secrets (esto rompe instalaciones previas)?"; then
      cp "$SUPABASE_DIR/docker/.env.example" "$SUPABASE_DIR/docker/.env"
      chmod 600 "$SUPABASE_DIR/docker/.env"
    else
      ui_ok "Manteniendo el .env existente."
      # Saltamos generación de secrets pero seguimos con el resto de la fase
      _supabase_override_y_kong "$slug" || return 1
      _supabase_levantar || return 1
      fase_completar "supabase"
      return 0
    fi
  fi

  # 3. Generar secrets
  ui_info "Generando secrets de Supabase..."
  local postgres_password
  local jwt_secret
  local dashboard_password
  local anon_key
  local service_role_key

  postgres_password=$(generar_hex 24)
  jwt_secret=$(openssl rand -base64 48 | tr -d '\n' | head -c 64)
  dashboard_password=$(generar_hex 16)
  anon_key=$(generar_anon_key "$jwt_secret")
  service_role_key=$(generar_service_role_key "$jwt_secret")

  if ! validar_jwt_estructura "$anon_key" || ! validar_jwt_estructura "$service_role_key"; then
    ui_error "Los JWTs generados tienen estructura inválida (bug del generador)."
    return 1
  fi

  ui_ok "POSTGRES_PASSWORD generado (24 bytes hex)"
  ui_ok "JWT_SECRET generado (64 chars)"
  ui_ok "DASHBOARD_PASSWORD generado (16 bytes hex)"
  ui_ok "ANON_KEY generado ($(echo -n "$anon_key" | wc -c) chars)"
  ui_ok "SERVICE_ROLE_KEY generado ($(echo -n "$service_role_key" | wc -c) chars)"

  # Persistir los críticos en el estado para que la fase del CRM los lea
  estado_set SB_POSTGRES_PASSWORD "$postgres_password"
  estado_set SB_JWT_SECRET "$jwt_secret"
  estado_set SB_ANON_KEY "$anon_key"
  estado_set SB_SERVICE_ROLE_KEY "$service_role_key"
  estado_set SB_DASHBOARD_PASSWORD "$dashboard_password"

  # 4. Completar el .env de Supabase
  local env_sb="$SUPABASE_DIR/docker/.env"
  local url_publica="https://${slug}.fidcore.com.ar"

  _setear_env_var "$env_sb" "POSTGRES_PASSWORD"     "$postgres_password"
  _setear_env_var "$env_sb" "JWT_SECRET"            "$jwt_secret"
  _setear_env_var "$env_sb" "ANON_KEY"              "$anon_key"
  _setear_env_var "$env_sb" "SERVICE_ROLE_KEY"      "$service_role_key"
  _setear_env_var "$env_sb" "DASHBOARD_USERNAME"    "admin"
  _setear_env_var "$env_sb" "DASHBOARD_PASSWORD"    "$dashboard_password"
  _setear_env_var "$env_sb" "KONG_HTTP_PORT"        "8001"
  _setear_env_var "$env_sb" "API_EXTERNAL_URL"      "${url_publica}/supabase"
  _setear_env_var "$env_sb" "SITE_URL"              "$url_publica"
  _setear_env_var "$env_sb" "SUPABASE_PUBLIC_URL"   "${url_publica}/supabase"

  ui_ok ".env de Supabase completo"

  # 5. Override del auth hook + parche al kong.yml
  _supabase_override_y_kong "$slug" || return 1

  # 6. Levantar containers
  _supabase_levantar || return 1

  # 7. Resumen del Studio. La password NO se muestra en pantalla para evitar
  # que quede en el scrollback de la terminal o en una captura. Queda solo
  # en /etc/fidcore/instalador.env (chmod 600) y .env de Supabase.
  echo ""
  ui_box "Credenciales del Studio de Supabase:
  URL:   http://<ip-del-server>:8001
  User:  admin
  Pass:  (guardada en /etc/fidcore/instalador.env como DASHBOARD_PASSWORD)

Para verla, en el server:
  sudo grep DASHBOARD_PASSWORD /etc/fidcore/instalador.env"

  fase_completar "supabase"
  return 0
}

# ----- helpers de la fase 5 -----

# Setea o reemplaza una variable en un .env (preserva comentarios)
_setear_env_var() {
  local archivo="$1"
  local clave="$2"
  local valor="$3"

  # Escapamos los caracteres problemáticos del valor para sed
  local valor_escapado
  valor_escapado=$(printf '%s' "$valor" | sed 's/[\&|/]/\\&/g')

  if grep -q "^${clave}=" "$archivo"; then
    sed -i "s|^${clave}=.*|${clave}=${valor_escapado}|" "$archivo"
  else
    echo "${clave}=${valor}" >> "$archivo"
  fi
}

# Crea el docker-compose.override.yml para el auth hook + parcha kong.yml
_supabase_override_y_kong() {
  local slug="$1"

  # docker-compose.override.yml para el auth hook
  local override="$SUPABASE_DIR/docker/docker-compose.override.yml"
  if [[ -f "$override" ]] && grep -q "GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED" "$override"; then
    ui_ok "Auth hook override ya está configurado"
  else
    cp "$SCRIPT_DIR/templates/auth-override.yml" "$override"
    ui_ok "Auth hook override copiado (auth.GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_*)"
  fi

  # Parche al kong.yml para los paths /supabase/...
  local kong_yml="$SUPABASE_DIR/docker/volumes/api/kong.yml"
  if [[ ! -f "$kong_yml" ]]; then
    ui_error "No existe $kong_yml. ¿El repo de Supabase tiene la estructura esperada?"
    return 1
  fi

  # Asegurar pyyaml
  if ! python3 -c "import yaml" 2>/dev/null; then
    ui_info "Instalando python3-yaml para parchear kong.yml..."
    sudo apt-get install -y python3-yaml > /dev/null 2>&1
  fi

  ui_info "Parchando kong.yml con los paths /supabase/..."
  local resultado
  if ! resultado=$(sudo python3 "$SCRIPT_DIR/templates/parchar-kong.py" \
        "$kong_yml" "$SCRIPT_DIR/templates/kong-paths.json"); then
    ui_error "Falló el parche del kong.yml. Stdout:"
    echo "$resultado"
    return 1
  fi
  local modificados
  local skipeados
  modificados=$(echo "$resultado" | jq -r '.modificados | length')
  skipeados=$(echo "$resultado" | jq -r '.skipeados | length')
  ui_ok "kong.yml: $modificados services parchados, $skipeados ya estaban"

  return 0
}

# Levanta todos los containers de Supabase y espera que estén healthy
_supabase_levantar() {
  cd "$SUPABASE_DIR/docker" || return 1

  ui_info "Bajando containers de Supabase (docker compose pull)..."
  if ! ui_spin "Pulling..." -- dckr_compose pull; then
    ui_warn "Algunos pulls fallaron. Reintentando con output visible..."
    dckr_compose pull
  fi

  ui_info "Levantando Supabase (docker compose up -d)..."
  if ! dckr_compose up -d; then
    ui_error "Falló docker compose up de Supabase."
    return 1
  fi

  ui_info "Esperando a que los containers estén healthy (hasta 3 min)..."
  local timeout=180
  local elapsed=0
  while [[ $elapsed -lt $timeout ]]; do
    local unhealthy
    unhealthy=$(dckr_compose ps --format json 2>/dev/null | \
      jq -r 'select(.Health != "" and .Health != "healthy") | .Name' 2>/dev/null | wc -l)
    local total
    total=$(dckr_compose ps --format json 2>/dev/null | wc -l)
    if [[ "$unhealthy" == "0" ]] && [[ "$total" -gt 0 ]]; then
      ui_ok "Todos los containers de Supabase están healthy ($total containers)"
      return 0
    fi
    sleep 5
    elapsed=$((elapsed + 5))
  done

  ui_warn "Algunos containers no llegaron a healthy en $timeout segundos."
  dckr_compose ps
  if ! ui_confirm "¿Continuar igual?"; then
    return 1
  fi
  return 0
}
