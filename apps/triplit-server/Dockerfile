FROM oven/bun:1.3-alpine AS base
WORKDIR /app

# Workspace skeleton — `bun install --frozen-lockfile` requires every
# workspace's package.json to be present (the lockfile references all of
# them, even ones we don't need at runtime). Copy them all so the install
# is reproducible; only triplit-server's actual source is brought in below.
COPY package.json bun.lock tsconfig.base.json ./
COPY apps/triplit-server/package.json ./apps/triplit-server/
COPY apps/web/package.json ./apps/web/
COPY apps/mobile/package.json ./apps/mobile/
COPY apps/desktop/package.json ./apps/desktop/
COPY packages/schema/package.json ./packages/schema/
COPY packages/core/package.json ./packages/core/
COPY packages/crypto/package.json ./packages/crypto/

RUN bun install --frozen-lockfile --production

# Now bring in actual sources for the workspaces this image uses at runtime.
COPY packages/schema ./packages/schema
COPY apps/triplit-server ./apps/triplit-server

# Patch upstream Triplit 1.1.10 bun-sqlite adapter: el `freeStatement`
# original devolvía el mismo prepared statement aunque estuviera en uso,
# y al boot del cliente (3-4 CONNECT_QUERY paralelos sobre `items`) eso
# revienta con `bad parameter or other API misuse` en bun:sqlite. El
# script reescribe el adapter para reparar un statement fresh desde el
# SQL cacheado del constructor.
RUN bun apps/triplit-server/scripts/patch-bun-sqlite.ts

WORKDIR /app/apps/triplit-server

# Triplit's kv defaults to ./data/triplit.db (relative to WORKDIR) per server.ts.
# bun:sqlite won't create the parent dir, only the file — so create it here.
RUN mkdir -p /app/apps/triplit-server/data

ENV PORT=6543
ENV TRIPLIT_DATA_DIR=/data
# Pin NODE_ENV so the server's CORS guard (server.ts: isDev = NODE_ENV !== 'production')
# tightens to a single allowed origin in production. Without this the dev-mode
# branch accepts any http://localhost:* with credentials — a XSS or rogue local
# app on a developer's laptop could read /api/auth/triplit-token with the
# session cookie. Audit S1 (2026-05-03).
ENV NODE_ENV=production
VOLUME ["/data"]

# Drop privileges (audit M-1, 2026-04-29). The bun base image runs as root by
# default; if a future bun/dependency CVE leads to RCE inside the container,
# running as a non-root user prevents trivial host-side privilege escalation
# (especially on older kernels without user namespace remapping). The user
# owns /app and /data so writes to triplit.db / auth.sqlite stay possible.
#
# UID / GID 10001 is FIXED so the volume that the host already created
# (originally owned by root from prior deploys) can be chown'd to a known
# value during deploy via `scripts/server-deploy.sh`. Don't change this
# without coordinating a volume migration.
RUN addgroup -S -g 10001 innerio && adduser -S -u 10001 -G innerio innerio \
  && chown -R innerio:innerio /app \
  && mkdir -p /data && chown -R innerio:innerio /data
USER innerio

EXPOSE 6543

CMD ["bun", "src/server.ts"]
