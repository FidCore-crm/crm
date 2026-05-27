#!/bin/bash
# Fase 1 — Recolectar datos del cliente.
#
# Le pregunta al técnico los datos imprescindibles para la instalación.
# No toca el sistema; solo persiste en /etc/pulzar/instalador.env.

fase_datos_ejecutar() {
  ui_seccion "Datos del cliente"

  ui_box "Vas a cargar:
  • Slug del cliente (identificador corto)
  • Token del tunnel de Cloudflare
  • DSN de Sentry (opcional)
  • Archivo de licencia .lic (opcional, se puede cargar después)

Tip: si estás reanudando una instalación, los valores ya cargados aparecen como default."

  echo ""

  # Slug del cliente
  ui_info "El slug es el identificador corto del cliente. Aparece en el subdominio (<slug>.pulzar.com.ar)."
  ui_desc "Solo minúsculas, números y guiones. Sin espacios, sin acentos, sin ñ."
  ui_desc "Ejemplo: juanperez, lobo-seguros, gomez-y-asoc"
  local slug
  slug=$(ui_input_validado "Slug del cliente:" "ej: juanperez" "validar_slug" "$(estado_get CLIENTE_SLUG)")
  estado_set CLIENTE_SLUG "$slug"
  ui_ok "Slug: $slug"
  echo ""

  # Nombre legible (no validado más allá de no-vacío)
  ui_info "Nombre legible de la productora (aparece en saludos / emails)."
  local nombre_default
  nombre_default=$(estado_get CLIENTE_NOMBRE)
  local nombre
  while true; do
    nombre=$(ui_input "Nombre legible:" "ej: Juan Pérez Seguros" "$nombre_default")
    if [[ -n "$nombre" ]]; then break; fi
    ui_error "El nombre no puede estar vacío."
  done
  estado_set CLIENTE_NOMBRE "$nombre"
  ui_ok "Nombre: $nombre"
  echo ""

  # Tunnel token
  ui_info "Token del tunnel de Cloudflare (creado en el dashboard de Zero Trust)."
  ui_desc "Es el string largo del comando 'cloudflared service install <TOKEN>'."
  ui_desc "Se guarda encriptado en /etc/pulzar/instalador.env (modo 600)."
  local tunnel_default
  tunnel_default=$(estado_get TUNNEL_TOKEN)
  local tunnel_token
  if [[ -n "$tunnel_default" ]]; then
    if ui_confirm "Ya hay un tunnel token cargado. ¿Mantenerlo?"; then
      tunnel_token="$tunnel_default"
    else
      tunnel_token=$(ui_input_validado "Tunnel token:" "eyJhIjo..." "validar_tunnel_token")
    fi
  else
    tunnel_token=$(ui_input_validado "Tunnel token:" "eyJhIjo..." "validar_tunnel_token")
  fi
  estado_set TUNNEL_TOKEN "$tunnel_token"
  ui_ok "Tunnel token cargado (${#tunnel_token} chars)"
  echo ""

  # Sentry DSN (opcional)
  ui_info "DSN de Sentry para telemetría de errores (opcional pero MUY recomendado)."
  ui_desc "Sin esto, no te enterás si el CRM del cliente tiene errores en producción."
  ui_desc "Si la dejás vacía, podés cargarla después en el .env.docker."
  local sentry_default
  sentry_default=$(estado_get SENTRY_DSN)
  local sentry_dsn
  sentry_dsn=$(ui_input_validado "Sentry DSN (vacío para saltear):" "https://xxx@oXXX.ingest.sentry.io/YYY" "validar_sentry_dsn" "$sentry_default")
  estado_set SENTRY_DSN "$sentry_dsn"
  if [[ -n "$sentry_dsn" ]]; then
    ui_ok "Sentry DSN cargado"
  else
    ui_warn "Sentry sin configurar (podés cargarlo después)"
  fi
  echo ""

  # Licencia (opcional)
  ui_info "Archivo de licencia .lic del cliente (opcional)."
  ui_desc "Si no la tenés a mano, el CRM arranca en modo solo lectura y la cargás después"
  ui_desc "desde /crm/configuracion/licencia."
  local licencia_path
  if ui_confirm "¿Tenés el archivo .lic acá?"; then
    while true; do
      licencia_path=$(ui_input "Ruta al archivo .lic:" "/home/usuario/cliente.lic" "$(estado_get LICENCIA_PATH)")
      if validar_archivo_existe "$licencia_path"; then
        # Verificar que sea JSON con los campos esperados (validación liviana)
        if jq -e '.firma and .instalacion_id and .cliente and .plan' "$licencia_path" > /dev/null 2>&1; then
          estado_set LICENCIA_PATH "$licencia_path"
          ui_ok "Licencia válida (firma + instalacion_id + cliente + plan presentes)"
          break
        else
          ui_error "El archivo no tiene la estructura esperada (falta firma, instalacion_id, cliente o plan)."
        fi
      fi
    done
  else
    estado_set LICENCIA_PATH ""
    ui_warn "Licencia se cargará después manualmente"
  fi
  echo ""

  # Resumen
  ui_hr
  ui_seccion "Resumen de datos cargados"
  echo ""
  printf "  %-22s %s\n" "Cliente (slug):"      "$slug"
  printf "  %-22s %s\n" "Cliente (nombre):"    "$nombre"
  printf "  %-22s %s\n" "Subdominio CRM:"      "https://$slug.pulzar.com.ar"
  printf "  %-22s %s\n" "Subdominio denuncia:" "https://denuncia.$slug.pulzar.com.ar"
  printf "  %-22s %s\n" "Tunnel token:"        "$(echo "$tunnel_token" | head -c 20)... (${#tunnel_token} chars)"
  printf "  %-22s %s\n" "Sentry DSN:"          "${sentry_dsn:-(sin configurar)}"
  printf "  %-22s %s\n" "Licencia .lic:"       "${licencia_path:-(se carga después)}"
  echo ""

  if ! ui_confirm "¿Los datos son correctos?"; then
    ui_warn "Volvé a correr 'bash scripts/instalador/instalar.sh' y elegí 'Recolectar datos' para corregir."
    return 1
  fi

  fase_completar "datos"
  return 0
}
