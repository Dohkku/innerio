/**
 * QR pair-mint endpoint — `POST /api/auth/pair-mint`.
 *
 * Returns a one-shot magic-link verify URL for the current session's user.
 * Used by /settings/pair on the PC to embed the URL in the QR; when the
 * mobile scans + opens it, Better Auth validates the token and sets the
 * session cookie. No email round-trip.
 *
 * Security model:
 *   - Session cookie required (auth.api.getSession).
 *   - Email is forced from session.user.email (NEVER from the request body),
 *     so a compromised PC session can only mint links to its own email.
 *   - The minted URL is single-use (Better Auth marks the verification token
 *     consumed on first /magic-link/verify hit) and expires in ~5 minutes
 *     (Better Auth default). The QR shell also caps the display TTL at 60s.
 *   - The URL travels through an in-memory registry in auth.ts; entries are
 *     deleted on resolve or after a hard 5s timeout, so a server restart
 *     drops any pending nonce.
 */
import type { Hono } from 'hono';
import { auth, pendingPairUrls } from './auth.js';

const PAIR_MINT_TIMEOUT_MS = 5000;
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';

export function mountPairApi(app: Hono): void {
  app.post('/api/auth/pair-mint', async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'not_authenticated' }, 401);

    const email = session.user.email;
    const pairNonce = crypto.randomUUID();
    const callbackURL = `${WEB_ORIGIN}/pair?resume=1`;

    const urlPromise = new Promise<string>((resolve, reject) => {
      pendingPairUrls.set(pairNonce, resolve);
      setTimeout(() => {
        if (pendingPairUrls.delete(pairNonce)) {
          reject(new Error('pair-mint timeout'));
        }
      }, PAIR_MINT_TIMEOUT_MS);
    });

    try {
      // Internally invoke the magic-link plugin. The `sendMagicLink` callback
      // in auth.ts will see metadata.pairNonce and deliver the URL via the
      // registry above instead of emailing.
      await auth.api.signInMagicLink({
        body: { email, callbackURL, metadata: { pairNonce } },
        headers: c.req.raw.headers,
      });
      const url = await urlPromise;
      return c.json({ url });
    } catch (err) {
      pendingPairUrls.delete(pairNonce);
      console.error(
        JSON.stringify({
          msg: 'pair_mint_failed',
          user_id: session.user.id,
          err: err instanceof Error ? err.message : String(err),
        }),
      );
      return c.json({ error: 'pair_mint_failed' }, 500);
    }
  });
}
