/**
 * Per-collection content-field encryption (Phase 9 slice 4, ADR-017,
 * AAD upgrade per ADR-018 / audit N-2).
 *
 * `encryptRow` is called on every insert/update payload at the
 * TriplitClient boundary. `decryptRow` is called on every fetched row
 * coming back from server / IDB. `enc_v` per row marks state:
 *   0 → legacy plaintext (pre-rollout / demo mode); pass through.
 *   1 → ciphertext envelopes WITHOUT AAD (legacy ADR-017).
 *   2 → ciphertext envelopes WITH AAD (current; ADR-018).
 *
 * Mixed-state coexistence is intentional. Slice 6 sweeps `enc_v < 2`
 * rows for logged-in users; until promotion, reads handle all three
 * shapes. v=1 envelopes ignore caller-supplied AAD inside `aead.ts` so
 * the decrypter can pass AAD unconditionally.
 *
 * Context (collection, id, userId) is required for AAD construction.
 * The caller (`triplit.ts` wrapper) threads these through.
 *
 * The set of encrypted fields is small and stable. Adding/removing a
 * field requires bumping `enc_v` and writing a migration — don't edit
 * this map without thinking about old rows.
 */

import { cryptoStore } from '$lib/stores/crypto.svelte';
import { buildFieldAad, decryptField, encryptField } from '@gtd/crypto';

type FieldSet = {
  /** Plain string fields — encrypted as-is. Empty-string fields skipped. */
  strings: readonly string[];
  /** JSON fields — JSON.stringify → encryptField → store. Skipped if null/undefined. */
  json: readonly string[];
};

export const ENCRYPTED_FIELDS: Readonly<Record<string, FieldSet>> = {
  items: {
    strings: ['title', 'notes', 'waiting_for', 'outcome'],
    json: ['recurrence'],
  },
  // settings + crypto_envelopes intentionally NOT encrypted.
  // settings es metadata mínima (id + user_id + enc_v).
  // crypto_envelopes contiene blobs DEK ya opacos por diseño.
  // (areas + reviews + goals + reflections + methodology fueron
  //  eliminadas del schema en mayo 2026, ver ADRs 025-031.)
};

export function isEncryptedCollection(name: string): boolean {
  return Object.hasOwn(ENCRYPTED_FIELDS, name);
}

export const ENC_V_PLAINTEXT = 0 as const;
export const ENC_V_NO_AAD = 1 as const;
export const ENC_V_AAD = 2 as const;
// Restored to 2 on 2026-05-03 (audit S2). The 2026-05-01 HOTFIX rollback
// was triggered by AAD/user_id desync during adopt.ts (pre-auth rows had
// AAD bound to userId='' but the row's user_id was rotated to the real
// claim post-login → decrypt mismatch). The wrapper in `triplit.ts` now
// re-derives the encrypt ctx from `writes.user_id ?? rowUserId` after
// the mutator runs, so promotion and rotation paths bind AAD to the
// final user_id. Decrypters still accept legacy v=1 envelopes via the
// aead.ts dual-read path.
export const ENC_V_CURRENT = 2 as const;

/** Fields whose AAD includes the row id, collection, and user. Used for
 *  encrypt; decrypt builds the same shape per field on read. */
export type RowContext = {
  collection: string;
  id: string;
  userId: string;
};

function aadFor(ctx: RowContext, field: string): Uint8Array {
  return buildFieldAad({
    collection: ctx.collection,
    id: ctx.id,
    field,
    userId: ctx.userId,
  });
}

/**
 * Encrypts a write payload for `ctx.collection` using `dek`. Returns a
 * fresh object — does not mutate input. Stamps `enc_v=2` so reads
 * downstream know the envelopes were minted with AAD.
 */
export async function encryptRow<T extends Record<string, unknown>>(
  ctx: RowContext,
  data: T,
  dek: Uint8Array,
): Promise<T & { enc_v: number }> {
  const cfg = ENCRYPTED_FIELDS[ctx.collection];
  if (!cfg) return { ...data, enc_v: ENC_V_PLAINTEXT };

  const out = { ...data } as Record<string, unknown>;
  // Make sure the row's id flows back into the payload — AAD binds to it
  // and a downstream Triplit auto-id would mismatch on first decrypt.
  out.id = ctx.id;
  if (ctx.userId) out.user_id = ctx.userId;

  for (const f of cfg.strings) {
    const v = out[f];
    if (typeof v === 'string' && v.length > 0) {
      out[f] = await encryptField(v, dek, aadFor(ctx, f));
    }
  }
  for (const f of cfg.json) {
    const v = out[f];
    if (v !== undefined && v !== null) {
      out[f] = await encryptField(JSON.stringify(v), dek, aadFor(ctx, f));
    }
  }
  out.enc_v = ENC_V_CURRENT;
  return out as T & { enc_v: number };
}

/**
 * Encrypts only the fields present in `patch` — used for `update` calls
 * that mutate a subset. Does NOT stamp `enc_v` if the patch wouldn't
 * change content (avoids needless writes on metadata-only updates).
 */
export async function encryptPatch<T extends Record<string, unknown>>(
  ctx: RowContext,
  patch: T,
  dek: Uint8Array,
): Promise<T & { enc_v?: number }> {
  const cfg = ENCRYPTED_FIELDS[ctx.collection];
  if (!cfg) return patch;

  const out = { ...patch } as Record<string, unknown>;
  let touchedContent = false;
  for (const f of cfg.strings) {
    if (!(f in out)) continue;
    const v = out[f];
    if (typeof v === 'string' && v.length > 0) {
      out[f] = await encryptField(v, dek, aadFor(ctx, f));
      touchedContent = true;
    } else if (typeof v === 'string' && v.length === 0) {
      // Empty string → keep as empty (server will store ''); still a content write.
      touchedContent = true;
    }
  }
  for (const f of cfg.json) {
    if (!(f in out)) continue;
    const v = out[f];
    if (v !== undefined && v !== null) {
      out[f] = await encryptField(JSON.stringify(v), dek, aadFor(ctx, f));
      touchedContent = true;
    }
  }
  if (touchedContent) {
    out.enc_v = ENC_V_CURRENT;
  }
  return out as T & { enc_v?: number };
}

/**
 * Decrypts a row read from Triplit. `enc_v=0` passes through. `enc_v=1`
 * decrypts envelopes WITHOUT AAD (aead.ts strips caller-supplied AAD on
 * v=1 internally — we still pass AAD so the call shape is uniform; it's
 * a no-op for v=1). `enc_v=2` requires AAD match.
 *
 * Decryption errors fall back to a placeholder string rather than
 * throwing — a single corrupt row should not break the whole list view.
 * The cryptoStore tracks counts/samples so the UI can surface them.
 *
 * AAD source-of-truth (hotfix 2026-05-01 post-deploy): we used to build the
 * AAD with the userId param (the JWT-claim `currentUserId`). That created
 * a race: a Triplit subscription emits from local IDB on mount, often
 * before `setTriplitUserId(...)` lands in `attachTriplitToken`, so the
 * decrypter saw `userId === ''` and produced a mismatching AAD against
 * rows whose stored `user_id` was the real claim. Result: every row
 * rendered as `[cifrado · error]` until the next mutation. Fix: prefer
 * the row's own `user_id` field for AAD construction. The `fallbackUserId`
 * param is only used when the row's user_id is missing/empty (legacy
 * demo data and pre-adopt rows).
 */
export async function decryptRow<T extends Record<string, unknown>>(
  collection: string,
  row: T | null | undefined,
  dek: Uint8Array,
  fallbackUserId: string,
): Promise<T | null | undefined> {
  if (!row) return row;
  const cfg = ENCRYPTED_FIELDS[collection];
  if (!cfg) return row;
  const enc = (row as { enc_v?: number }).enc_v ?? ENC_V_PLAINTEXT;
  if (enc === ENC_V_PLAINTEXT) return row;

  const id = (row as { id?: string }).id ?? '<unknown>';
  const rowUserId = (row as { user_id?: string }).user_id ?? '';
  const userId = rowUserId.length > 0 ? rowUserId : fallbackUserId;
  const ctx: RowContext = { collection, id, userId };

  const out = { ...row } as Record<string, unknown>;
  for (const f of cfg.strings) {
    const v = out[f];
    if (typeof v === 'string' && v.length > 0) {
      try {
        out[f] = await decryptField(v, dek, aadFor(ctx, f));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Triplit 1.1.10 puede entregar el row en un estado transitorio
        // donde un field marcado `enc_v=2` contiene plaintext (mientras el
        // outbox tiene el ciphertext y aún no consolidó con la primary kv).
        // Detectamos "cannot decode envelope" (= no es base64url JSON
        // válido → no es un envelope) y dejamos pasar el valor tal cual.
        // El siguiente write re-cifra. El server siempre tiene ciphertext
        // bien formado (verificado vía /data/triplit.db snapshot).
        if (msg.includes('cannot decode envelope')) {
          // out[f] queda con su valor original (plaintext); no contar como error.
          continue;
        }
        // Otro tipo de fallo (tag mismatch sobre envelope válido) sí es un
        // error real de AAD/DEK. Marca placeholder y suma al contador.
        out[f] = '[cifrado · error]';
        cryptoStore.noteDecryptError(collection, id, f);
      }
    }
  }
  for (const f of cfg.json) {
    const v = out[f];
    if (typeof v === 'string') {
      try {
        const pt = await decryptField(v, dek, aadFor(ctx, f));
        out[f] = JSON.parse(pt);
      } catch {
        out[f] = null;
        cryptoStore.noteDecryptError(collection, id, f);
      }
    }
  }
  return out as T;
}

/** Best-effort decrypt of an array result. Order preserved. The AAD per
 *  row is built from each row's own `user_id`, with `fallbackUserId` used
 *  only when a row's `user_id` is empty. See `decryptRow` for the
 *  underlying race rationale. */
export async function decryptResults<T extends Record<string, unknown>>(
  collection: string,
  rows: readonly T[] | null | undefined,
  dek: Uint8Array,
  fallbackUserId: string,
): Promise<T[]> {
  if (!rows || rows.length === 0) return [];
  return Promise.all(rows.map((r) => decryptRow(collection, r, dek, fallbackUserId) as Promise<T>));
}
