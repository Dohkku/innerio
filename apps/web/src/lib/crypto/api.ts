/**
 * REST client for `/api/auth/crypto-envelope` (Phase 9 slice 3).
 *
 * Same auth strategy as the rest of the auth surface: browser session
 * cookie via `credentials: 'include'`. The base URL follows
 * `VITE_AUTH_SERVER` (cross-origin in prod, same-origin via Vite proxy in
 * dev) — mirrors `lib/stores/session.svelte.ts`.
 */

import type { KdfParams } from '@gtd/crypto';

const AUTH_BASE = import.meta.env.VITE_AUTH_SERVER ?? window.location.origin;
const ENVELOPE_URL = `${AUTH_BASE}/api/auth/crypto-envelope`;

export type CryptoEnvelopePayload = {
  salt_passphrase: string;
  salt_mnemonic: string;
  wrapped_dek_passphrase: string;
  wrapped_dek_mnemonic: string;
  kdf_params: KdfParams;
};

export type ServerEnvelope = CryptoEnvelopePayload & {
  id: string;
  user_id: string;
  v: number;
  created_at: string;
  updated_at: string;
};

/** GET → row | null (404 → null). Throws on other errors. */
export async function fetchEnvelope(): Promise<ServerEnvelope | null> {
  const res = await fetch(ENVELOPE_URL, { credentials: 'include' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`crypto-envelope GET ${res.status}`);
  const body = (await res.json()) as { envelope: ServerEnvelope };
  return body.envelope;
}

/** POST. 409 → throws `EnvelopeAlreadyExists`. */
export class EnvelopeAlreadyExists extends Error {
  constructor() {
    super('crypto-envelope: already exists for this user');
  }
}

export async function createEnvelope(payload: CryptoEnvelopePayload): Promise<ServerEnvelope> {
  const res = await fetch(ENVELOPE_URL, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.status === 409) throw new EnvelopeAlreadyExists();
  if (!res.ok) throw new Error(`crypto-envelope POST ${res.status}`);
  const body = (await res.json()) as { envelope: ServerEnvelope };
  return body.envelope;
}

/** PUT — replace existing. 404 if user has none. */
export async function rotateEnvelope(payload: CryptoEnvelopePayload): Promise<ServerEnvelope> {
  const res = await fetch(ENVELOPE_URL, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`crypto-envelope PUT ${res.status}`);
  const body = (await res.json()) as { envelope: ServerEnvelope };
  return body.envelope;
}
