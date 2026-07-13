# FidCore — CRM para Productores Asesores de Seguros

[![Status](https://img.shields.io/badge/status-en%20producción-success)]()
[![Node](https://img.shields.io/badge/Node.js-20-339933)]()
[![Next.js](https://img.shields.io/badge/Next.js-14-black)]()
[![License](https://img.shields.io/badge/license-Proprietary-red)](./LICENSE)

CRM profesional para Productores Asesores de Seguros (PAS) argentinos.
Diseñado para gestión integral de cartera, pólizas, siniestros,
renovaciones, comunicaciones con clientes y operación comercial.

> **Producto comercial.** El código está disponible públicamente con fines
> de auditoría e inspección. El uso requiere licencia válida.
> Ver [LICENSE](./LICENSE) y [fidcore.com.ar](https://fidcore.com.ar).

---

## Qué incluye FidCore

- **Cartera y pólizas** — Personas físicas y jurídicas, pólizas de todos
  los ramos (Automotor, Hogar, Vida, Comercio, etc.), riesgos con
  detalle técnico por ramo, cadena de renovaciones histórica.
- **Siniestros** — Numeración automática, máquina de estados
  (Denunciado → Inspección → Liquidación → Reparación → Finalizado),
  bitácora cronológica, gestión de archivos por caso.
- **Renovaciones** — Detección automática de vencimientos, generación
  de pólizas hijas, transición automática de estado al activarse.
- **Comercial** — Leads, oportunidades, cotizaciones, pipeline kanban,
  embudo de conversión con métricas por etapa.
- **Comunicaciones** — Sistema de email con plantillas editables,
  cola de envío con prioridades, anti-spam, tracking de aperturas y clicks,
  retención automática del historial.
- **Portal del Asegurado** — Acceso público (sin contraseña) donde el
  asegurado consulta sus pólizas, siniestros y descarga documentación.
- **Formulario público de denuncia** — El cliente denuncia siniestros
  desde un link público con magic-pre-fill desde el portal.
- **Importador IA** — Procesamiento de Excel/CSV de carteras existentes
  con análisis IA, validación, deduplicación y reconciliación incremental.
- **Agente IA de PDFs** — Carga pólizas y endosos a partir del PDF de
  la compañía mediante extracción asistida por Claude.
- **Sistema de backups** — Archivos `.crmbak` portables (DB + storage),
  retención configurable, sync remoto opcional con Cloudflare R2 / Google Drive.
- **Telemetría** — Reporting de errores críticos vía Sentry.
- **Multi-usuario con cartera** — Roles ADMIN / USUARIO con filtro
  de cartera (PROPIA / TOTAL).

## Tecnologías

| Capa | Stack |
|------|-------|
| Frontend | Next.js 14 (App Router) · TypeScript · Tailwind CSS · shadcn/ui · Lucide |
| Backend  | Next.js API Routes · Supabase self-hosted |
| DB       | PostgreSQL 15 (en container Supabase) |
| Auth     | Supabase Auth (GoTrue) · JWT HS256 |
| Realtime | Supabase Realtime (WebSockets) |
| Storage  | Filesystem local con backups `.crmbak` |
| Email    | SMTP configurable (cualquier provider) |
| IA       | Anthropic Claude (módulo opcional) |
| Infra    | Docker Compose · Cloudflare Tunnel · Tailscale (opcional para soporte) |

## Modelo de distribución

FidCore se distribuye como **appliance**: un mini-PC pre-configurado que
se instala en el escritorio del PAS o en su oficina. La instalación la
realiza FidCore. El cliente recibe:

- Hardware listo para usar
- Acceso vía LAN (con o sin internet) y vía dominio público con Cloudflare Tunnel
- Actualizaciones automáticas opcionales desde este repositorio
- Soporte técnico anual

Para consultas comerciales: [fidcore.com.ar](https://fidcore.com.ar)

## Auditoría y seguridad

- **RLS real** habilitada en ~30 tablas críticas con `auth.uid()` y custom claims.
- **JWT verificado** server-side con secret HMAC-SHA256.
- **Encriptación AES-256-GCM** para credenciales SMTP y API keys almacenadas.
- **Licencias Ed25519 offline** (firma asimétrica) — sin servidor de
  licencias online, sin dependencia de FidCore para operar.
- **Rate limiting** en endpoints públicos.
- **Magic bytes** validados en uploads de archivos.
- **Path traversal** prevenido en endpoints de archivos.
- **CSP** y headers de seguridad en producción.
- **Backups encriptables** y portables.

Reportes de seguridad: [seguridad@fidcore.com.ar](mailto:seguridad@fidcore.com.ar).

## Licencia

Software propietario. Ver [LICENSE](./LICENSE).

El código está expuesto públicamente para transparencia. El uso, copia,
modificación o redistribución requieren licencia válida emitida por
FidCore mediante el sistema de claves Ed25519 incluido.

---

© 2026 FidCore. Todos los derechos reservados.
