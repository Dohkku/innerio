/**
 * Quotas REST endpoint — `GET /api/quotas` returns the current user's tier
 * + usage + limits. Reconcilia on-demand contra Triplit.
 *
 * Patrón mismo que crypto-envelope.ts: Hono routes auth-checked via Better
 * Auth getSession, lookup en authDb.
 */
import type { Database } from 'bun:sqlite';
import type { Hono } from 'hono';
import { getAdminClient } from './admin-client.js';
import { auth } from './auth.js';
import {
  QUOTA_LIMITS,
  applyReconciliation,
  getQuota,
  isOverQuota,
  reconcileFromTriplit,
} from './quotas.js';

export function mountQuotas(app: Hono, db: Database): void {
  app.get('/api/quotas', async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'not_authenticated' }, 401);
    const userId = session.user.id;

    // Read current quota row (creates default 'free' if first time).
    let row = getQuota(db, userId);

    // Reconcile if updated_at is older than 60s OR caller hint ?refresh=1.
    const wantsRefresh = c.req.query('refresh') === '1' || Date.now() - row.updated_at > 60_000;
    if (wantsRefresh) {
      try {
        const triplitClient = await getAdminClient();
        const snap = await reconcileFromTriplit(triplitClient, userId);
        applyReconciliation(db, userId, snap);
        row = getQuota(db, userId);
      } catch (err) {
        // Don't fail the API call on a reconciliation glitch — return stale row.
        console.warn(
          JSON.stringify({
            msg: 'quotas_reconcile_failed',
            user_id: userId,
            err: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    return c.json({
      tier: row.tier,
      bytes_used: row.bytes_used,
      items_count: row.items_count,
      limits: QUOTA_LIMITS[row.tier],
      over_quota: isOverQuota(row),
      updated_at: row.updated_at,
    });
  });
}
