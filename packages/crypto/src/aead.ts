/**
 * AEAD primitives (XChaCha20-Poly1305 IETF) shared by field encryption
 * and DEK wrapping. Random 24-byte nonce per call. Key MUST be 32 bytes.
 *
 * Versioning (ADR-018):
 *   v=1 — no AAD. Used for DEK wrapping (the wrap is keyed by user_id +
 *         salt at the envelope-storage layer; AAD would be redundant) and
 *         for legacy field envelopes minted before 2026-05-01.
 *   v=2 — AAD-bound. Field encryption supplies
 *         `${collection}|${id}|${field}|${user_id}|2` so an attacker who
 *         shuffles ciphertexts between rows/fields/users can't decrypt
 *         them in the wrong place — the AEAD tag fails.
 *
 * `aeadEncrypt` chooses the version based on whether `aad` is passed.
 * `aeadDecrypt` validates against the envelope's declared version.
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { base64urlnopad } from '@scure/base';
import type { Envelope } from './types';

export const KEYBYTES = 32;
export const NONCE_BYTES = 24;

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function aeadEncrypt(plaintext: Uint8Array, key: Uint8Array, aad?: Uint8Array): Envelope {
  if (key.length !== KEYBYTES) {
    throw new Error(`crypto: key must be ${KEYBYTES} bytes (got ${key.length})`);
  }
  const nonce = randomBytes(NONCE_BYTES);
  const ct = xchacha20poly1305(key, nonce, aad).encrypt(plaintext);
  return {
    v: aad ? 2 : 1,
    n: base64urlnopad.encode(nonce),
    c: base64urlnopad.encode(ct),
  };
}

export function aeadDecrypt(env: Envelope, key: Uint8Array, aad?: Uint8Array): Uint8Array {
  if (key.length !== KEYBYTES) {
    throw new Error(`crypto: key must be ${KEYBYTES} bytes (got ${key.length})`);
  }
  if (env.v !== 1 && env.v !== 2) {
    throw new Error(`crypto: unsupported envelope version ${env.v}`);
  }
  // v=1 envelopes were minted without AAD; passing one to a v=1 envelope
  // would not match the original encrypt and tag-verification would fail.
  // Silently strip the caller-supplied AAD on v=1 so the dual-read path
  // (decrypt branches on row.enc_v) doesn't have to know whether each
  // individual field envelope is v=1 or v=2.
  const effectiveAad = env.v === 1 ? undefined : aad;
  const nonce = base64urlnopad.decode(env.n);
  const ct = base64urlnopad.decode(env.c);
  return xchacha20poly1305(key, nonce, effectiveAad).decrypt(ct);
}

export { randomBytes };
