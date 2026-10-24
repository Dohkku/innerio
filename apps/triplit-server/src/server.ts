/**
 * Production-style Triplit sync server, runs on Bun.
 *
 * Differs from `bunx triplit dev` in:
 *  - Persistent storage (SQLite file in TRIPLIT_DATA_DIR)
 *  - JWT secret loaded from env (deterministic across restarts)
 *  - No console UI; logs go to stdout in JSON for log shipping
 *
 * Phase 2 (ADR-013): now also hosts Better Auth at `/api/auth/*` plus a
 * `/api/auth/triplit-token` endpoint that issues HS256 JWTs signed with
 * `TRIPLIT_JWT_SECRET` (claim shape: `{ sub, user_id }`, no token-type so
 * Triplit treats it as external and applies per-user permission rules from
 * the shared schema). Single Bun process, single port — Hono routes
 * everything.
 */
import { schema as collections, roles } from '@gtd/schema';
import { createTriplitHonoServer } from '@triplit/server/hono';
import { createTriplitStorageProvider } from '@triplit/server/storage';
import { type Context, Hono, type Next } from 'hono';
import { createBunWebSocket } from 'hono/bun';
import { cors } from 'hono/cors';
import { SignJWT } from 'jose';
import { auth, authDb, runAuthMigrations } from './auth.js';
import { mountCryptoEnvelope } from './crypto-envelope.js';
import { noStore, rateLimitPerIP, rateLimitPerSession } from './middleware.js';
import { mountPairApi } from './pair-api.js';
import { mountQuotas } from './quotas-api.js';
import { runQuotaMigrations } from './quotas.js';
import { mountSecretPhrasesApi } from './secret-phrases.js';

const PORT = Number(process.env.PORT ?? 6543);
const JWT_SECRET = process.env.TRIPLIT_JWT_SECRET;
const PROJECT_ID = process.env.TRIPLIT_PROJECT_ID ?? 'gtd-self-hosted';
const STORAGE_KIND = process.env.TRIPLIT_STORAGE ?? 'sqlite';
const TRIPLIT_TOKEN_TTL = process.env.TRIPLIT_TOKEN_TTL ?? '15m';

// Triplit reads this env var internally; set a default so callers don't have to.
process.env.LOCAL_DATABASE_URL ??= './data/triplit.db';

if (!JWT_SECRET) {
  console.error('Missing TRIPLIT_JWT_SECRET. Generate one with: openssl rand -hex 32');
  process.exit(1);
}
if (JWT_SECRET.length < 32 || JWT_SECRET === 'change-me-to-a-32-byte-hex') {
  console.error(
    'TRIPLIT_JWT_SECRET is too short or is the .env.example placeholder. Refusing to start. Generate a real one with: openssl rand -hex 32',
  );
  process.exit(1);
}

const storage = await createTriplitStorageProvider(STORAGE_KIND as 'sqlite' | 'lmdb' | 'memory');

await runAuthMigrations();
runQuotaMigrations(authDb);

const SECRET_PHRASES_FILE = process.env.SECRET_PHRASES_FILE ?? '/etc/innerio/secret-phrases.txt';

const app = new Hono();

// CORS for cross-origin web client (Pages → tunnel API). Better Auth applies its
// own trustedOrigins on /api/auth/sign-in/* etc, but our custom endpoints
// (/api/auth/config, /api/auth/triplit-token, /api/auth/crypto-envelope)
// need explicit CORS so the browser sends/receives
// credentials cross-site.
//
// CSRF posture under SameSite=None (audit N-7, 2026-05-01):
//   Better Auth's session cookie is `SameSite=None; Secure; HttpOnly` because
//   web (Pages) and API (tunnel) live on different hostnames. That cookie IS
//   sent on every cross-origin request from any tab in any origin. Two layers
//   guard the surface:
//
//   (1) Better Auth's `originCheckMiddleware` (auth.ts trustedOrigins) rejects
//       any POST to `/api/auth/sign-in/*` etc whose Origin != WEB_ORIGIN.
//   (2) The CORS preflight below blocks cross-origin JSON POST/PUT/DELETE
//       at the browser layer: a non-WEB_ORIGIN page asking for those methods
//       with `Content-Type: application/json` triggers preflight, server
//       responds Access-Control-Allow-Origin: WEB_ORIGIN, browser cancels.
//
// Rule for new endpoints: any state-changing route MUST be a "non-simple"
// CORS request — i.e. method != GET/HEAD/POST OR Content-Type other than
// application/x-www-form-urlencoded / multipart/form-data / text/plain.
// Sticking to JSON POST/PUT/DELETE achieves that. Do NOT add side-effecting
// GET routes (CSRF-able via <img>/<script src>); do NOT accept text/plain
// POST bodies (bypass preflight). If unsure, add an explicit CSRF token.
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
const isDev = process.env.NODE_ENV !== 'production';
// Origins de las apps nativas (Capacitor WebView). Android sirve los assets
// desde https://localhost; iOS desde capacitor://localhost. Son seguros en la
// allowlist: el WebView fija el Origin real, una página web no puede falsificar
// `Origin: https://localhost`. Sin esto, la app no puede llamar a /api/* (login
// ni sync) por CORS. Ver ADR-036. `app://innerio` = app de escritorio
// (Electron, apps/desktop), ADR-039.
const NATIVE_ORIGINS = ['https://localhost', 'capacitor://localhost', 'app://innerio'];
function corsOrigin(o: string): string | null {
  if (o === WEB_ORIGIN || NATIVE_ORIGINS.includes(o)) return o;
  if (isDev && o.startsWith('http://localhost:')) return o;
  return null;
}
app.use(
  '/api/*',
  cors({
    origin: corsOrigin,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
);

// Logo for transactional emails (email-templates.ts). Served from here so
// mail clients can load it even when the web frontend isn't deployed.
const emailLogo = await Bun.file(new URL('../assets/innerio-logo.png', import.meta.url)).bytes();
app.get('/email/innerio-logo.png', (c) =>
  c.body(emailLogo, 200, {
    'Content-Type': 'image/png',
    'Cache-Control': 'public, max-age=604800',
  }),
);

// Desktop packages (apps/desktop, ADR-040). ~90 MB each, too big for the
// Vercel landing, so they live in a host folder bind-mounted read-only at
// DESCARGAS_DIR. The landing's /descargar/linux redirects here and the
// desktop updater downloads from here after checking the landing's
// version.json. Only files matching the package name pattern are served.
const DESCARGAS_DIR = process.env.DESCARGAS_DIR ?? '/descargas';
const PAQUETE = /^Innerio-\d+\.\d+\.\d+-linux-x64\.tar\.xz$/;
app.get('/descargas/:file', async (c) => {
  const name = c.req.param('file');
  if (!PAQUETE.test(name)) return c.text('not found', 404);
  const file = Bun.file(`${DESCARGAS_DIR}/${name}`);
  if (!(await file.exists())) return c.text('not found', 404);
  return new Response(file, {
    headers: {
      'Content-Type': 'application/x-xz',
      'Content-Length': String(file.size),
      'Content-Disposition': `attachment; filename="${name}"`,
      // Versioned names never change content.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});

// Public discovery endpoint — lets the web client know which login methods to render.
const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
app.get('/api/auth/config', (c) =>
  c.json({
    providers: { google: googleEnabled },
    features: { magicLink: true },
  }),
);

// Clear-Site-Data on sign-out + delete-user. The auth cookie lives on the API
// origin (innerio-api.dohkku.dev), which is cross-origin from the web app
// (innerio.dohkku.dev), so a user clicking the browser's "Clear site data" on
// the web origin can't reach this cookie. Returning Clear-Site-Data on these
// endpoints tells the browser to wipe cookies + storage + cache on the API
// origin itself, guaranteeing the session is gone even if the web client's
// follow-up cleanup never runs. Wiping the web origin's IDB is the client's
// job (signOut → cryptoStore.reset; account-delete → wipeLocalDatabase) —
// Clear-Site-Data on a cross-origin response only affects the response's
// origin per spec.
//
// Guarded by status 2xx: a failed sign-out shouldn't wipe credentials.
async function clearSiteDataOnSuccess(c: Context, next: Next) {
  await next();
  if (c.res.status >= 200 && c.res.status < 300) {
    const headers = new Headers(c.res.headers);
    headers.append('Clear-Site-Data', '"cookies", "storage", "cache"');
    c.res = new Response(c.res.body, {
      status: c.res.status,
      statusText: c.res.statusText,
      headers,
    });
  }
}
app.use('/api/auth/sign-out', clearSiteDataOnSuccess);
app.use('/api/auth/sign-out/*', clearSiteDataOnSuccess);
app.use('/api/auth/delete-user', clearSiteDataOnSuccess);

// Cache-Control + rate limit en los endpoints custom (audit M-2 + A-2,
// 2026-05-21). Better Auth's wildcard `/api/auth/*` aporta su propio rate
// limit y caching para sign-in/verify/etc, pero las rutas que montamos a
// mano por encima del wildcard quedan fuera de ese paraguas. `noStore`
// evita que un futuro proxy cachee respuestas que contienen secretos
// (JWT efímero, envelope, quota). `rateLimitPerSession` token-bucket por
// session.user.id corta loops de un usuario autenticado que abusen del
// endpoint (reconcile, mint, etc).
const tokenRoutes = ['/api/auth/triplit-token', '/api/auth/crypto-envelope', '/api/quotas'];
for (const path of tokenRoutes) app.use(path, noStore);
app.use(
  '/api/auth/triplit-token',
  rateLimitPerSession({ name: 'triplit-token', max: 60, windowMs: 60_000 }),
);
app.use(
  '/api/auth/crypto-envelope',
  rateLimitPerSession({ name: 'crypto-envelope', max: 30, windowMs: 60_000 }),
);
app.use(
  '/api/auth/pair-mint',
  rateLimitPerSession({ name: 'pair-mint', max: 10, windowMs: 60_000 }),
);
app.use('/api/quotas', rateLimitPerSession({ name: 'quotas', max: 30, windowMs: 60_000 }));

// Login endpoints: Better Auth limits per client IP (auth.ts). This caps
// per connecting IP so a direct caller forging x-vercel-forwarded-for
// still hits a ceiling; legit traffic spreads over several Vercel egress
// IPs and stays far below it.
for (const path of ['/api/auth/sign-in/*', '/api/auth/magic-link/*']) {
  app.use(path, rateLimitPerIP({ name: 'auth-origin', max: 60, windowMs: 60_000, by: 'origin' }));
}

// Easter egg de /settings (5 clicks en "42"). Endpoint público (también
// accesible en demo mode), rate-limit por IP para acolchar la enumeración
// del catálogo via devtools: 6 req/min y 50 req/hora hacen que volcar la
// tabla completa tome lo bastante como para que no merezca la pena.
app.use('/api/secret/phrase', noStore);
app.use(
  '/api/secret/phrase',
  rateLimitPerIP({ name: 'secret-phrase-min', max: 6, windowMs: 60_000 }),
);
app.use(
  '/api/secret/phrase',
  rateLimitPerIP({ name: 'secret-phrase-hour', max: 50, windowMs: 60 * 60_000 }),
);
mountSecretPhrasesApi(app, SECRET_PHRASES_FILE);

// Issue a Triplit-compatible JWT for the current Better Auth session.
// Registered before the /api/auth/* wildcard so it wins on exact match.
const triplitSecretKey = new TextEncoder().encode(JWT_SECRET);
app.get('/api/auth/triplit-token', async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'not_authenticated' }, 401);
  const userId = session.user.id;
  // No `x-triplit-token-type` claim → Triplit treats this as an external JWT
  // and applies the per-user permission rules defined in @gtd/schema. The
  // shared admin-client (server-internal, with `'secret'` claim) bypasses
  // rules — used by Better Auth's afterDelete cascade and cryptoEnvelope.
  const token = await new SignJWT({
    user_id: userId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(TRIPLIT_TOKEN_TTL)
    .sign(triplitSecretKey);
  return c.json({ token, user_id: userId });
});

// E2EE wrapped DEK envelope (Phase 9 slice 2, ADR-017). Registered before
// the /api/auth/* wildcard so the specific route wins on exact match.
mountCryptoEnvelope(app);

// Quotas API (Phase 2 revival, ADR-032). /api/quotas con bytes_used +
// items_count + tier para el cliente. Reconcilia on-demand contra Triplit.
mountQuotas(app, authDb);

// QR pair-mint (Phase 4 revival sin email). Devuelve una verify URL de
// magic-link sin enviar email — el PC la embute en el QR para que el móvil,
// al escanear, abra la URL y autentique en un solo paso.
mountPairApi(app);

// Better Auth handles every other /api/auth/* route (sign-in, callback, session, ...).
app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

const { upgradeWebSocket, websocket } = createBunWebSocket();
const { fetch } = await createTriplitHonoServer(
  {
    storage: () => storage,
    jwtSecret: JWT_SECRET,
    projectId: PROJECT_ID,
    verboseLogs: process.env.TRIPLIT_VERBOSE === '1',
    // Pass the shared schema + per-user role definitions so the server
    // enforces row-level permissions (C-1 fix from 2026-04-29 audit).
    // Without this block, hono.js loads schemaless and no rule applies.
    dbOptions: {
      schema: { collections, roles },
    },
  },
  upgradeWebSocket,
  undefined,
  app,
);

Bun.serve({ fetch, websocket, port: PORT });

console.log(JSON.stringify({ msg: 'triplit + auth up', port: PORT, projectId: PROJECT_ID }));
