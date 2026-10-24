import { describe, expect, it } from 'vitest';
import { KDF_DEFAULTS, SALT_BYTES, deriveKEK, generateSalt } from './kdf';
import type { KdfParams } from './types';

// Argon2id at INTERACTIVE is ~50-100ms; tests use MIN params for speed.
// Production code uses KDF_DEFAULTS.
const FAST: KdfParams = {
  alg: 'argon2id',
  opslimit: 1,
  memlimit: 8 * 1024, // 8 KiB
};

describe('deriveKEK', () => {
  it('is deterministic for same passphrase + salt + params', async () => {
    const salt = await generateSalt();
    const a = await deriveKEK('correct horse battery staple', salt, FAST);
    const b = await deriveKEK('correct horse battery staple', salt, FAST);
    expect(a).toEqual(b);
    expect(a.length).toBe(32);
  });

  it('different salt → different key', async () => {
    const a = await deriveKEK('passphrase', await generateSalt(), FAST);
    const b = await deriveKEK('passphrase', await generateSalt(), FAST);
    expect(a).not.toEqual(b);
  });

  it('different passphrase → different key', async () => {
    const salt = await generateSalt();
    const a = await deriveKEK('one', salt, FAST);
    const b = await deriveKEK('two', salt, FAST);
    expect(a).not.toEqual(b);
  });

  it('rejects empty passphrase', async () => {
    const salt = await generateSalt();
    await expect(deriveKEK('', salt, FAST)).rejects.toThrow(/non-empty/);
  });

  it('rejects salt with wrong length', async () => {
    await expect(deriveKEK('x', new Uint8Array(8), FAST)).rejects.toThrow(/salt/);
  });

  it('rejects unsupported alg', async () => {
    const salt = await generateSalt();
    await expect(
      deriveKEK('x', salt, { alg: 'scrypt' as 'argon2id', opslimit: 1, memlimit: 8192 }),
    ).rejects.toThrow(/unsupported KDF/);
  });

  it('SALT_BYTES is 16', () => {
    expect(SALT_BYTES).toBe(16);
  });

  it('KDF_DEFAULTS shape is stable', () => {
    expect(KDF_DEFAULTS.alg).toBe('argon2id');
    expect(KDF_DEFAULTS.opslimit).toBeGreaterThan(0);
    expect(KDF_DEFAULTS.memlimit).toBeGreaterThan(0);
  });
});

describe('generateSalt', () => {
  it('returns SALT_BYTES random bytes', async () => {
    const a = await generateSalt();
    const b = await generateSalt();
    expect(a.length).toBe(SALT_BYTES);
    expect(a).not.toEqual(b);
  });
});
