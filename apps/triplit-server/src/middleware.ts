/**
 * Middlewares Hono para los endpoints custom (`/api/auth/triplit-token`,
 * `/api/auth/crypto-envelope`, `/api/auth/pair-mint`, `/api/quotas`).
 *
 * Better Auth aporta rate-limit + cache headers en las rutas que él gestiona
 * (`/api/auth/sign-in/*`, `/magic-link/verify`, etc), pero las rutas custom
 * están montadas directamente en Hono ANTES del wildcard, así que pasan por
 * fuera. Estos middlewares cubren el hueco.
 *
 * Audit fixes:
 *  - M-2: `noStore` añade `Cache-Control: private, no-store` para que un
 *    futuro proxy (CF Tunnel, CDN delante del API) no pueda servir un JWT /
 *    envelope / quota de un usuario a otro.
 *  - A-2: `rateLimitPerSession` token-bucket en memoria scoped por
 *    session.user.id. Single-process (sin Redis) — si en el futuro se
 *    escala el server a varios workers hay que mover este state a Redis o
 *    a la `secondaryStorage` de Better Auth.
 */
import type { Context, Next } from 'hono';
import { auth } from './auth.js';

export async function noStore(c: Context, next: Next): Promise<void> {
  await next();
  if (c.res) {
    const headers = new Headers(c.res.headers);
    headers.set('Cache-Control', 'private, no-store');
    c.res = new Response(c.res.body, {
      status: c.res.status,
      statusText: c.res.statusText,
      headers,
    });
  }
}

type Bucket = { tokens: number; lastRefill: number };

/**
 * Mismo token-bucket que `rateLimitPerSession` pero scoped por IP — para
 * endpoints sin auth (e.g. /api/secret/phrase, easter egg accesible en
 * demo mode). IP source: `cf-connecting-ip` (CF Tunnel inyecta éste cuando
 * tu deploy va detrás de Cloudflare), fallback a `x-forwarded-for` primer
 * elemento, fallback final a 'unknown' (bucket compartido por todos los
 * que lleguen sin proxy — en dev local, no importa).
 *
 * Aviso: `x-forwarded-for` es spoofeable por el cliente si NO hay proxy
 * delante; por eso `cf-connecting-ip` (puesto por CF, no por el cliente)
 * es preferible. En el deploy actual de Innerio el tunnel CF añade ambos.
 */
/**
 * Real client IP. Requests from the web app and the desktop app arrive via
 * the Vercel proxy (app.innerio…/api/*), so `cf-connecting-ip` is a Vercel
 * egress IP shared by everyone; Vercel overwrites client-sent forwarding
 * headers and puts the real one in `x-vercel-forwarded-for`. A direct
 * caller of innerio-api can forge that header, which is why every
 * client-keyed limit on a sensitive route is paired with an `origin` one
 * (security review 2026-10-24, M-1).
 */
export function clientIp(c: Context): string {
  return (
    c.req.header('x-vercel-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/** IP that actually connected to Cloudflare (unforgeable behind the tunnel). */
export function originIp(c: Context): string {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

export function rateLimitPerIP(opts: {
  max: number;
  windowMs: number;
  name?: string;
  /** `client` (default) = real user IP; `origin` = connecting IP. */
  by?: 'client' | 'origin';
}) {
  const buckets = new Map<string, Bucket>();
  const { max, windowMs } = opts;

  const GC_INTERVAL_MS = 5 * 60 * 1000;
  setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (now - b.lastRefill > windowMs * 4) buckets.delete(k);
    }
  }, GC_INTERVAL_MS).unref?.();

  return async (c: Context, next: Next): Promise<Response | undefined> => {
    // CORS preflights carry no credentials and must not eat the budget.
    if (c.req.method === 'OPTIONS') {
      await next();
      return;
    }
    const ip = opts.by === 'origin' ? originIp(c) : clientIp(c);
    const key = `${opts.name ?? 'default'}:${ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b) {
      b = { tokens: max, lastRefill: now };
      buckets.set(key, b);
    }
    const elapsed = now - b.lastRefill;
    if (elapsed >= windowMs) {
      b.tokens = max;
      b.lastRefill = now;
    } else if (elapsed > 0) {
      const refill = Math.floor((elapsed / windowMs) * max);
      if (refill > 0) {
        b.tokens = Math.min(max, b.tokens + refill);
        b.lastRefill = now;
      }
    }
    if (b.tokens <= 0) {
      const retryAfter = Math.ceil((windowMs - elapsed) / 1000);
      console.log(
        JSON.stringify({
          msg: 'rate_limited_ip',
          bucket: opts.name ?? 'default',
          ip,
          retry_after_s: retryAfter,
        }),
      );
      return c.json({ error: 'rate_limited', retry_after_s: retryAfter }, 429, {
        'Retry-After': String(retryAfter),
      });
    }
    b.tokens -= 1;
    await next();
    return;
  };
}

export function rateLimitPerSession(opts: {
  /** Tokens by which the bucket is refilled every `windowMs`. */
  max: number;
  /** Refill window in ms. */
  windowMs: number;
  /** Optional name for the bucket — distinct namespaces for distinct endpoints
   *  if you want independent budgets. */
  name?: string;
}) {
  const buckets = new Map<string, Bucket>();
  const { max, windowMs } = opts;

  // Periodic GC so the map doesn't grow unbounded with anonymous-failed-auth
  // attempts. Keeps memory bounded under sustained probing.
  const GC_INTERVAL_MS = 5 * 60 * 1000;
  setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (now - b.lastRefill > windowMs * 4) buckets.delete(k);
    }
  }, GC_INTERVAL_MS).unref?.();

  return async (c: Context, next: Next): Promise<Response | undefined> => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    // Sin sesión: no limitamos aquí — el endpoint custom ya devolverá 401.
    // Esto evita pintar un 429 ambiguo cuando el cliente realmente debería
    // ver "not authenticated".
    if (!session) {
      await next();
      return;
    }

    const key = `${opts.name ?? 'default'}:${session.user.id}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b) {
      b = { tokens: max, lastRefill: now };
      buckets.set(key, b);
    }
    // Refill linealmente: si pasó el window entero, full reset. Si pasó
    // fracción, refill proporcional.
    const elapsed = now - b.lastRefill;
    if (elapsed >= windowMs) {
      b.tokens = max;
      b.lastRefill = now;
    } else if (elapsed > 0) {
      const refill = Math.floor((elapsed / windowMs) * max);
      if (refill > 0) {
        b.tokens = Math.min(max, b.tokens + refill);
        b.lastRefill = now;
      }
    }
    if (b.tokens <= 0) {
      const retryAfter = Math.ceil((windowMs - elapsed) / 1000);
      console.log(
        JSON.stringify({
          msg: 'rate_limited',
          bucket: opts.name ?? 'default',
          user_id: session.user.id,
          retry_after_s: retryAfter,
        }),
      );
      return c.json({ error: 'rate_limited', retry_after_s: retryAfter }, 429, {
        'Retry-After': String(retryAfter),
      });
    }
    b.tokens -= 1;
    await next();
    return;
  };
}
