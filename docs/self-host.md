# Self-hosting GTD

This guide covers two paths. **Path A** runs the web app locally with no server at all — data lives in your browser's IndexedDB, nothing leaves your machine, and it works offline indefinitely. **Path B** adds the sync server and auth layer so you can sign in, sync across devices, and optionally connect AI agents via MCP. Both paths are local-first: the server is a sync peer, not a source of truth. The project is pre-1.0; the schema may evolve between releases.

---

## 1. Prerequisites

- **Bun 1.3+** — install from [bun.sh](https://bun.sh) or `curl -fsSL https://bun.sh/install | bash` on Linux/macOS.
- **Docker + Docker Compose** — required for Path B option 1 (Docker); optional otherwise.
- **Cloudflare tunnel** or **Caddy** — optional, for exposing the server over HTTPS without managing TLS manually.

Confirm Bun is available:

```bash
bun --version
```

---

## 2. Path A: web app, local-only (about 5 minutes)

All data is stored in browser IndexedDB. No account, no server, no network traffic.

```bash
git clone https://github.com/dohkku/gtd_solution.git
cd gtd_solution
bun install
cd apps/web
bun run dev
```

Open `http://localhost:5173`.

- Export or import your data any time from `/settings/data` (JSON bundle of items + areas + settings + methodology + reviews).
- To clear all data: DevTools → Application → IndexedDB → delete the Triplit DB → reload.

---

## 3. Path B: full stack with sync and auth (about 15 minutes)

### 3.1 Clone and install

```bash
git clone https://github.com/dohkku/gtd_solution.git
cd gtd_solution
bun install
```

### 3.2 Generate secrets

```bash
openssl rand -hex 32   # use the output as TRIPLIT_JWT_SECRET
openssl rand -hex 32   # use the output as BETTER_AUTH_SECRET
```

### 3.3 Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in at minimum:

```dotenv
TRIPLIT_JWT_SECRET=<output from first openssl command>
BETTER_AUTH_SECRET=<output from second openssl command>
WEB_ORIGIN=http://localhost:5173
```

The remaining vars in `.env.example` (Postgres, Caddy, SMTP, Google) are all optional and explained in their comment lines.

### 3.4 Start the sync server

**Option 1 — Docker (recommended for production)**

```bash
docker compose up -d
```

This starts the `triplit` service (Bun + SQLite) on port 6543. Data is persisted in the `triplit-data` Docker volume.

**Option 2 — Bun directly (simpler for development)**

Terminal 1:

```bash
cd apps/triplit-server
TRIPLIT_JWT_SECRET=<your-secret> \
BETTER_AUTH_SECRET=<your-secret> \
WEB_ORIGIN=http://localhost:5173 \
bun run dev
```

The server logs a JSON line on startup and listens on `:6543`.

Terminal 2:

```bash
cd apps/web
bun run dev
```

### 3.5 Point the web app at the sync server

Create `apps/web/.env.local`:

```dotenv
VITE_TRIPLIT_SERVER=http://localhost:6543
VITE_AUTH_SERVER=http://localhost:6543
```

Do not add a hardcoded token here. Auth is session-based (Better Auth → JWT minted per login).

Restart `bun run dev` in `apps/web` after creating the file; Vite picks up `.env.local` on startup.

### 3.6 First login

Open `http://localhost:5173/login`.

- **Magic link**: enter your email and submit. The server emails you a link if `SMTP_HOST` + `SMTP_USER` + `SMTP_PASS` are set. Without them, the link is printed to the server's stdout (look for a JSON line with `"msg":"magic link (dev console mode — no SMTP configured)"`). Copy the URL, paste it in the browser.
- **Google OAuth**: the button appears only when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set on the server.

After signing in, anonymous local data is adopted into your account automatically (one-time migration).

### 3.7 Verify sync

1. Sign in on two different browsers (or one normal + one private window).
2. Capture an item in one. It should appear in the other within a few seconds.
3. The sync status pill in the top nav should show "online" in both windows.

---

## 4. Optional: production hardening

<details>
<summary>Cloudflare Tunnel from a home PC (recommended for ≤50 users)</summary>

Architecture: the Triplit + Better Auth server runs on your local machine inside Docker (bound to `127.0.0.1:6543`). `cloudflared` opens an outbound-only persistent connection to Cloudflare's edge; users hit `https://innerio.example.com` which Cloudflare proxies into your tunnel. No inbound ports on your router. TLS is handled by Cloudflare. Your home IP is not leaked.

The web app itself can be served by Cloudflare Pages (static, free) or by the same tunnel — either works.

#### 1. Cloudflare prerequisites

- A domain on Cloudflare (free plan is fine).
- The Cloudflare API allows Tunnels for free; you do not need a paid plan.

#### 2. Install `cloudflared` on the host

Linux/macOS instructions: see the [official guide](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/). On Debian/Ubuntu:

```bash
curl -L https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
```

#### 3. Authenticate and create a named tunnel

```bash
cloudflared tunnel login                   # opens browser, picks the zone
cloudflared tunnel create innerio          # creates the tunnel, prints UUID
cloudflared tunnel route dns innerio innerio.example.com  # creates the CNAME
```

The credentials JSON lands in `~/.cloudflared/<UUID>.json`. Keep it secret.

#### 4. Tunnel config

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <UUID>
credentials-file: /home/<you>/.cloudflared/<UUID>.json

ingress:
  # Auth + sync: routed to the local Triplit container (loopback-bound).
  - hostname: innerio.example.com
    service: http://localhost:6543
    originRequest:
      # Triplit's WebSocket sync needs HTTP/1.1 upgrades to pass through.
      noTLSVerify: true
  - service: http_status:404
```

Run as a systemd service (recommended) so it survives reboots:

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

#### 5. Bring up the Triplit + Better Auth container

```bash
cp .env.example .env
# Edit .env: replace BOTH placeholders with real secrets.
openssl rand -hex 32   # for TRIPLIT_JWT_SECRET
openssl rand -hex 32   # for BETTER_AUTH_SECRET
# Set WEB_ORIGIN=https://innerio.example.com (the Cloudflare hostname)
# Set SMTP_HOST/PORT/USER/PASS/FROM if you want real magic-link emails (e.g. Hostinger, Fastmail, any standard SMTP).
docker compose up -d
```

The container binds the Triplit port to `127.0.0.1:6543` only (loopback) — `cloudflared` reaches it via the host network, but no LAN device can. The server refuses to start if either secret is the placeholder or shorter than 32 chars.

#### 6. Web app

Two options:

**Option A — Cloudflare Pages** (recommended, free, fast):
1. `cd apps/web && bun run build` produces `build/`.
2. Push to a Git repo connected to Cloudflare Pages.
3. Set the custom domain (e.g. `app.innerio.example.com`).
4. In `.env` of the Pages project, set `VITE_TRIPLIT_SERVER=https://innerio.example.com` and `VITE_AUTH_SERVER=https://innerio.example.com`. Both must use `https://` — Triplit's client converts to `wss` internally for the WebSocket sync; passing `wss://` directly throws "Invalid serverUrl provided".

**Option B — same tunnel** (simplest):
1. Add a second `ingress` rule in `~/.cloudflared/config.yml` pointing to a static file server (e.g. `nginx:alpine` serving `apps/web/build/`).
2. Use `app.innerio.example.com` for the web origin and `innerio.example.com` for the API origin (same Cloudflare zone, same TLS).

Either way, set the server's `WEB_ORIGIN` to the **web app's** hostname (NOT the API hostname) — Better Auth uses `WEB_ORIGIN` to validate `Origin` headers and to build magic-link URLs.

#### 7. Hardening (Cloudflare dashboard)

These run at the edge and don't require code changes:

1. **Rate limit on auth signup** (mitigates H-4): Security → WAF → Rate limiting rules.
   - Field: `URI Path`. Operator: `equals`. Value: `/api/auth/sign-in/magic-link`.
   - When request rate exceeds: **3 per minute per IP** → Block for 10 minutes.

2. **Cloudflare Turnstile** on `/login` (optional, defends against bot signups). Add a `<div data-sitekey="...">` to the login page and validate the token server-side before calling `authClient.signIn.magicLink`. Free.

3. **Disk encryption**: enable LUKS (Linux) or BitLocker (Windows) on the partition holding `/var/lib/docker`. Without disk-level crypto, physical access to the PC reads `triplit.db` in plaintext. Email + items + notes all visible.

4. **UPS + auto-restart**: a $40 UPS with `apcupsd` triggers a clean `docker compose stop` on power loss. Combined with `restart: unless-stopped` (already in compose), the service self-heals on reboot. Stops SQLite WAL corruption from mid-write power cuts.

#### 8. Post-deploy smoke checklist

After `docker compose up -d` and the tunnel is connected:

- [ ] `curl https://innerio.example.com/healthcheck` → `OK`.
- [ ] `https://innerio.example.com/api/auth/config` returns `{"providers":{"google":...},"features":{"magicLink":true}}`.
- [ ] Open `https://app.innerio.example.com/login` (or the same hostname depending on option A/B).
- [ ] Magic-link email arrives (check `docker compose logs triplit` for `smtp send error` if not).
- [ ] After click, `/login` redirects to `/`. Sync pill turns "online".
- [ ] Capture an item. It appears immediately.
- [ ] Sign in as user B in another browser/profile. Cross-user smoke (C-1 verification): in user B's DevTools console, `await triplit.fetch(triplit.query('items'))` should return ONLY user B's items, never user A's. If user A's items appear, **the row-scoping fix is not active** — verify the schema package is up to date and the server was rebuilt.
- [ ] `/settings/account` → "Eliminar cuenta" → confirm. Watch the server logs for `account_delete_started` then `account_delete_completed` with row counts. Sign back in with the same email — should be a fresh signup (Better Auth row gone).

#### 9. When to migrate off the home PC

- ≤50 users + occasional reboots: home PC is fine.
- 50–200 users: same, with UPS + automated backups + monthly dependency updates.
- 200+ users or paying customers: spin up a $6/month Hetzner CX22 (or similar). The container + compose file are unchanged. Move the `~/.cloudflared/config.yml` to point at the new origin and update DNS. The data migration is a `docker cp` of the SQLite volumes.

</details>

<details>
<summary>Caddy via Docker Compose (automatic Let's Encrypt TLS)</summary>

1. Copy the example Caddyfile:

   ```bash
   cp Caddyfile.example Caddyfile
   ```

2. Add to `.env`:

   ```dotenv
   DOMAIN=gtd.example.com
   EMAIL=you@example.com
   ```

3. Start with the Caddy profile:

   ```bash
   docker compose --profile caddy up -d
   ```

Caddy handles TLS automatically and reverse-proxies `/api/*` and `/sync/*` to the `triplit` container.

</details>

<details>
<summary>Backup</summary>

Triplit data is stored in a SQLite file inside the `triplit-data` Docker volume.

Inspect it:

```bash
docker compose exec triplit ls /data
```

Copy it out:

```bash
docker cp $(docker compose ps -q triplit):/data/triplit.db ./triplit-backup-$(date +%Y%m%d).db
```

Schedule that command in a cron job or systemd timer for automatic backups. The auth database (`auth.sqlite`) is written inside the container at `./auth.sqlite` relative to `apps/triplit-server`; if you run without Docker, back it up alongside the Triplit DB.

</details>

---

## 5. Updating

```bash
git pull
bun install
docker compose build --no-cache triplit
docker compose up -d
```

The schema is additive by project policy, so there is no manual migration step.

---

## 7. Common problems

**Sync pill shows "offline" forever**
Verify `VITE_TRIPLIT_SERVER` in `apps/web/.env.local` matches the actual URL and port of the running server. Check the server logs for connection errors.

**Magic link email never arrives**
Without `SMTP_HOST` + `SMTP_USER` + `SMTP_PASS`, the link is printed to the server's stdout as a JSON log line, not emailed. Check the terminal running `apps/triplit-server` (or `docker compose logs triplit`). If SMTP is configured but emails still don't arrive, look for `smtp send error` lines — common causes are wrong port (465 = SSL, 587 = STARTTLS), wrong password, or your provider blocking the alias in `SMTP_FROM` (some hosts only allow the auth user as the From address).

**Google OAuth button is missing on /login**
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` must both be set as environment variables on the server. Without them, the button is intentionally hidden.

**"bun: command not found"**
Add Bun to your PATH: `export PATH="$HOME/.bun/bin:$PATH"`. Add this line to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.) to make it permanent.

**Windows-specific gotchas**

- `bun install` does not create `node_modules/.bin/` on Windows. If `bun run dev` fails with "command not found: vite", invoke the binary directly:
  ```bash
  bun apps/web/node_modules/vite/bin/vite.js dev
  ```
- Line endings: run `git config core.autocrlf false` immediately after cloning, before installing. The repo's `.gitattributes` enforces LF everywhere; CRLF will cause Biome to reject files.
- `openssl rand -hex 32` in PowerShell: `[Convert]::ToHexString((1..32 | %{Get-Random -Max 256}))`.

---

## 8. Getting help

See [CONTRIBUTING.md](../CONTRIBUTING.md) for how to report bugs and open pull requests.

For questions and discussion: <TBD — GitHub Discussions URL>
