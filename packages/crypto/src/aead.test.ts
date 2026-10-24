import { describe, expect, it } from 'vitest';
import { KEYBYTES, aeadDecrypt, aeadEncrypt, randomBytes } from './aead';

const enc = new TextEncoder();
const dec = new TextDecoder();

function randomKey(): Uint8Array {
  return randomBytes(KEYBYTES);
}

describe('aead', () => {
  it('round-trips arbitrary bytes', () => {
    const key = randomKey();
    const pt = enc.encode('hello world ñ 漢字 🌮');
    const env = aeadEncrypt(pt, key);
    expect(dec.decode(aeadDecrypt(env, key))).toBe('hello world ñ 漢字 🌮');
  });

  it('round-trips empty buffer', () => {
    const key = randomKey();
    const env = aeadEncrypt(new Uint8Array(0), key);
    expect(aeadDecrypt(env, key).length).toBe(0);
  });

  it('produces a different ciphertext for the same plaintext (random nonce)', () => {
    const key = randomKey();
    const pt = enc.encode('repeat me');
    const a = aeadEncrypt(pt, key);
    const b = aeadEncrypt(pt, key);
    expect(a.n).not.toBe(b.n);
    expect(a.c).not.toBe(b.c);
  });

  it('decrypt with wrong key throws', () => {
    const key = randomKey();
    const wrong = randomKey();
    const env = aeadEncrypt(enc.encode('secret'), key);
    expect(() => aeadDecrypt(env, wrong)).toThrow();
  });

  it('decrypt with tampered ciphertext throws', () => {
    const key = randomKey();
    const env = aeadEncrypt(enc.encode('secret'), key);
    // Flip a character in the base64 ciphertext.
    const tamperedC = env.c.slice(0, -2) + (env.c.endsWith('A') ? 'B' : 'A') + env.c.slice(-1);
    expect(() => aeadDecrypt({ ...env, c: tamperedC }, key)).toThrow();
  });

  it('rejects key with wrong length', () => {
    const env = aeadEncrypt(enc.encode('x'), randomKey());
    expect(() => aeadDecrypt(env, new Uint8Array(16))).toThrow(/32 bytes/);
    expect(() => aeadEncrypt(new Uint8Array(0), new Uint8Array(16))).toThrow(/32 bytes/);
  });

  it('rejects unsupported envelope version', () => {
    const env = aeadEncrypt(enc.encode('x'), randomKey());
    expect(() => aeadDecrypt({ ...env, v: 9 as unknown as 1 }, randomKey())).toThrow(/version/);
  });

  // ADR-018 — AAD support (audit N-2, 2026-05-01)

  it('round-trips with AAD; envelope is v=2', () => {
    const key = randomKey();
    const aad = enc.encode('items|abc|title|user-1|2');
    const env = aeadEncrypt(enc.encode('hola'), key, aad);
    expect(env.v).toBe(2);
    expect(dec.decode(aeadDecrypt(env, key, aad))).toBe('hola');
  });

  it('decrypt with mismatched AAD throws', () => {
    const key = randomKey();
    const aad = enc.encode('items|abc|title|user-1|2');
    const env = aeadEncrypt(enc.encode('hola'), key, aad);
    const wrongAad = enc.encode('items|abc|notes|user-1|2');
    expect(() => aeadDecrypt(env, key, wrongAad)).toThrow();
  });

  it('decrypt of v=2 envelope without AAD throws', () => {
    const key = randomKey();
    const env = aeadEncrypt(enc.encode('hola'), key, enc.encode('xyz'));
    expect(() => aeadDecrypt(env, key)).toThrow();
  });

  it('legacy v=1 envelopes ignore caller-supplied AAD (forward-compat)', () => {
    const key = randomKey();
    const env = aeadEncrypt(enc.encode('hola'), key); // no AAD → v=1
    expect(env.v).toBe(1);
    // Caller may pass an AAD without realising the row is legacy; v=1
    // strips it and decrypts as plaintext.
    expect(dec.decode(aeadDecrypt(env, key, enc.encode('any')))).toBe('hola');
  });

  it('encryptor without AAD emits v=1 (backwards-compat for DEK wrapping)', () => {
    const key = randomKey();
    const env = aeadEncrypt(enc.encode('x'), key);
    expect(env.v).toBe(1);
  });
});
