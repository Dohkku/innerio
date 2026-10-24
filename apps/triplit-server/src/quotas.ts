/**
 * Quotas — soft per-user limits (Phase 2 del revival sync, doc 45 / ADR-032).
 *
 * Modelo de enforcement (honestamente reconocido):
 *  - El server MIDE pero no bloquea writes a nivel WebSocket. Bloquear
 *    individual messages mid-stream requeriría hooks que Triplit no expone
 *    cleanly via createTriplitHonoServer.
 *  - Periódicamente (cada 60s + on-demand) reconcilia bytes_used/items_count
 *    contra la SQLite de Triplit.
 *  - El cliente lee la quota via /api/quotas y aplica el bloqueo soft
 *    (banner + botón "upgrade").
 *  - Para un usuario hostil que ignore el cliente, el peor caso es que su
 *    cuenta se marca "over-quota" en background y la web le bloquea al
 *    siguiente refresh. No es un DoS realista a la escala del producto.
 *
 * Tabla: `quotas` en auth.sqlite (no en triplit.db — Better Auth ya gestiona
 * auth.sqlite y aquí solo añadimos una tabla más).
 *
 * Tiers:
 *  - free: 500 items / 5MB ciphertext.
 *  - paid: 10k items / 100MB.
 */
import type { Database } from 'bun:sqlite';

export type Tier = 'free' | 'paid';

export const QUOTA_LIMITS: Record<Tier, { items: number; bytes: number }> = {
  free: { items: 5_000, bytes: 50 * 1024 * 1024 },
  paid: { items: 50_000, bytes: 500 * 1024 * 1024 },
};

export type QuotaRow = {
  user_id: string;
  tier: Tier;
  bytes_used: number;
  items_count: number;
  updated_at: number;
};

export function runQuotaMigrations(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS quotas (
      user_id      TEXT PRIMARY KEY,
      tier         TEXT NOT NULL DEFAULT 'free',
      bytes_used   INTEGER NOT NULL DEFAULT 0,
      items_count  INTEGER NOT NULL DEFAULT 0,
      updated_at   INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    )
  `);
}

export function getQuota(db: Database, userId: string): QuotaRow {
  const row = db
    .query<QuotaRow, [string]>(
      'SELECT user_id, tier, bytes_used, items_count, updated_at FROM quotas WHERE user_id = ?',
    )
    .get(userId);
  if (row) return row;
  // First-time read: insert default free row.
  const now = Date.now();
  db.run(
    "INSERT INTO quotas (user_id, tier, bytes_used, items_count, updated_at) VALUES (?, 'free', 0, 0, ?)",
    [userId, now],
  );
  return { user_id: userId, tier: 'free', bytes_used: 0, items_count: 0, updated_at: now };
}

export function setTier(db: Database, userId: string, tier: Tier): void {
  // Upsert. Reset bytes_used if downgrading and over limit — but DON'T delete
  // data; the user just hits read-only at the client until they re-upgrade
  // or trim.
  db.run(
    `INSERT INTO quotas (user_id, tier, bytes_used, items_count, updated_at)
     VALUES (?, ?, 0, 0, ?)
     ON CONFLICT(user_id) DO UPDATE SET tier = excluded.tier, updated_at = excluded.updated_at`,
    [userId, tier, Date.now()],
  );
}

export type ReconcileSnapshot = {
  bytes_used: number;
  items_count: number;
};

/**
 * Recompute bytes_used + items_count from the live Triplit DB. Called from a
 * periodic timer in server.ts and on-demand by the /api/quotas endpoint.
 *
 * E2EE-compatible: nosotros solo medimos el tamaño del blob ciphertext que
 * ya está en la tabla; no necesitamos descifrarlo. Triplit guarda cada
 * field como JSON serializado — la suma de longitudes JSON aproxima los
 * bytes ciphertext con error pequeño (overhead JSON ~10-20% sobre el blob
 * útil, suficiente para una cuota soft).
 */
export async function reconcileFromTriplit(
  // biome-ignore lint/suspicious/noExplicitAny: admin client shape is generic
  triplitClient: any,
  userId: string,
): Promise<ReconcileSnapshot> {
  const items = await triplitClient.fetch(
    triplitClient.query('items').Where('user_id', '=', userId),
  );
  let bytes = 0;
  for (const row of items as Record<string, unknown>[]) {
    // Sumamos longitudes de los string fields (que son los cifrados).
    for (const v of Object.values(row)) {
      if (typeof v === 'string') bytes += v.length;
    }
  }
  return { bytes_used: bytes, items_count: items.length };
}

export function applyReconciliation(db: Database, userId: string, snap: ReconcileSnapshot): void {
  db.run(
    `INSERT INTO quotas (user_id, tier, bytes_used, items_count, updated_at)
     VALUES (?, 'free', ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       bytes_used = excluded.bytes_used,
       items_count = excluded.items_count,
       updated_at = excluded.updated_at`,
    [userId, snap.bytes_used, snap.items_count, Date.now()],
  );
}

export function isOverQuota(row: QuotaRow): boolean {
  const limits = QUOTA_LIMITS[row.tier];
  return row.bytes_used >= limits.bytes || row.items_count >= limits.items;
}
