# FidCore CRM — Instalador

Automatiza la instalación de FidCore CRM sobre Ubuntu Server 22.04 / 24.04 desde cero.

> **Estado**: Fases 1, 2 y 3 implementadas. El instalador hace todo end-to-end: instala Docker + Supabase + CRM, configura CF Tunnel, en APPLIANCE configura sudoers + cron del sistema-trigger, opcionalmente Tailscale, y termina con un smoke test.

## ¿Qué hace este instalador?

Automatiza el manual `INSTALACION.md` (raíz del repo). Tiene 20 etapas en este orden:

1. **Pre-flight**: valida sudo, OS Ubuntu, conectividad básica.
2. **Dependencias mínimas**: `curl`, `gpg`, `gum` (este último para el wizard).
3. **Wizard interactivo** (o salta si `NO_WIZARD=1`): pregunta modo APPLIANCE/VPS, slug, URL del repo, token de CF Tunnel (opcional), ruta a la licencia `.lic` (opcional).
4. **Validación de la config**.
5. **Resto de dependencias del host**: `git`, `python3`, `openssl`, `jq`.
6. **Docker Engine + Compose** desde el repo oficial. Agrega al usuario al grupo `docker`.
7. **Secrets**: genera `POSTGRES_PASSWORD`, `JWT_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, `DASHBOARD_PASSWORD`. Genera `ANON_KEY` y `SERVICE_ROLE_KEY` firmados HS256.
8. **Supabase**: clona `supabase/supabase` en `/opt/supabase`, configura `.env`, crea `docker-compose.override.yml` para el auth hook.
9. **Patch `kong.yml`**: agrega paths con prefijo `/supabase/*` (necesario para Realtime via CF Tunnel).
10. **Levantar Supabase**: `compose up -d` + wait hasta que responda.
11. **CRM**: clona el repo público, genera `.env.docker` con `NEXT_PUBLIC_FIDCORE_MODO`. Aplica permisos UID 1000 (`node`) a `storage/`, `tmp/`, `/var/backups/crm-seguros/`.
12. **Migraciones SQL** (`scripts/aplicar-migraciones.sh`).
13. **Build + arranque del CRM**.
14. **Activación del auth hook** (reinicia container `auth` de Supabase).
15. **Cloudflare Tunnel**: si `TUNNEL_TOKEN` está, levanta el container `cloudflared` y espera el "Registered tunnel connection".
16. **APPLIANCE-only**: copia `sistema-trigger.sh` al host, crea `/etc/sudoers.d/fidcore-sistema` (nombre del archivo de sistema, no se rebrandeó para compatibilidad con instalaciones existentes) con NOPASSWD shutdown/reboot (validado con `visudo -c`), registra el cron del usuario.
17. **Cron de updates**: registra el cron de `actualizacion-trigger.sh` en el crontab del usuario (ambos modos).
18. **Tailscale** (APPLIANCE + opcional): si `TAILSCALE_AUTHKEY` está, instala Tailscale + `tailscale up` + disable systemd para que quede apagado.
19. **Smoke test**: curl al CRM local, conteo de containers, si CF está activo curl al dominio público, verifica cron registrado.
20. **Resumen final** con hand-off al PAS.

## Modos de uso

### One-liner curl-bash (recomendado para servidores frescos)

Server fresh con Ubuntu 22.04/24.04. Una sola línea, sin auth ni descargas previas:

```bash
curl -fsSL https://raw.githubusercontent.com/Pulzar-crm/crm/main/installer/quick-install.sh | sudo bash
```

`quick-install.sh` instala `git`, clona el repo público en `/tmp/fidcore-installer` y dispara el `install.sh`. Después arranca el wizard interactivo.

### Manual (si ya tenés el repo clonado)

```bash
cd /ruta/al/repo/installer
sudo bash install.sh
```

### No-interactivo (CI / scripts / re-instalaciones)

```bash
sudo NO_WIZARD=1 \
  SLUG_CLIENTE=juanperez \
  MODO_INSTALACION=APPLIANCE \
  bash install.sh
```

`CRM_REPO_URL` ahora tiene default a `https://github.com/Pulzar-crm/crm.git` (público, sin auth). Solo seteala si querés clonar un fork o una rama de testing.

### Mixto (algunas vars por env, el wizard pregunta el resto)

```bash
sudo SLUG_CLIENTE=juanperez bash install.sh
```

## El wizard interactivo

5 pantallas con `gum`:

1. **Tipo de instalación** — selector APPLIANCE (mini PC) vs VPS.
2. **Slug del cliente** — texto con validación regex `[a-z0-9-]+`.
3. **URL del repo del CRM** — texto con PAT embebido si es privado.
4. **CF Tunnel (opcional)** — confirma "¿tenés token?" + input (campo password).
5. **Licencia `.lic` (opcional)** — confirma + ruta a archivo.

Al final muestra un resumen y pide confirmación antes de arrancar la instalación real.

## Lo que SIGUE quedando para el PAS (no se automatiza por diseño)

Estas son cosas que el PAS configura **desde el CRM** después de que el instalador termina. No se automatizan porque los datos son del PAS, no del técnico:

- **Crear el usuario admin** — `${URL_PUBLICA}/setup` (paso obligatorio antes de usar el CRM).
- **Nombre, logo, color de marca** — `/crm/configuracion/perfil`.
- **SMTP** — `/crm/configuracion/correos` (para que el CRM mande emails).
- **Anthropic API key** — `/crm/configuracion/agente-ia` (opcional, activa el módulo IA).
- **rclone** — `/crm/configuracion/backups` (opcional, sync de backups a Drive).
- **Licencia `.lic`** — `/crm/configuracion/licencia` (la sube el PAS, vos se la generás).

## Lo que se podría automatizar a futuro

- **Carga automática de la licencia `.lic`** — hoy la ruta queda mostrada en el resumen pero el PAS la sube a mano. Para automatizarlo habría que insertarla en DB con SQL directo.
- **Configuración de rclone via service account de Google** — hoy requiere OAuth con browser.
- **Generación del PAT del repo** — manual desde el panel de GitHub.

## Requisitos previos

- Ubuntu Server 22.04 o 24.04 (limpio).
- Usuario regular con permiso de sudo (no root directo).
- Conectividad a github.com.
- **Slug del cliente** ya decidido (ej: `juanperez`). Solo `[a-z0-9-]`, no se cambia después.

El repo del CRM es **público** (`github.com/Pulzar-crm/crm`) — no necesitás PAT ni auth. La protección del código está en el sistema de licencias Ed25519, no en el control de acceso al código.

## Variables de configuración

### Wizard pregunta (o seteables por env vars para saltar la pregunta)

| Var | Descripción |
|---|---|
| `SLUG_CLIENTE` | Identificador del cliente. |
| `MODO_INSTALACION` | `APPLIANCE` o `VPS`. |
| `CRM_REPO_URL` | URL del repo del CRM. Default: `https://github.com/Pulzar-crm/crm.git`. Solo cambiar para forks o ramas de test. |
| `TUNNEL_TOKEN` | Token de CF Tunnel. Opcional. |
| `LICENCIA_PATH` | Ruta al archivo `.lic`. Opcional. |
| `NO_WIZARD` | Si es `1`, salta el wizard. Las vars de arriba deben venir por env. |
| `TAILSCALE_AUTHKEY` | Auth-key de Tailscale (`tskey-...`). Solo APPLIANCE. Si está, instala Tailscale apagado. Si no, salta. |

### Defaults (no se preguntan)

| Var | Default | Descripción |
|---|---|---|
| `DOMINIO_BASE` | `fidcore.com.ar` | Subdominio final: `<slug>.<dominio>`. |
| `INSTALACION_DIR_SUPABASE` | `/opt/supabase` | Ruta de clonado. |
| `INSTALACION_DIR_CRM` | `/opt/crm-fidcore` | Ruta de clonado. |
| `BACKUPS_DIR` | `/var/backups/crm-seguros` | Carpeta de backups. |
| `CRM_REPO_BRANCH` | `main` | Branch del CRM a clonar. |
| `SUPABASE_REPO_URL` | `https://github.com/supabase/supabase.git` | Repo oficial. |
| `KONG_HTTP_PORT` | `8001` | Puerto de Kong en LAN. |
| `USUARIO_INSTALACION` | `$SUDO_USER` | Usuario dueño de las carpetas. |
| `LOG_FILE` | `/tmp/fidcore-install-<timestamp>.log` | Archivo de log. |

## Output

- Progreso en stdout con colores (`output.sh`).
- Log completo en `/tmp/fidcore-install-<timestamp>.log`.
- Si una fase falla, sale con código 1 e indica qué pasó.

## Idempotencia

- Si Supabase o el CRM ya están clonados, no los re-clona.
- Si Docker ya está instalado, lo detecta.
- Si gum ya está instalado, lo detecta.
- Las migraciones SQL son idempotentes.

Para re-instalar desde cero:

```bash
cd /opt/supabase/docker && docker compose down -v
cd /opt/crm-fidcore && docker compose down -v
sudo rm -rf /opt/supabase /opt/crm-fidcore /var/backups/crm-seguros
```

## Estructura

```
installer/
├── quick-install.sh        # Wrapper curl-bash (descarga el repo + lanza install.sh)
├── install.sh              # Entry point con 20 fases
├── lib/
│   ├── output.sh           # Helpers de log con colores
│   ├── instalar-gum.sh     # Instala gum si no está
│   ├── wizard.sh           # Funciones interactivas con gum
│   └── generar-jwt.py      # Genera ANON_KEY/SERVICE_ROLE_KEY HS256
└── README.md
```

## Próximos hitos

- **Fase 3 — Configuración de red + APPLIANCE-only**: levantar `cloudflared` con el token, Tailscale, sudoers + cron del `sistema-trigger.sh`.
- **Fase 4 — Smoke test final**: chequeos automáticos al cierre (login, Realtime via CF, etc.).

## Soporte

Si una instalación falla, recopilar:

1. El log de `/tmp/fidcore-install-*.log`.
2. `docker ps -a` y `docker compose ps` (desde `/opt/supabase/docker` y `/opt/crm-fidcore`).
3. Logs de los containers críticos: `docker logs fidcore-crm`, `docker logs supabase-kong`.
