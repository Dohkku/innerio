/**
 * Data Encryption Key (DEK) lifecycle.
 *
 * One DEK per user account. Generated client-side at setup, never leaves
 * the browser unwrapped. Wrapped with passphrase-KEK and recovery-KEK
 * (mnemonic-derived) so either path unlocks identically.
 */

import { KEYBYTES, aeadDecrypt, aeadEncrypt, randomBytes } from './aead';
import type { Envelope } from './types';

export async function generateDEK(): Promise<Uint8Array> {
  return randomBytes(KEYBYTES);
}

export async function wrapDEK(dek: Uint8Array, kek: Uint8Array): Promise<Envelope> {
  if (dek.length !== KEYBYTES) {
    throw new Error(`crypto: DEK must be ${KEYBYTES} bytes (got ${dek.length})`);
  }
  return aeadEncrypt(dek, kek);
}

export async function unwrapDEK(env: Envelope, kek: Uint8Array): Promise<Uint8Array> {
  const dek = aeadDecrypt(env, kek);
  if (dek.length !== KEYBYTES) {
    throw new Error(`crypto: unwrapped DEK has wrong length ${dek.length}, expected ${KEYBYTES}`);
  }
  return dek;
}
