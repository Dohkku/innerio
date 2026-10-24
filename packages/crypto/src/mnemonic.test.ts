import { describe, expect, it } from 'vitest';
import { MNEMONIC_WORD_COUNT, generateMnemonic, isValidMnemonic, mnemonicToSeed } from './mnemonic';

describe('mnemonic', () => {
  it('generateMnemonic returns 12 English words', () => {
    const m = generateMnemonic();
    const words = m.split(' ');
    expect(words.length).toBe(MNEMONIC_WORD_COUNT);
    expect(words.every((w) => /^[a-z]+$/.test(w))).toBe(true);
  });

  it('generates distinct mnemonics', () => {
    expect(generateMnemonic()).not.toBe(generateMnemonic());
  });

  it('isValidMnemonic accepts a freshly generated phrase', () => {
    expect(isValidMnemonic(generateMnemonic())).toBe(true);
  });

  it('isValidMnemonic rejects a random phrase', () => {
    expect(isValidMnemonic('foo bar baz qux quux corge grault garply waldo fred plugh xyzzy')).toBe(
      false,
    );
  });

  it('isValidMnemonic rejects wrong word count', () => {
    expect(isValidMnemonic('abandon abandon abandon')).toBe(false);
  });

  it('mnemonicToSeed is deterministic', async () => {
    const m = generateMnemonic();
    const a = await mnemonicToSeed(m);
    const b = await mnemonicToSeed(m);
    expect(a).toEqual(b);
  });

  it('mnemonicToSeed returns 32 bytes', async () => {
    const seed = await mnemonicToSeed(generateMnemonic());
    expect(seed.length).toBe(32);
  });

  it('mnemonicToSeed throws on invalid input', async () => {
    await expect(mnemonicToSeed('not a valid mnemonic at all really nope')).rejects.toThrow(
      /invalid BIP39 mnemonic/,
    );
  });

  it('different mnemonics → different seeds', async () => {
    const a = await mnemonicToSeed(generateMnemonic());
    const b = await mnemonicToSeed(generateMnemonic());
    expect(a).not.toEqual(b);
  });
});
