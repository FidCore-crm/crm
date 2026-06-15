# syntax=docker/dockerfile:1.7
# ============================================================================
# FidCore CRM — Dockerfile multi-stage
#
# Base: node:20-bookworm-slim (Debian 12). Elegido sobre alpine porque:
#   - Debian 12 trae postgresql-client-15 nativo (apt), match exacto con
#     el server de Supabase self-hosted (15.8). pg_dump/psql versión idéntica
#     evita warnings y posibles incompatibilidades de sintaxis al restaurar.
#   - glibc en runtime evita el riesgo de bindings nativos compilados contra
#     musl rompiendo entre stages (sharp, bcrypt, etc.).
#   - numfmt y otras herramientas GNU vienen sin instalar nada extra.
#
# Stages:
#   - deps:    npm ci con package.json + package-lock.json
#   - builder: next build (genera .next/standalone)
#   - runner:  imagen final mínima con node + binarios runtime
# ============================================================================

# ---------- Stage 1: deps ----------
FROM node:20-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund


# ---------- Stage 2: builder ----------
FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time args para inlinear las NEXT_PUBLIC_* en el bundle del browser.
# Next.js sustituye `process.env.NEXT_PUBLIC_*` por sus valores literales SOLO
# si están presentes en el environment durante `next build`. Si no están, el
# bundle queda con `process.env.X` sin valor → undefined en el browser.
ARG NEXT_PUBLIC_SUPABASE_URL=
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=
ARG NEXT_PUBLIC_SENTRY_DSN=
ARG NEXT_PUBLIC_STACK_LABEL=
# NEXT_PUBLIC_APP_VERSION se lee de package.json en next.config.js — no se
# pasa más como ARG para evitar que un default del entorno pise el valor real.
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_PUBLIC_STACK_LABEL=$NEXT_PUBLIC_STACK_LABEL \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build


# ---------- Stage 3: runner ----------
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    RUNNING_IN_DOCKER=true

# Binarios runtime que el CRM ejecuta via child_process / scripts bash:
#   - postgresql-client-15: pg_dump, psql para backups y restauraciones
#                           (match exacto con Supabase server 15.8)
#   - rclone:               sync de backups a Google Drive del PAS
#   - tini:                 init mínimo para reapear zombies en containers tipo cron
#   - curl, ca-certificates: HTTPS contra Sentry/Anthropic + polling de crons
#   - tar, gzip, bash, coreutils: ya vienen en la base bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      gnupg \
      postgresql-client-15 \
      rclone \
      tini \
 && rm -rf /var/lib/apt/lists/*

# Usamos el usuario `node` (UID/GID 1000) que ya viene en la imagen base
# `node:20-bookworm-slim`. Coincide con el primer usuario no-root del host
# Ubuntu (convención: Debian/Ubuntu siempre crea el primer usuario con UID 1000).
# Esto evita problemas de permisos en bind mounts (storage/, tmp/, backups/)
# sin necesidad de `chown` post-instalación con UIDs especiales.

# Copiar el build standalone — Next.js incluye solo lo que usa el server.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# Copiar scripts y migraciones que el runtime necesita (los scripts de backup
# se ejecutan via execAsync bash, las migraciones se aplican al boot).
COPY --from=builder --chown=node:node /app/scripts ./scripts
COPY --from=builder --chown=node:node /app/sql ./sql

# Crear carpetas que el runtime espera con permisos correctos.
RUN mkdir -p /app/storage /app/tmp \
 && chown -R node:node /app/storage /app/tmp

USER node

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
