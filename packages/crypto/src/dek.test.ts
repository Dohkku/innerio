import { describe, expect, it } from 'vitest';
import { KEYBYTES, randomBytes } from './aead';
import { generateDEK, unwrapDEK, wrapDEK } from './dek';

function randomKey(): Uint8Array {
  return randomBytes(KEYBYTES);
}

describe('DEK', () => {
  it('generateDEK returns 32 random bytes', async () => {
    const a = await generateDEK();
    const b = await generateDEK();
    expect(a.length).toBe(KEYBYTES);
    expect(a).not.toEqual(b);
  });

  it('wrap then unwrap returns the original DEK', async () => {
    const dek = await generateDEK();
    const kek = randomKey();
    const env = await wrapDEK(dek, kek);
    const out = await unwrapDEK(env, kek);
    expect(out).toEqual(dek);
  });

  it('unwrap with wrong KEK throws', async () => {
    const dek = await generateDEK();
    const kek = randomKey();
    const env = await wrapDEK(dek, kek);
    await expect(unwrapDEK(env, randomKey())).rejects.toThrow();
  });

  it('rejects DEK with wrong length', async () => {
    await expect(wrapDEK(new Uint8Array(16), randomKey())).rejects.toThrow(/32 bytes/);
  });

  it('two passphrases that derive different KEKs both wrap the same DEK', async () => {
    // Models the ADR-017 dual-wrap (passphrase + mnemonic recovery).
    const dek = await generateDEK();
    const kekA = randomKey();
    const kekB = randomKey();
    const envA = await wrapDEK(dek, kekA);
    const envB = await wrapDEK(dek, kekB);
    expect(await unwrapDEK(envA, kekA)).toEqual(dek);
    expect(await unwrapDEK(envB, kekB)).toEqual(dek);
    await expect(unwrapDEK(envA, kekB)).rejects.toThrow();
  });
});
