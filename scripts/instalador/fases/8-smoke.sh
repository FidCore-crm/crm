#!/bin/bash
# Fase 8 — Smoke test final.
#
# Verifica que todo el stack está respondiendo correctamente:
#   - CRM en localhost:3000 (HTTP 200)
#   - Supabase Kong en localhost:8001 (HTTP 200 con la anon key)
#   - Dominio público responde por CF Tunnel (HTTP 200)
#   - WebSocket de Realtime devuelve 101 (Switching Protocols)
#   - Containers críticos están corriendo

fase_smoke_ejecutar() {
  ui_seccion "Smoke test final"

  local slug
  local anon_key
  slug=$(estado_get CLIENTE_SLUG)
  anon_key=$(estado_get SB_ANON_KEY)
  local dominio="https://${slug}.pulzar.com.ar"

  local fallidos=0

  # 1. CRM local
  if curl -sf -m 5 http://localhost:3000/ > /dev/null 2>&1; then
    ui_ok "CRM local responde (http://localhost:3000)"
  else
    ui_error "CRM local NO responde."
    fallidos=$((fallidos + 1))
  fi

  # 2. Supabase Kong local
  local kong_code
  kong_code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 \
    "http://localhost:8001/rest/v1/" -H "apikey: $anon_key" 2>/dev/null)
  if [[ "$kong_code" == "200" ]]; then
    ui_ok "Supabase Kong local responde 200"
  else
    ui_error "Supabase Kong local devolvió $kong_code (esperado 200)"
    fallidos=$((fallidos + 1))
  fi

  # 3. Containers críticos — verificamos que estén EJECUTANDO (state=running)
  # y que no estén en restart loop (RestartCount alto en los últimos minutos).
  local containers_esperados=(pulzar-crm pulzar-crm-crons pulzar-crm-importacion-runner supabase-db supabase-kong supabase-auth)
  for c in "${containers_esperados[@]}"; do
    local state restarts
    state=$(dckr inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo "ausente")
    restarts=$(dckr inspect -f '{{.RestartCount}}' "$c" 2>/dev/null || echo "0")
    if [[ "$state" != "running" ]]; then
      ui_error "Container $c NO está corriendo (estado: $state)"
      fallidos=$((fallidos + 1))
      continue
    fi
    # Si tiene >3 restarts es indicador de restart loop. Mostramos warning.
    if [[ "$restarts" =~ ^[0-9]+$ ]] && (( restarts > 3 )); then
      ui_warn "Container $c está corriendo pero tuvo $restarts restarts (posible restart loop)"
      ui_desc "  Últimas líneas: dckr logs --tail 30 $c"
      fallidos=$((fallidos + 1))
    else
      ui_ok "Container $c corriendo (restarts=$restarts)"
    fi
  done

  # 4. Dominio público (a través de CF Tunnel)
  ui_info "Probando $dominio (puede tardar si CF está propagando)..."
  local pub_code
  pub_code=$(curl -s -o /dev/null -w "%{http_code}" -m 15 "$dominio" 2>/dev/null)
  if [[ "$pub_code" == "200" ]]; then
    ui_ok "Dominio público responde 200 ($dominio)"
  elif [[ "$pub_code" == "000" ]]; then
    ui_warn "No se pudo alcanzar $dominio (timeout / DNS no propagado)."
    ui_desc "Esto puede tardar 1-2 minutos después de levantar el tunnel."
    fallidos=$((fallidos + 1))
  else
    ui_warn "Dominio público devolvió $pub_code (esperado 200)"
    fallidos=$((fallidos + 1))
  fi

  # 5. WebSocket Realtime devuelve 101
  if [[ -n "$anon_key" ]]; then
    local ws_code
    ws_code=$(curl -s -o /dev/null -w "%{http_code}" -m 15 \
      "${dominio}/supabase/realtime/v1/websocket?apikey=${anon_key}&vsn=2.0.0" \
      -H "Upgrade: websocket" -H "Connection: Upgrade" \
      -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
      -H "Sec-WebSocket-Version: 13" 2>/dev/null)
    if [[ "$ws_code" == "101" ]]; then
      ui_ok "Realtime WebSocket devuelve 101 (Switching Protocols)"
    else
      ui_warn "Realtime WebSocket devolvió $ws_code (esperado 101)."
      ui_desc "Revisá:"
      ui_desc "  • 'HTTP/2 to Origin' en OFF en el dashboard de CF (Speed > Optimization)"
      ui_desc "  • Public Hostname 'supabase/*' está ANTES del catch-all"
      ui_desc "  • Patch al kong.yml se aplicó correctamente"
      fallidos=$((fallidos + 1))
    fi
  fi

  # 6. /setup responde (= no se creó admin todavía, lo cual es lo esperado)
  local setup_code
  setup_code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 \
    "http://localhost:3000/api/auth/check-setup" 2>/dev/null)
  if [[ "$setup_code" == "200" ]]; then
    ui_ok "Endpoint /api/auth/check-setup responde 200"
  else
    ui_warn "/api/auth/check-setup devolvió $setup_code"
  fi

  echo ""
  ui_hr
  if [[ "$fallidos" == "0" ]]; then
    ui_banner "Instalación exitosa" "Todo el stack respondiendo correctamente"
    _mostrar_resumen_final
    fase_completar "smoke"
    return 0
  else
    ui_warn "Smoke test terminado con $fallidos chequeos fallidos."
    ui_desc "Revisá los errores arriba antes de entregar al cliente."
    if ui_confirm "¿Marcar la instalación como completa igual?"; then
      fase_completar "smoke"
    fi
    return 1
  fi
}

_mostrar_resumen_final() {
  local slug
  local nombre
  slug=$(estado_get CLIENTE_SLUG)
  nombre=$(estado_get CLIENTE_NOMBRE)

  echo ""
  ui_box "🚀 PULZAR CRM listo para entregar a ${nombre:-$slug}

URL del cliente:
  https://${slug}.pulzar.com.ar
  (sirve desde dentro y fuera de la oficina, en cualquier dispositivo)

Lo que tiene que hacer el PAS:
  1. Crear su admin en /setup
  2. Configurar perfil (logo, color, contacto) en /crm/configuracion/perfil
  3. Configurar SMTP en /crm/configuracion/correos
  4. Cargar licencia .lic en /crm/configuracion/licencia (si no la cargaste vos)
  5. Elegir modos de uso (Portal del Cliente, agente IA de PDFs)

Para tu soporte:
  • Tailscale instalado y apagado. El cliente lo prende con:
    sudo systemctl start tailscaled
  • Portainer en https://localhost:9443 (vía SSH tunnel desde Tailscale)

Credenciales del Supabase Studio (solo vos):
  http://<ip-lan>:8001 → admin / (ver /etc/pulzar/instalador.env)

  Para obtener la pass desde el server:
    sudo grep DASHBOARD_PASSWORD /etc/pulzar/instalador.env

Backups locales en:  /var/backups/crm-seguros/
Estado del instalador: /etc/pulzar/instalador.{env,progreso}"
  echo ""
}
