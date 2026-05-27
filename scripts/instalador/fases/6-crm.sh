#!/bin/bash
# Fase 6 — El CRM (Next.js + crons + importacion-runner).
#
# Asume que el repo del CRM ya está clonado (el técnico clona antes de correr el
# instalador, porque el instalador vive adentro del repo).
#
# Genera .env.docker, ajusta permisos de carpetas, aplica migraciones SQL,
# buildea la imagen Docker, levanta los 3 containers, y si el técnico trajo el
# .lic lo carga vía API.

CRM_DIR="$PROJECT_DIR"

fase_crm_ejecutar() {
  ui_seccion "El CRM"

  # shellcheck source=../lib/secrets.sh
  source "$SCRIPT_DIR/lib/secrets.sh"

  if [[ ! -f "$CRM_DIR/docker-compose.yml" ]] || [[ ! -f "$CRM_DIR/Dockerfile" ]]; then
    ui_error "No encuentro docker-compose.yml o Dockerfile en $CRM_DIR"
    ui_desc "Asegurate de correr el instalador desde la raíz del repo del CRM."
    return 1
  fi

  local slug
  local tunnel_token
  local sentry_dsn
  local sb_password
  local sb_anon
  local sb_service
  slug=$(estado_get CLIENTE_SLUG)
  tunnel_token=$(estado_get TUNNEL_TOKEN)
  sentry_dsn=$(estado_get SENTRY_DSN)
  sb_password=$(estado_get SB_POSTGRES_PASSWORD)
  sb_anon=$(estado_get SB_ANON_KEY)
  sb_service=$(estado_get SB_SERVICE_ROLE_KEY)

  if [[ -z "$slug" || -z "$sb_password" || -z "$sb_anon" || -z "$sb_service" ]]; then
    ui_error "Faltan datos: corré la fase Datos y la fase Supabase antes."
    return 1
  fi

  # 1. Generar .env.docker
  ui_info "Generando .env.docker..."
  local env_crm="$CRM_DIR/.env.docker"
  local url_publica="https://${slug}.pulzar.com.ar"
  local encryption_key
  local cron_secret
  encryption_key=$(generar_hex 32)
  cron_secret=$(generar_hex 32)

  cat > "$env_crm" <<EOF
# Generado por el instalador de Pulzar el $(date -Iseconds)
# Cliente: ${slug}

# --- Supabase ---
NEXT_PUBLIC_SUPABASE_URL=${url_publica}/supabase
SUPABASE_INTERNAL_URL=http://supabase-kong:8000
NEXT_PUBLIC_SUPABASE_ANON_KEY=${sb_anon}
SUPABASE_SERVICE_ROLE_KEY=${sb_service}

# --- Postgres (para scripts dentro del container) ---
POSTGRES_HOST=supabase-db
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_DB=postgres
POSTGRES_PASSWORD=${sb_password}

# --- Encriptación + cron auth ---
ENCRYPTION_KEY=${encryption_key}
CRON_SECRET=${cron_secret}

# --- IA (Anthropic, el PAS la carga desde la UI) ---
ANTHROPIC_API_KEY=

# --- URLs públicas (single-hostname con CF Tunnel) ---
# Solo el dominio base, sin paths. El frontend agrega /denuncia y /c/<token>
# automáticamente. Si acá agregás un path se duplica (ej: /denuncia/denuncia).
URL_CRM_PUBLICA=${url_publica}
URL_PORTAL_CLIENTE=${url_publica}
URL_FORMULARIO_PUBLICO=${url_publica}

# --- Cloudflare Tunnel ---
TUNNEL_TOKEN=${tunnel_token}

# --- Telemetría Sentry ---
NEXT_PUBLIC_SENTRY_DSN=${sentry_dsn}

# --- Stack label (vacío en producción) ---
NEXT_PUBLIC_STACK_LABEL=
EOF

  chmod 600 "$env_crm"
  ui_ok ".env.docker generado (modo 600)"

  # Symlink .env → .env.docker (docker-compose lee .env por convención)
  if [[ ! -L "$CRM_DIR/.env" ]]; then
    ln -sf "$CRM_DIR/.env.docker" "$CRM_DIR/.env"
    ui_ok "Symlink .env → .env.docker creado"
  fi

  # 2. Carpetas y permisos
  ui_info "Ajustando permisos de carpetas (UID 1001 del container)..."
  sudo mkdir -p "$CRM_DIR/storage" "$CRM_DIR/tmp" /var/backups/crm-seguros
  sudo chown -R 1001:1001 "$CRM_DIR/storage" "$CRM_DIR/tmp" /var/backups/crm-seguros
  sudo chmod -R u+rwX,g+rwX "$CRM_DIR/storage" "$CRM_DIR/tmp" /var/backups/crm-seguros
  ui_ok "Permisos OK: storage/, tmp/, /var/backups/crm-seguros/"

  # 3. Aplicar migraciones SQL (desde el host, hablando al Postgres del container Supabase)
  ui_info "Aplicando migraciones SQL contra la DB de Supabase..."
  if ! ui_spin "Esperando que supabase-db esté listo..." -- bash -c '
    for i in {1..60}; do
      if sudo docker exec supabase-db pg_isready -U postgres > /dev/null 2>&1; then
        exit 0
      fi
      sleep 1
    done
    exit 1
  '; then
    ui_error "supabase-db no respondió en 60s. ¿Levantaste Supabase?"
    return 1
  fi

  if ! POSTGRES_HOST="" bash "$CRM_DIR/scripts/aplicar-migraciones.sh"; then
    ui_error "Falló la aplicación de migraciones."
    ui_desc "Revisá el output arriba. Las migraciones son idempotentes — podés reintentar."
    return 1
  fi
  ui_ok "Migraciones aplicadas"

  # 4. Build de la imagen del CRM
  cd "$CRM_DIR" || return 1
  ui_info "Building imagen del CRM (puede tardar 5-10 min la primera vez)..."
  if ! dckr_compose build crm; then
    ui_error "Falló docker compose build."
    return 1
  fi
  ui_ok "Imagen del CRM construida"

  # 5. Levantar los 3 containers del CRM
  ui_info "Levantando containers del CRM (crm + crons + importacion-runner)..."
  if ! dckr_compose up -d crm crons importacion-runner; then
    ui_error "Falló docker compose up del CRM."
    return 1
  fi

  # Esperar que crm esté healthy
  ui_info "Esperando que el CRM responda en localhost:3000..."
  local timeout=60
  local elapsed=0
  while [[ $elapsed -lt $timeout ]]; do
    if curl -sf -m 2 http://localhost:3000/ > /dev/null 2>&1; then
      ui_ok "CRM respondiendo en http://localhost:3000"
      break
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  if [[ $elapsed -ge $timeout ]]; then
    ui_warn "El CRM no respondió en $timeout segundos. Revisá los logs:"
    ui_desc "  docker logs pulzar-crm | tail -50"
  fi

  # 6. Reiniciar el auth de Supabase (ahora que la migración creó custom_access_token_hook)
  ui_info "Reiniciando supabase-auth para que tome el override del hook..."
  cd "$SUPABASE_DIR/docker" || return 1
  if ! dckr_compose up -d auth; then
    ui_warn "No se pudo reiniciar supabase-auth. Hacelo manual: cd $SUPABASE_DIR/docker && docker compose up -d auth"
  else
    ui_ok "supabase-auth reiniciado"
  fi

  cd "$CRM_DIR" || return 1

  # 7. Cargar la licencia si la trajo
  local licencia_path
  licencia_path=$(estado_get LICENCIA_PATH)
  if [[ -n "$licencia_path" ]] && [[ -f "$licencia_path" ]]; then
    ui_info "Cargando licencia desde $licencia_path..."
    _cargar_licencia "$licencia_path"
  else
    ui_warn "Sin licencia cargada. El CRM arranca en modo SOLO LECTURA hasta que el PAS cargue la suya."
    ui_desc "El PAS la carga en https://${slug}.pulzar.com.ar/crm/configuracion/licencia"
  fi

  fase_completar "crm"
  return 0
}

# Carga una licencia .lic vía el endpoint del CRM
_cargar_licencia() {
  local lic_path="$1"
  local resp
  resp=$(curl -sf -m 10 -X POST http://localhost:3000/api/licencia/cargar \
    -H "Content-Type: application/json" \
    -d @"$lic_path" 2>&1 || echo "ERROR")

  if echo "$resp" | grep -q '"ok":true'; then
    ui_ok "Licencia cargada correctamente"
  else
    ui_warn "No se pudo cargar la licencia desde el script. Respuesta:"
    ui_desc "$resp"
    ui_desc ""
    ui_desc "El PAS puede cargarla manualmente desde el CRM (configuracion/licencia)."
  fi
}
