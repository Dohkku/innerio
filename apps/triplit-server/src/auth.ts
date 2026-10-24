/**
 * Better Auth configuration.
 *
 * Self-hostable, single-process auth for the GTD app. Lives alongside the
 * Triplit sync server in the same Bun runtime; both share `TRIPLIT_JWT_SECRET`
 * via the `/api/auth/triplit-token` endpoint in `server.ts`.
 *
 * Plugins are env-conditional so the server runs in any environment:
 *   - Magic link: always on. SMTP transport when `SMTP_HOST` + `SMTP_USER` +
 *     `SMTP_PASS` are set; otherwise the link is logged to stdout (dev mode).
 *   - Google OAuth: only registered when both `GOOGLE_CLIENT_ID` and
 *     `GOOGLE_CLIENT_SECRET` are present.
 *
 * Required env:
 *   - BETTER_AUTH_SECRET    (Better Auth's own session signing secret)
 *   - AUTH_BASE_URL         (public origin where /api/auth/* is reachable)
 *   - WEB_ORIGIN            (web app origin, used for trustedOrigins + redirects)
 *
 * Optional env:
 *   - AUTH_DB_PATH          (defaults to ./auth.sqlite)
 *   - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *   - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *
 * See [[21-phase-2-auth-design]] + ADR-013.
 */
import { Database } from 'bun:sqlite';
import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins/magic-link';
import nodemailer, { type Transporter } from 'nodemailer';
import { getAdminClient } from './admin-client.js';
import { renderMagicLinkEmail } from './email-templates.js';

// `baseURL` is the *public* origin where /api/auth/* is reachable from the
// browser. In dev that's the Vite app at :5173 (proxy forwards /api/auth/* to
// us at :6543); in prod it's the same hostname as the web app sitting behind
// a reverse proxy. Critically NOT the auth server's own port — magic-link
// emails are built from baseURL, and the click must land on the same origin
// where Better Auth's session cookie is stored.
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
const AUTH_BASE_URL = process.env.AUTH_BASE_URL ?? WEB_ORIGIN;
const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;

if (!BETTER_AUTH_SECRET) {
  console.error('Missing BETTER_AUTH_SECRET. Generate one with: openssl rand -hex 32');
  process.exit(1);
}
if (BETTER_AUTH_SECRET.length < 32 || BETTER_AUTH_SECRET === 'change-me-to-a-32-byte-hex') {
  console.error(
    'BETTER_AUTH_SECRET is too short or is the .env.example placeholder. Refusing to start. Generate a real one with: openssl rand -hex 32',
  );
  process.exit(1);
}

export const authDb = new Database(process.env.AUTH_DB_PATH ?? './auth.sqlite');

const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

const smtpConfigured = Boolean(
  process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS,
);

if (process.env.NODE_ENV === 'production' && !smtpConfigured) {
  console.warn(
    '[auth] SMTP not configured in production: magic-link emails will be printed to stdout instead of sent. Users will see "check your email" but no email will arrive. Set SMTP_HOST, SMTP_USER, SMTP_PASS to enable delivery.',
  );
}

let smtpTransport: Transporter | null = null;
function getSmtpTransport(): Transporter {
  if (smtpTransport) return smtpTransport;
  const port = Number(process.env.SMTP_PORT ?? 465);
  smtpTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST!,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASS!,
    },
  });
  return smtpTransport;
}

/**
 * Decide whether this is a fresh signup or a returning signin. We probe
 * Better Auth's own internal adapter — populated from the same auth.sqlite
 * we boot from below — so the answer is authoritative even before the
 * verification token is consumed. A null/undefined `ctx` (which Better
 * Auth's typing allows) falls back to "signin" so the email never tells a
 * new user "welcome back" by accident; signup copy is reserved for cases
 * where we can prove the user did not exist at the time the link was sent.
 */
async function resolveMagicLinkMode(
  email: string,
  // biome-ignore lint/suspicious/noExplicitAny: better-auth's GenericEndpointContext surface is loose
  ctx: any,
): Promise<'signup' | 'signin'> {
  const adapter = ctx?.context?.internalAdapter;
  if (!adapter || typeof adapter.findUserByEmail !== 'function') return 'signin';
  try {
    const existing = await adapter.findUserByEmail(email);
    return existing ? 'signin' : 'signup';
  } catch {
    return 'signin';
  }
}

/**
 * QR-pairing intercept: when `signInMagicLink` is invoked from our internal
 * /api/auth/pair-mint endpoint, the body carries `metadata.pairNonce`. The
 * callback below detects it and delivers the verify URL through this
 * in-memory registry instead of sending an email. This lets the PC embed a
 * one-shot auth grant directly in the QR — the mobile scans, the URL
 * already authenticates, no second email round-trip.
 *
 * Security: the registry is in-process and entries are auto-evicted after
 * the request that registered them resolves/times out. The pair-mint
 * endpoint is session-gated and forces email = session.user.email so a
 * compromised PC session can only mint links to its own email.
 */
export const pendingPairUrls = new Map<string, (url: string) => void>();

async function sendMagicLinkEmail(
  { email, url, metadata }: { email: string; url: string; metadata?: Record<string, unknown> },
  // biome-ignore lint/suspicious/noExplicitAny: better-auth's GenericEndpointContext surface is loose
  ctx?: any,
) {
  // QR pair-mint short-circuit: don't email, hand the URL back to the
  // caller via the in-memory registry.
  const pairNonce = typeof metadata?.pairNonce === 'string' ? (metadata.pairNonce as string) : null;
  if (pairNonce && pendingPairUrls.has(pairNonce)) {
    const resolver = pendingPairUrls.get(pairNonce);
    pendingPairUrls.delete(pairNonce);
    resolver?.(url);
    console.log(
      JSON.stringify({
        msg: 'auth_pair_link_minted',
        email,
        ts: new Date().toISOString(),
      }),
    );
    return;
  }
  // Audit log (M-4): every magic-link send is recorded so brute-force /
  // user-enumeration attempts are observable post-hoc. Email is logged for
  // forensics; URL is NOT logged in prod paths (it's the auth secret in
  // disguise — anyone reading the log could impersonate the user).
  const mode = await resolveMagicLinkMode(email, ctx);
  console.log(
    JSON.stringify({
      msg: 'auth_magic_link_sent',
      email,
      mode,
      transport: smtpConfigured ? 'smtp' : 'console',
      ts: new Date().toISOString(),
    }),
  );
  if (!smtpConfigured) {
    console.log(
      JSON.stringify({
        msg: 'magic link (dev console mode — no SMTP configured)',
        email,
        url,
      }),
    );
    return;
  }
  const { subject, html, text } = renderMagicLinkEmail({ url, assetBase: AUTH_BASE_URL, mode });
  try {
    await getSmtpTransport().sendMail({
      from: process.env.SMTP_FROM ?? `Innerio <${process.env.SMTP_USER!}>`,
      to: email,
      subject,
      html,
      text,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        msg: 'smtp send error',
        email,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    throw new Error('Failed to send magic link');
  }
}

/**
 * Cascade-delete every Triplit row owned by `userId` across the 8 user-scoped
 * collections. Best-effort: a per-collection failure is logged and the rest
 * continue, so a partial Triplit outage doesn't block Better Auth's own user
 * row from being deleted (the user is gone in auth either way; orphaned rows
 * can be swept by a cleanup job later).
 *
 * The collections are unrolled because Triplit's per-collection method
 * overloads don't narrow when iterating a union of collection names — the
 * same gotcha as the web's `/settings/data` `wipeAll`. Order doesn't matter:
 * no FK constraints.
 */
async function wipeOne(
  client: Awaited<ReturnType<typeof getAdminClient>>,
  coll: 'items' | 'settings' | 'crypto_envelopes',
  userId: string,
): Promise<number | string> {
  try {
    let count = 0;
    if (coll === 'items') {
      const rows = await client.fetch(client.query('items').Where('user_id', '=', userId));
      for (const r of rows as { id: string }[]) await client.delete('items', r.id);
      count = rows.length;
    } else if (coll === 'settings') {
      const rows = await client.fetch(client.query('settings').Where('user_id', '=', userId));
      for (const r of rows as { id: string }[]) await client.delete('settings', r.id);
      count = rows.length;
    } else if (coll === 'crypto_envelopes') {
      const rows = await client.fetch(
        client.query('crypto_envelopes').Where('user_id', '=', userId),
      );
      for (const r of rows as { id: string }[]) await client.delete('crypto_envelopes', r.id);
      count = rows.length;
    }
    return count;
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function wipeUserData(userId: string): Promise<Record<string, number | string>> {
  const client = await getAdminClient();
  const counts: Record<string, number | string> = {};
  const collections = ['items', 'settings', 'crypto_envelopes'] as const;
  for (const coll of collections) {
    counts[coll] = await wipeOne(client, coll, userId);
  }
  return counts;
}

export const auth = betterAuth({
  database: authDb,
  secret: BETTER_AUTH_SECRET,
  baseURL: AUTH_BASE_URL,
  // WEB_ORIGIN + origins de las apps nativas (Capacitor: Android https://localhost,
  // iOS capacitor://localhost). Sin los nativos, Better Auth rechaza el sign-in
  // desde la app (originCheck). Seguro: el WebView fija el Origin real. Ver ADR-036.
  // `app://innerio` = escritorio (Electron), ADR-039.
  trustedOrigins: [WEB_ORIGIN, 'https://localhost', 'capacitor://localhost', 'app://innerio'],
  // Cross-origin cookies: web (Pages) and API (tunnel) are on different
  // hostnames in prod. SameSite=Lax (Better Auth's default) blocks the
  // session cookie from being sent on cross-origin XHRs, so /api/auth/*
  // requests from the web app would arrive without the session and
  // /triplit-token would 401. SameSite=None+Secure fixes that; Secure is
  // required by browsers when SameSite=None.
  //
  // CSRF mitigation under SameSite=None: see the long-form note in
  // server.ts above the `cors()` call. tl;dr: trustedOrigins (this file) +
  // CORS preflight (server.ts) cover us as long as new endpoints stick to
  // JSON-bodied POST/PUT/DELETE. Do NOT add side-effecting GET routes here.
  advanced: {
    // Better Auth's own rate limit and session.ipAddress use this. Default is
    // the first x-forwarded-for value, which behind Vercel + the tunnel is a
    // Vercel IP shared by every user (security review 2026-10-24, M-1). See
    // clientIp() in middleware.ts; forged values on direct calls are capped
    // by the origin limits in server.ts.
    ipAddress: { ipAddressHeaders: ['x-vercel-forwarded-for', 'cf-connecting-ip'] },
    defaultCookieAttributes: {
      sameSite: 'none',
      secure: true,
      httpOnly: true,
    },
  },
  emailAndPassword: { enabled: false },
  socialProviders: googleConfigured
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        },
      }
    : {},
  // Account linking — if a user signed up with magic-link (email-only) and
  // an attacker later acquires Google credentials with the same email
  // (recaptured corporate alias, "+"-tag drift, etc.), automatic linking
  // would hand over the existing Triplit data. Force separate accounts;
  // legitimate users who want to switch providers can delete + re-signup.
  // Audit S4 (2026-05-03).
  account: {
    accountLinking: {
      enabled: false,
    },
  },
  user: {
    deleteUser: {
      enabled: true,
      // Runs after Better Auth has already removed the user/session/account
      // rows from auth.sqlite. Cascade-wipe Triplit content owned by user_id.
      afterDelete: async (user) => {
        console.log(JSON.stringify({ msg: 'account_delete_started', user_id: user.id }));
        try {
          const counts = await wipeUserData(user.id);
          console.log(
            JSON.stringify({ msg: 'account_delete_completed', user_id: user.id, counts }),
          );
        } catch (err) {
          // Don't rethrow — the auth user is already deleted; orphaned Triplit
          // rows are recoverable by a cleanup script. Log loudly so an
          // operator can spot it.
          console.error(
            JSON.stringify({
              msg: 'account_delete_failed',
              user_id: user.id,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      },
    },
  },
  // Audit log for security-relevant lifecycle events (M-4 from 2026-04-29
  // audit). Hooks fire after Better Auth has persisted the row. JSON to
  // stdout — same format as the rest of the server's logs so a future
  // structured-log shipper can pick up the whole lot uniformly.
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          console.log(
            JSON.stringify({
              msg: 'auth_signup',
              user_id: user.id,
              email: user.email,
              ts: new Date().toISOString(),
            }),
          );
        },
      },
    },
    session: {
      create: {
        after: async (session) => {
          console.log(
            JSON.stringify({
              msg: 'auth_signin',
              user_id: session.userId,
              session_id: session.id,
              ip: session.ipAddress ?? null,
              ua: session.userAgent ?? null,
              ts: new Date().toISOString(),
            }),
          );
        },
      },
      delete: {
        after: async (session) => {
          console.log(
            JSON.stringify({
              msg: 'auth_signout',
              user_id: session.userId,
              session_id: session.id,
              ts: new Date().toISOString(),
            }),
          );
        },
      },
    },
  },
  plugins: [magicLink({ sendMagicLink: sendMagicLinkEmail })],
});

// Auto-create / update Better Auth's tables (user, session, account, verification).
// SQLite is in-process so this is safe to run on every boot — it's a diff, not a wipe.
export async function runAuthMigrations() {
  const ctx = await auth.$context;
  await ctx.runMigrations();
}

console.log(
  JSON.stringify({
    msg: 'auth configured',
    google: googleConfigured ? 'enabled' : 'disabled (set GOOGLE_CLIENT_ID/SECRET)',
    smtp: smtpConfigured ? 'enabled' : 'console-only (set SMTP_HOST/USER/PASS)',
  }),
);
