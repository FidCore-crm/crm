#!/bin/bash
# Fase 7 — Levantar el Cloudflare Tunnel.
#
# El service `cloudflared` del docker-compose.yml está bajo el profile `tunnel`,
# así que no arranca con `up -d` por default. Hay que levantarlo explícito con
# `--profile tunnel`.

fase_cloudflared_ejecutar() {
  ui_seccion "Cloudflare Tunnel"

  local tunnel_token
  tunnel_token=$(estado_get TUNNEL_TOKEN)
  if [[ -z "$tunnel_token" ]]; then
    ui_error "Falta el tunnel token. Corré la fase Datos primero."
    return 1
  fi

  cd "$PROJECT_DIR" || return 1

  ui_info "Levantando cloudflared..."
  if ! dckr_compose --profile tunnel up -d cloudflared; then
    ui_error "Falló docker compose up de cloudflared."
    return 1
  fi

  # Esperar logs que confirmen conexión
  ui_info "Esperando que el tunnel registre conexión (hasta 30s)..."
  local timeout=30
  local elapsed=0
  local conectado=0
  while [[ $elapsed -lt $timeout ]]; do
    if dckr logs --tail 50 cloudflared 2>&1 | grep -q "Registered tunnel connection"; then
      conectado=1
      break
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done

  if [[ "$conectado" == "1" ]]; then
    ui_ok "Cloudflared conectado al edge de Cloudflare"
  else
    ui_warn "No vi 'Registered tunnel connection' en los logs."
    ui_desc "Revisá:  docker logs cloudflared | tail -50"
    ui_desc "Verificá que el tunnel token sea correcto."
    if ! ui_confirm "¿Continuar igual?"; then
      return 1
    fi
  fi

  # ─── Recordatorio: Public Hostnames a configurar en CF ─────────────────
  # El tunnel ya está corriendo pero NO va a servir tráfico hasta que en el
  # dashboard de Cloudflare Zero Trust se configuren los hostnames.
  # Esto se hace UI-only (no hay CLI), así que solo podemos avisar al técnico.
  local slug
  slug=$(estado_get CLIENTE_SLUG)

  # ANSI codes simples (compatibles con cualquier terminal)
  local B='\033[1m'   # bold
  local C='\033[36m'  # cyan
  local G='\033[32m'  # green
  local Y='\033[33m'  # yellow
  local R='\033[0m'   # reset

  echo ""
  ui_hr
  ui_seccion "⚠️  Configuración pendiente en Cloudflare Zero Trust"
  echo ""
  ui_info "El tunnel está conectado pero NO va a servir tráfico hasta que"
  ui_info "configures los Public Hostnames en el dashboard de CF."
  echo ""
  ui_desc "Andá a: dash.cloudflare.com → Zero Trust → Networks → Tunnels → tu tunnel"
  ui_desc "        → Configure → Public Hostnames → Add a public hostname"
  echo ""
  ui_info "Tenés que crear ESTOS 3 hostnames (en este orden — primero el específico):"
  echo ""
  printf "  ${B}1) Subdominio del CRM con prefijo /supabase${R}\n"
  printf "     Subdomain:  ${C}%s${R}\n" "$slug"
  printf "     Domain:     ${C}pulzar.com.ar${R}\n"
  printf "     Path:       ${C}supabase/*${R}\n"
  printf "     Type:       ${C}HTTP${R}\n"
  printf "     URL:        ${C}supabase-kong:8000${R}\n"
  printf "     ${Y}Additional settings → No TLS Verify: ON${R}\n"
  echo ""
  printf "  ${B}2) Subdominio del CRM (catch-all)${R}\n"
  printf "     Subdomain:  ${C}%s${R}\n" "$slug"
  printf "     Domain:     ${C}pulzar.com.ar${R}\n"
  printf "     Path:       (vacío)\n"
  printf "     Type:       ${C}HTTP${R}\n"
  printf "     URL:        ${C}crm:3000${R}\n"
  echo ""
  printf "  ${B}3) Subdominio del formulario público de denuncia${R}\n"
  printf "     Subdomain:  ${C}denuncia.%s${R}\n" "$slug"
  printf "     Domain:     ${C}pulzar.com.ar${R}\n"
  printf "     Path:       (vacío)\n"
  printf "     Type:       ${C}HTTP${R}\n"
  printf "     URL:        ${C}crm:3000${R}\n"
  echo ""
  ui_info "URLs finales que el cliente va a usar:"
  printf "  • CRM (para el PAS):                ${G}https://%s.pulzar.com.ar${R}\n" "$slug"
  printf "  • Formulario público de denuncia:   ${G}https://denuncia.%s.pulzar.com.ar${R}\n" "$slug"
  printf "  • Portal del Asegurado:             ${G}https://%s.pulzar.com.ar/c/<token>${R}\n" "$slug"
  echo ""
  ui_warn "Sin estos 3 hostnames configurados, el sitio remoto no funciona."
  ui_warn "Si se omite el #3 (denuncia), el formulario público para clientes no será accesible."
  echo ""

  if ! ui_confirm "¿Ya configuraste los 3 Public Hostnames en Cloudflare?"; then
    ui_warn "Configurálos antes de pasar al smoke test. Después corré este instalador"
    ui_warn "de nuevo y elegí 'Cloudflare Tunnel' para retomar."
    return 1
  fi

  fase_completar "cloudflared"
  return 0
}
