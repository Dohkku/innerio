/**
 * Argon2id KDF: passphrase + salt → 32-byte KEK.
 *
 * Defaults: t=3, m=64 MiB, p=1. Above libsodium INTERACTIVE (t=2) and
 * matching the 2026-05-01 audit recommendation for a passphrase that
 * protects an offline-attackable wrapped DEK (the envelope is on the
 * server, so anyone with admin access to the SQLite file can mount an
 * offline brute-force). Each envelope stores its own kdf_params so older
 * envelopes minted with t=2 keep unwrapping unchanged — only fresh and
 * rotated envelopes pay the extra ~150ms. Implementation: @noble/hashes
 * argon2id (pure JS, audited).
 */

import { argon2id } from '@noble/hashes/argon2.js';
import { randomBytes } from './aead';
import type { KdfParams } from './types';

export const KDF_DEFAULTS: KdfParams = {
  alg: 'argon2id',
  opslimit: 3,
  memlimit: 67_108_864,
};

/**
 * Upper bounds for KDF tuning. Anyone authenticated can persist params in
 * their envelope; without caps an attacker with a stolen session could
 * write `opslimit: 10_000_000` and brick the legitimate user's unlock on
 * the next device (Argon2id hangs the browser). 100× current defaults on
 * both axes leaves head-room for future audits without enabling algorithmic
 * DoS. Enforced server-side (`crypto-envelope.ts`) AND here in `deriveKEK`
 * so an envelope written before the cap still fails fast at unlock.
 */
export const MAX_OPSLIMIT = 100;
export const MAX_MEMLIMIT = 1_073_741_824; // 1 GiB

export const SALT_BYTES = 16;

/**
 * No-op for API parity with libsodium-style libraries that need an init
 * step. @noble/hashes is sync and ready immediately. Kept so callers can
 * preload at boot without caring about the underlying lib.
 */
export async function ready(): Promise<void> {
  return undefined;
}

export async function generateSalt(): Promise<Uint8Array> {
  return randomBytes(SALT_BYTES);
}

export async function deriveKEK(
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams = KDF_DEFAULTS,
): Promise<Uint8Array> {
  if (params.alg !== 'argon2id') {
    throw new Error(`crypto: unsupported KDF alg ${params.alg}`);
  }
  if (salt.length !== SALT_BYTES) {
    throw new Error(`crypto: salt must be ${SALT_BYTES} bytes (got ${salt.length})`);
  }
  if (passphrase.length === 0) {
    throw new Error('crypto: passphrase must be non-empty');
  }
  if (params.opslimit <= 0 || params.opslimit > MAX_OPSLIMIT) {
    throw new Error(`crypto: opslimit out of range (got ${params.opslimit}, max ${MAX_OPSLIMIT})`);
  }
  if (params.memlimit <= 0 || params.memlimit > MAX_MEMLIMIT) {
    throw new Error(`crypto: memlimit out of range (got ${params.memlimit}, max ${MAX_MEMLIMIT})`);
  }
  // @noble/hashes argon2 takes memory in kibibytes; libsodium's memlimit is
  // bytes. Convert here so the public KdfParams shape matches the audit
  // language people will recognise.
  const memKiB = Math.max(1, Math.floor(params.memlimit / 1024));
  return argon2id(passphrase, salt, {
    t: params.opslimit,
    m: memKiB,
    p: 1,
    dkLen: 32,
  });
}
