/**
 * Crypto envelope endpoint (Phase 9 slice 2, ADR-017).
 *
 * Stores the wrapped DEK envelope for the current user. The server NEVER
 * sees the unwrapped DEK — only the ciphertext blobs and the KDF params
 * needed to re-derive the KEK on the client.
 *
 * Auth via Better Auth session cookie (same pattern as agent-tokens).
 *
 *   GET    /api/auth/crypto-envelope  → 200 row | 404 if none yet
 *   POST   /api/auth/crypto-envelope  → 201 created | 409 if already exists
 *   PUT    /api/auth/crypto-envelope  → 200 rotated (replaces existing)
 *
 * Account deletion is handled by the existing `afterDelete` cascade in
 * auth.ts (slice 8 will extend that to wipe `crypto_envelopes` too).
 *
 * Note: the underlying `crypto_envelopes` collection has `userOwned`
 * permissions, so direct Triplit-client access from the web app would
 * also work. We keep this REST endpoint because:
 *   1. Atomic uniqueness check ("does the user already have a row?") in
 *      a single server round-trip rather than client-side query.
 *   2. Structured server-side logs for envelope create/rotate events
 *      (closes part of audit M-4 debt).
 *   3. Decouples the setup flow from the Triplit JWT issuance order — a
 *      new user can fetch this with just a Better Auth session, before
 *      `/api/auth/triplit-token` runs.
 */
import type { CryptoEnvelope, CryptoEnvelopeInsert } from '@gtd/schema';
import type { Hono } from 'hono';
import { getAdminClient } from './admin-client.js';
import { auth } from './auth.js';

// Mirrors `@gtd/crypto` MAX_OPSLIMIT / MAX_MEMLIMIT. Duplicated as plain
// numbers to avoid pulling @noble/hashes + bip39 into the server bundle for
// two constants. Keep in sync if the canonical values move.
const MAX_OPSLIMIT = 100;
const MAX_MEMLIMIT = 1_073_741_824;

type EnvelopeBody = {
  salt_passphrase: string;
  salt_mnemonic: string;
  wrapped_dek_passphrase: string;
  wrapped_dek_mnemonic: string;
  kdf_params: { alg: string; opslimit: number; memlimit: number };
};

// Salt b64url 16 bytes ~ 22 chars; wrapped DEK envelope b64url(JSON({v,n,c}))
// con DEK=32B ~ 130 chars. Margen × ~30 cubre cualquier KDF future-proof
// sin abrir un vector de memoria-DoS si un atacante autenticado manda
// payloads gigantes (audit M-5, 2026-05-21).
const MAX_FIELD_LEN = 4096;

function validateBody(raw: unknown): EnvelopeBody | { error: string } {
  if (typeof raw !== 'object' || raw === null) return { error: 'body_not_object' };
  const b = raw as Record<string, unknown>;
  for (const key of [
    'salt_passphrase',
    'salt_mnemonic',
    'wrapped_dek_passphrase',
    'wrapped_dek_mnemonic',
  ]) {
    if (typeof b[key] !== 'string' || (b[key] as string).length === 0) {
      return { error: `missing_or_empty_${key}` };
    }
    if ((b[key] as string).length > MAX_FIELD_LEN) {
      return { error: `${key}_too_long` };
    }
  }
  const k = b.kdf_params;
  if (typeof k !== 'object' || k === null) return { error: 'missing_kdf_params' };
  const kp = k as Record<string, unknown>;
  if (typeof kp.alg !== 'string') return { error: 'invalid_kdf_alg' };
  // Caps mirror @gtd/crypto MAX_OPSLIMIT / MAX_MEMLIMIT. Without an upper
  // bound an authenticated attacker could write opslimit=1e6 / memlimit=10GB
  // into the envelope and the next legitimate device would hang Argon2id
  // (algorithmic DoS, ransom shape).
  if (
    typeof kp.opslimit !== 'number' ||
    !Number.isFinite(kp.opslimit) ||
    kp.opslimit <= 0 ||
    kp.opslimit > MAX_OPSLIMIT
  ) {
    return { error: 'invalid_kdf_opslimit' };
  }
  if (
    typeof kp.memlimit !== 'number' ||
    !Number.isFinite(kp.memlimit) ||
    kp.memlimit <= 0 ||
    kp.memlimit > MAX_MEMLIMIT
  ) {
    return { error: 'invalid_kdf_memlimit' };
  }
  return {
    salt_passphrase: b.salt_passphrase as string,
    salt_mnemonic: b.salt_mnemonic as string,
    wrapped_dek_passphrase: b.wrapped_dek_passphrase as string,
    wrapped_dek_mnemonic: b.wrapped_dek_mnemonic as string,
    kdf_params: {
      alg: kp.alg as string,
      opslimit: kp.opslimit as number,
      memlimit: kp.memlimit as number,
    },
  };
}

function publicShape(row: CryptoEnvelope): {
  id: string;
  user_id: string;
  salt_passphrase: string;
  salt_mnemonic: string;
  wrapped_dek_passphrase: string;
  wrapped_dek_mnemonic: string;
  kdf_params: unknown;
  v: number;
  created_at: Date;
  updated_at: Date;
} {
  return {
    id: row.id,
    user_id: row.user_id,
    salt_passphrase: row.salt_passphrase,
    salt_mnemonic: row.salt_mnemonic,
    wrapped_dek_passphrase: row.wrapped_dek_passphrase,
    wrapped_dek_mnemonic: row.wrapped_dek_mnemonic,
    kdf_params: row.kdf_params,
    v: row.v,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function findExisting(userId: string): Promise<CryptoEnvelope | null> {
  const client = await getAdminClient();
  const rows = await client.fetch(
    client.query('crypto_envelopes').Where('user_id', '=', userId).Limit(1),
  );
  return rows[0] ?? null;
}

export function mountCryptoEnvelope(app: Hono): void {
  app.get('/api/auth/crypto-envelope', async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'not_authenticated' }, 401);
    const userId = session.user.id;
    const row = await findExisting(userId);
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ envelope: publicShape(row) });
  });

  app.post('/api/auth/crypto-envelope', async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'not_authenticated' }, 401);
    const userId = session.user.id;

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    const parsed = validateBody(raw);
    if ('error' in parsed) return c.json(parsed, 400);

    const existing = await findExisting(userId);
    if (existing) {
      console.log(
        JSON.stringify({
          msg: 'crypto_envelope_create_attempted_existing',
          user_id: userId,
        }),
      );
      return c.json({ error: 'already_exists' }, 409);
    }

    const client = await getAdminClient();
    const insertable: CryptoEnvelopeInsert = {
      user_id: userId,
      salt_passphrase: parsed.salt_passphrase,
      salt_mnemonic: parsed.salt_mnemonic,
      wrapped_dek_passphrase: parsed.wrapped_dek_passphrase,
      wrapped_dek_mnemonic: parsed.wrapped_dek_mnemonic,
      kdf_params: parsed.kdf_params,
    };
    const row = await client.insert('crypto_envelopes', insertable);
    console.log(
      JSON.stringify({
        msg: 'crypto_envelope_created',
        user_id: userId,
        envelope_id: row.id,
      }),
    );
    return c.json({ envelope: publicShape(row) }, 201);
  });

  app.put('/api/auth/crypto-envelope', async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'not_authenticated' }, 401);
    const userId = session.user.id;

    // Freshness gate (audit N-3, 2026-05-01). Rotating the envelope replaces
    // the wraps that protect the DEK; if an attacker with a stolen session
    // cookie does this, the legitimate user is permanently locked out (their
    // passphrase + mnemonic no longer unwrap the new wraps, attacker also
    // can't read because they don't have the DEK plaintext — pure ransom).
    // Mitigation: require a recently-minted session (≤ 10 min since
    // sign-in) so the operator must have completed a fresh magic-link click
    // before rotation. Cookie-replay alone isn't enough.
    const FRESHNESS_MS = 10 * 60 * 1000;
    const createdAt =
      session.session.createdAt instanceof Date
        ? session.session.createdAt.getTime()
        : new Date(session.session.createdAt as unknown as string).getTime();
    if (Number.isNaN(createdAt) || Date.now() - createdAt > FRESHNESS_MS) {
      console.log(
        JSON.stringify({
          msg: 'crypto_envelope_rotate_rejected_stale_session',
          user_id: userId,
          session_age_ms: Number.isNaN(createdAt) ? null : Date.now() - createdAt,
        }),
      );
      return c.json(
        {
          error: 'session_too_old',
          message:
            'Envelope rotation requires a session no older than 10 minutes. Sign in again with a fresh magic link to rotate.',
        },
        403,
      );
    }

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    const parsed = validateBody(raw);
    if ('error' in parsed) return c.json(parsed, 400);

    const existing = await findExisting(userId);
    if (!existing) return c.json({ error: 'not_found' }, 404);

    const client = await getAdminClient();
    await client.update('crypto_envelopes', existing.id, {
      salt_passphrase: parsed.salt_passphrase,
      salt_mnemonic: parsed.salt_mnemonic,
      wrapped_dek_passphrase: parsed.wrapped_dek_passphrase,
      wrapped_dek_mnemonic: parsed.wrapped_dek_mnemonic,
      kdf_params: parsed.kdf_params,
      updated_at: new Date(),
    });
    const fresh = await client.fetchById('crypto_envelopes', existing.id);
    console.log(
      JSON.stringify({
        msg: 'crypto_envelope_rotated',
        user_id: userId,
        envelope_id: existing.id,
      }),
    );
    if (!fresh) return c.json({ error: 'race_after_update' }, 500);
    return c.json({ envelope: publicShape(fresh) });
  });
}
