import { describe, expect, it } from 'vitest';
import { generateDEK } from './dek';
import { buildFieldAad, decryptField, encryptField } from './field';

describe('field encryption', () => {
  it('round-trips ascii', async () => {
    const dek = await generateDEK();
    const ct = await encryptField('Llamar a Pedro', dek);
    expect(await decryptField(ct, dek)).toBe('Llamar a Pedro');
  });

  it('round-trips empty string', async () => {
    const dek = await generateDEK();
    const ct = await encryptField('', dek);
    expect(await decryptField(ct, dek)).toBe('');
  });

  it('round-trips unicode', async () => {
    const dek = await generateDEK();
    const sample = 'café · 漢字 · 🧠 · नमस्ते · مرحبا';
    const ct = await encryptField(sample, dek);
    expect(await decryptField(ct, dek)).toBe(sample);
  });

  it('round-trips long-ish text (10 KB)', async () => {
    const dek = await generateDEK();
    const long = 'a'.repeat(10_000);
    const ct = await encryptField(long, dek);
    expect(await decryptField(ct, dek)).toBe(long);
  });

  it('produces different ciphertext for same plaintext', async () => {
    const dek = await generateDEK();
    const a = await encryptField('same', dek);
    const b = await encryptField('same', dek);
    expect(a).not.toBe(b);
  });

  it('decrypt with wrong DEK throws', async () => {
    const dek = await generateDEK();
    const wrong = await generateDEK();
    const ct = await encryptField('secret', dek);
    await expect(decryptField(ct, wrong)).rejects.toThrow();
  });

  it('decrypt of garbage throws cleanly', async () => {
    const dek = await generateDEK();
    await expect(decryptField('not-an-envelope', dek)).rejects.toThrow();
  });

  it('returned envelope is a string (Triplit S.String() compatible)', async () => {
    const dek = await generateDEK();
    const ct = await encryptField('hi', dek);
    expect(typeof ct).toBe('string');
    expect(ct.length).toBeGreaterThan(0);
  });

  // ADR-018 — AAD binding (audit N-2)

  it('round-trips with AAD', async () => {
    const dek = await generateDEK();
    const aad = buildFieldAad({
      collection: 'items',
      id: '01950000-0000-7000-8000-000000000001',
      field: 'title',
      userId: 'user-1',
    });
    const ct = await encryptField('Llamar a Pedro', dek, aad);
    expect(await decryptField(ct, dek, aad)).toBe('Llamar a Pedro');
  });

  it('decrypt with wrong AAD throws (different field)', async () => {
    const dek = await generateDEK();
    const ctx = {
      collection: 'items',
      id: '01950000-0000-7000-8000-000000000001',
      userId: 'user-1',
    };
    const aadTitle = buildFieldAad({ ...ctx, field: 'title' });
    const aadNotes = buildFieldAad({ ...ctx, field: 'notes' });
    const ct = await encryptField('secret', dek, aadTitle);
    await expect(decryptField(ct, dek, aadNotes)).rejects.toThrow();
  });

  it('decrypt with wrong AAD throws (different row)', async () => {
    const dek = await generateDEK();
    const aadA = buildFieldAad({
      collection: 'items',
      id: 'row-a',
      field: 'title',
      userId: 'user-1',
    });
    const aadB = buildFieldAad({
      collection: 'items',
      id: 'row-b',
      field: 'title',
      userId: 'user-1',
    });
    const ct = await encryptField('secret', dek, aadA);
    await expect(decryptField(ct, dek, aadB)).rejects.toThrow();
  });

  it('decrypt with wrong AAD throws (different user)', async () => {
    const dek = await generateDEK();
    const ctx = { collection: 'items', id: 'row-a', field: 'title' };
    const aadU1 = buildFieldAad({ ...ctx, userId: 'user-1' });
    const aadU2 = buildFieldAad({ ...ctx, userId: 'user-2' });
    const ct = await encryptField('secret', dek, aadU1);
    await expect(decryptField(ct, dek, aadU2)).rejects.toThrow();
  });

  it('legacy v=1 envelope decrypts without AAD argument', async () => {
    const dek = await generateDEK();
    const legacy = await encryptField('legacy', dek); // no AAD → v=1
    expect(await decryptField(legacy, dek)).toBe('legacy');
  });

  it('legacy v=1 envelope ignores caller-passed AAD (dual-read)', async () => {
    // Migration window: a reader doesn't know per-field whether the row is
    // v=1 or v=2 ahead of time. Passing AAD to a v=1 envelope must NOT
    // throw — aead.ts strips it. encryptField always emits the version
    // matching whether AAD was passed; decryptField branches on the
    // envelope's stored version.
    const dek = await generateDEK();
    const legacy = await encryptField('legacy', dek);
    const aad = buildFieldAad({
      collection: 'items',
      id: 'row-a',
      field: 'title',
      userId: 'user-1',
    });
    expect(await decryptField(legacy, dek, aad)).toBe('legacy');
  });
});
