#!/bin/bash
# wizard.sh — wizard interactivo del instalador, usa gum.
# Se sourcea desde install.sh con: . "${SCRIPT_DIR}/lib/wizard.sh"
#
# Filosofía:
#   - Preguntar solo lo IMPRESCINDIBLE para arrancar (slug, modo, repo).
#   - Cosas RECOMENDADAS (CF Tunnel, licencia) son opcionales.
#   - SMTP, Anthropic, rclone, datos de org → configurables después desde el CRM.
#   - Si una var ya viene seteada en env, se respeta y no se pregunta.
#
# Variables que setea (exportadas al shell que lo invoca):
#   SLUG_CLIENTE, MODO_INSTALACION, CRM_REPO_URL, TUNNEL_TOKEN, LICENCIA_PATH,
#   PANEL_URL, PANEL_HEARTBEAT_TOKEN

# ---- Helpers internos ----

_gum_input() {
  # gum input con prompt + placeholder
  # Args: $1 prompt, $2 placeholder (opcional), $3 default value (opcional)
  local prompt="$1"
  local placeholder="${2:-}"
  local default="${3:-}"
  if [ -n "$default" ]; then
    gum input --prompt "❯ " --header "$prompt" --placeholder "$placeholder" --value "$default" --width 70
  else
    gum input --prompt "❯ " --header "$prompt" --placeholder "$placeholder" --width 70
  fi
}

_gum_password() {
  local prompt="$1"
  gum input --prompt "❯ " --header "$prompt" --password --width 70
}

_gum_confirm() {
  # gum confirm devuelve 0 si sí, 1 si no
  local pregunta="$1"
  gum confirm --default=true "$pregunta"
}

# ---- Funciones de pregunta ----

mostrar_banner_bienvenida() {
  clear
  gum style \
    --foreground 51 --border-foreground 51 --border double \
    --align center --width 70 --margin "1 2" --padding "1 4" \
    'FidCore CRM — Instalador' \
    'Wizard de configuración interactivo'

  gum style --foreground 245 --margin "0 4" \
    'Voy a hacerte unas preguntas para configurar el servidor.' \
    'Los pasos marcados con (opcional) podés saltarlos y configurarlos' \
    'después desde la pantalla de Configuración del CRM.'
  echo
}

preguntar_modo() {
  if [ -n "${MODO_INSTALACION:-}" ]; then
    ok "Modo: ${MODO_INSTALACION} (ya seteado en env)"
    return 0
  fi

  gum style --bold --foreground 51 '1/6  Tipo de instalación'
  gum style --foreground 245 \
    '¿Dónde corre este servidor?' \
    '- Servidor local: mini PC físico en la oficina del PAS.' \
    '- VPS: servidor virtual (Contabo, Hetzner, etc).' \
    'La diferencia: en servidor local hay botones para apagar/reiniciar' \
    'el equipo desde el CRM. En VPS no aplica.'
  echo

  local opcion
  opcion=$(gum choose --cursor "❯ " --header "Elegí una opción:" \
    "Servidor local (APPLIANCE)" \
    "VPS (servidor virtual)")

  case "$opcion" in
    "Servidor local"*) MODO_INSTALACION="APPLIANCE" ;;
    "VPS"*) MODO_INSTALACION="VPS" ;;
    *) abortar "No se seleccionó modo" ;;
  esac
  echo
  ok "Modo: ${MODO_INSTALACION}"
  echo
}

preguntar_slug() {
  if [ -n "${SLUG_CLIENTE:-}" ]; then
    if ! [[ "$SLUG_CLIENTE" =~ ^[a-z0-9-]+$ ]]; then
      abortar "SLUG_CLIENTE en env es inválido: '$SLUG_CLIENTE'. Solo minúsculas, números y guiones."
    fi
    ok "Slug: ${SLUG_CLIENTE} (ya seteado en env)"
    return 0
  fi

  gum style --bold --foreground 51 '2/6  Slug del cliente'
  gum style --foreground 245 \
    'Identificador corto del cliente. Se usa en:' \
    '- El subdominio público (juanperez.fidcore.com.ar)' \
    '- El nombre del túnel de Cloudflare' \
    '- El hostname del servidor (en modo APPLIANCE)' \
    'Reglas: solo minúsculas, números y guiones. Sin espacios ni acentos.' \
    'Una vez elegido NO se cambia (el subdominio queda atado a él).'
  echo

  while true; do
    SLUG_CLIENTE=$(_gum_input "Slug del cliente" "ej: juanperez")
    if [ -z "$SLUG_CLIENTE" ]; then
      warn "El slug no puede estar vacío"
      continue
    fi
    if ! [[ "$SLUG_CLIENTE" =~ ^[a-z0-9-]+$ ]]; then
      warn "Slug inválido. Solo minúsculas, números y guiones."
      continue
    fi
    if [ "${#SLUG_CLIENTE}" -gt 30 ]; then
      warn "Slug demasiado largo (max 30 chars)"
      continue
    fi
    break
  done

  echo
  ok "Slug: ${SLUG_CLIENTE}"
  info "URL pública será: https://${SLUG_CLIENTE}.${DOMINIO_BASE}"
  echo
}

preguntar_repo_url() {
  local default_repo="https://github.com/FidCore-crm/crm.git"

  if [ -n "${CRM_REPO_URL:-}" ] && [ "$CRM_REPO_URL" != "$default_repo" ]; then
    ok "Repo CRM: $(echo "$CRM_REPO_URL" | sed -E 's#https?://[^@]+@#https://***@#') (ya seteado en env)"
    return 0
  fi

  gum style --bold --foreground 51 '3/6  Repo del CRM'
  gum style --foreground 245 \
    'El repo oficial es público — no necesitás auth ni PAT.' \
    '  Default: https://github.com/FidCore-crm/crm.git' \
    'Solo cambialo si querés instalar un fork o una rama de test.'
  echo

  CRM_REPO_URL=$(_gum_input "URL del repo" "$default_repo" "$default_repo")

  if [ -z "$CRM_REPO_URL" ]; then
    CRM_REPO_URL="$default_repo"
  fi
  if ! [[ "$CRM_REPO_URL" =~ ^https?:// ]]; then
    abortar "URL inválida (debe empezar con http:// o https://)"
  fi

  echo
  ok "Repo: $(echo "$CRM_REPO_URL" | sed -E 's#https?://[^@]+@#https://***@#')"
  echo
}

preguntar_cf_token() {
  if [ -n "${TUNNEL_TOKEN:-}" ]; then
    ok "CF Tunnel token: configurado (ya seteado en env)"
    return 0
  fi

  gum style --bold --foreground 51 '4/6  Cloudflare Tunnel (opcional)'
  gum style --foreground 245 \
    'El túnel permite que el PAS acceda al CRM desde cualquier lado' \
    'con la URL pública. Sin esto, solo accede dentro de la oficina.' \
    'El token lo conseguís en el dashboard de Cloudflare Zero Trust:' \
    '  Networks → Tunnels → Create tunnel → copiá el token.' \
    'Si todavía no lo creaste, podés saltar este paso y configurarlo después.'
  echo

  if _gum_confirm "¿Ya tenés el token del túnel?"; then
    echo
    TUNNEL_TOKEN=$(_gum_password "Pegá el token del túnel")
    if [ -z "$TUNNEL_TOKEN" ]; then
      warn "Token vacío, lo dejamos para después"
      TUNNEL_TOKEN=""
    else
      ok "Token recibido"
    fi
  else
    info "Token salteado. Lo cargás después editando .env.docker y reiniciando cloudflared."
    TUNNEL_TOKEN=""
  fi
  echo
}

preguntar_licencia() {
  if [ -n "${LICENCIA_PATH:-}" ]; then
    if [ ! -f "$LICENCIA_PATH" ]; then
      abortar "LICENCIA_PATH apunta a un archivo que no existe: $LICENCIA_PATH"
    fi
    ok "Licencia: $LICENCIA_PATH (ya seteado en env)"
    return 0
  fi

  gum style --bold --foreground 51 '5/6  Licencia (.lic) (opcional)'
  gum style --foreground 245 \
    'Archivo de licencia firmado que activa el CRM.' \
    'Sin licencia el sistema arranca en MODO SOLO LECTURA — el PAS puede' \
    'ver los datos pero no crear/editar pólizas, personas, siniestros, etc.' \
    'La licencia se puede cargar después desde:' \
    '  /crm/configuracion/licencia' \
    'Si la tenés ahora, podés cargarla acá para que arranque activo.'
  echo

  if _gum_confirm "¿Tenés el archivo .lic ahora?"; then
    echo
    LICENCIA_PATH=$(_gum_input "Ruta absoluta al archivo .lic" "/tmp/cliente.lic")
    if [ -z "$LICENCIA_PATH" ]; then
      warn "Ruta vacía, lo dejamos para después"
      LICENCIA_PATH=""
    elif [ ! -f "$LICENCIA_PATH" ]; then
      warn "El archivo no existe en esa ruta — lo dejamos para después"
      LICENCIA_PATH=""
    else
      ok "Licencia: $LICENCIA_PATH"
    fi
  else
    info "Licencia salteada. El sistema arranca en solo lectura hasta que la cargues desde el CRM."
    LICENCIA_PATH=""
  fi
  echo
}

preguntar_panel_vinculo() {
  if [ -n "${PANEL_URL:-}" ] && [ -n "${PANEL_HEARTBEAT_TOKEN:-}" ]; then
    ok "Vínculo al panel FidCore: configurado (ya seteado en env)"
    return 0
  fi

  local default_panel="https://panel.fidcore.com.ar"

  gum style --bold --foreground 51 '6/6  Vínculo al panel FidCore (recomendado)'
  gum style --foreground 245 \
    'El panel de administración de FidCore recibe un heartbeat cada 2h' \
    'de este CRM y te muestra en un dashboard central:' \
    '  - Si el servidor está online / caído.' \
    '  - Qué versión corre.' \
    '  - Cuándo fue el último backup.' \
    'Sin este vínculo el panel no ve al CRM. Solo aplica si sos parte' \
    'del equipo de FidCore. Si no, saltalo.'
  echo

  if _gum_confirm "¿Vincular este CRM al panel de FidCore?"; then
    echo
    PANEL_URL=$(_gum_input "URL del panel" "$default_panel" "$default_panel")
    if [ -z "$PANEL_URL" ]; then
      PANEL_URL="$default_panel"
    fi
    if ! [[ "$PANEL_URL" =~ ^https?:// ]]; then
      warn "URL inválida — el vínculo queda pendiente"
      PANEL_URL=""
      PANEL_HEARTBEAT_TOKEN=""
      echo
      return 0
    fi

    gum style --foreground 245 \
      'El PANEL_HEARTBEAT_TOKEN es el mismo para TODOS los CRMs que instales.' \
      'Lo obtenés del .env.docker del panel (o consultalo con el equipo de FidCore).'
    echo
    PANEL_HEARTBEAT_TOKEN=$(_gum_password "Pegá el PANEL_HEARTBEAT_TOKEN")
    if [ -z "$PANEL_HEARTBEAT_TOKEN" ]; then
      warn "Token vacío — el vínculo queda pendiente"
      PANEL_URL=""
      PANEL_HEARTBEAT_TOKEN=""
    else
      ok "Vínculo al panel configurado: $PANEL_URL"
    fi
  else
    info "Vínculo salteado. Podés configurarlo después agregando PANEL_URL y PANEL_HEARTBEAT_TOKEN al .env.docker."
    PANEL_URL=""
    PANEL_HEARTBEAT_TOKEN=""
  fi
  echo
}

mostrar_resumen() {
  echo
  gum style \
    --foreground 51 --border-foreground 51 --border rounded \
    --align left --width 70 --margin "1 2" --padding "1 3" \
    "$(printf 'Resumen de la configuración\n\n')$(
      printf '  Modo:             %s\n' "$MODO_INSTALACION"
      printf '  Slug:             %s\n' "$SLUG_CLIENTE"
      printf '  URL pública:      https://%s.%s\n' "$SLUG_CLIENTE" "$DOMINIO_BASE"
      printf '  Repo del CRM:     %s\n' "$(echo "$CRM_REPO_URL" | sed -E 's#https?://[^@]+@#https://***@#')"
      printf '  CF Tunnel:        %s\n' "$([ -n "${TUNNEL_TOKEN:-}" ] && echo 'configurado' || echo 'pendiente')"
      printf '  Licencia:         %s\n' "$([ -n "${LICENCIA_PATH:-}" ] && echo "$LICENCIA_PATH" || echo 'pendiente')"
      printf '  Vínculo panel:    %s\n' "$([ -n "${PANEL_URL:-}" ] && echo "$PANEL_URL" || echo 'pendiente')"
      printf '\n  Carpetas:\n'
      printf '    CRM:            %s\n' "$INSTALACION_DIR_CRM"
      printf '    Supabase:       %s\n' "$INSTALACION_DIR_SUPABASE"
      printf '    Backups:        %s\n' "$BACKUPS_DIR"
    )"
}

confirmar_inicio() {
  echo
  if ! _gum_confirm "¿Confirmás y arrancamos la instalación?"; then
    info "Instalación cancelada por el usuario"
    exit 0
  fi
  echo
}

# ---- Orquestador ----

correr_wizard() {
  # Si NO_WIZARD=1, salta todo (modo no-interactivo, usa env vars)
  if [ "${NO_WIZARD:-0}" = "1" ]; then
    info "NO_WIZARD=1 — usando configuración del entorno sin preguntar"
    return 0
  fi

  # Verificar TTY
  if ! sesion_es_interactiva; then
    abortar "Sin TTY interactivo. Para correr no-interactivo seteá NO_WIZARD=1 + todas las env vars (SLUG_CLIENTE, MODO_INSTALACION, CRM_REPO_URL, etc.)"
  fi

  # gum tiene que estar instalado
  if ! command -v gum >/dev/null 2>&1; then
    abortar "gum no está instalado. El instalador debería haberlo instalado antes — revisá el orden de fases."
  fi

  mostrar_banner_bienvenida
  preguntar_modo
  preguntar_slug
  preguntar_repo_url
  preguntar_cf_token
  preguntar_licencia
  preguntar_panel_vinculo
  mostrar_resumen
  confirmar_inicio

  # Exportar para que install.sh las vea
  export MODO_INSTALACION SLUG_CLIENTE CRM_REPO_URL TUNNEL_TOKEN LICENCIA_PATH
  export PANEL_URL PANEL_HEARTBEAT_TOKEN
}
