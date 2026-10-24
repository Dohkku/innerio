/**
 * Per-field encryption: takes plaintext string + DEK, returns the
 * base64url envelope string ready to drop into a Triplit `S.String()`
 * field. Decrypt is the inverse.
 *
 * AAD support (ADR-018): pass `aad` to bind the ciphertext to a context
 * (`${collection}|${id}|${field}|${user_id}|2`). New writes always include
 * AAD; reads accept legacy v=1 envelopes (no AAD) AND v=2 envelopes (AAD
 * required and validated). The dual-read window stays open until all
 * production rows have been promoted to enc_v=2 by the migration sweep.
 *
 * Stable contract: the returned string is opaque to anything except
 * `decryptField`. Do not introspect.
 */

import { KEYBYTES, aeadDecrypt, aeadEncrypt } from './aead';
import { decodeEnvelope, encodeEnvelope } from './envelope';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export async function encryptField(
  plaintext: string,
  dek: Uint8Array,
  aad?: Uint8Array,
): Promise<string> {
  if (dek.length !== KEYBYTES) {
    throw new Error(`crypto: DEK must be ${KEYBYTES} bytes (got ${dek.length})`);
  }
  const env = aeadEncrypt(TEXT_ENCODER.encode(plaintext), dek, aad);
  return encodeEnvelope(env);
}

export async function decryptField(
  envelopeStr: string,
  dek: Uint8Array,
  aad?: Uint8Array,
): Promise<string> {
  if (dek.length !== KEYBYTES) {
    throw new Error(`crypto: DEK must be ${KEYBYTES} bytes (got ${dek.length})`);
  }
  const env = decodeEnvelope(envelopeStr);
  const pt = aeadDecrypt(env, dek, aad);
  return TEXT_DECODER.decode(pt);
}

/**
 * Build the canonical AAD for a field-level envelope. Mirrors the format
 * documented in ADR-018: `${collection}|${id}|${field}|${user_id}|2`. The
 * trailing `|2` reserves room for a future v=3 binding scheme without
 * collision against this one.
 */
export function buildFieldAad(opts: {
  collection: string;
  id: string;
  field: string;
  userId: string;
}): Uint8Array {
  const s = `${opts.collection}|${opts.id}|${opts.field}|${opts.userId}|2`;
  return TEXT_ENCODER.encode(s);
}
