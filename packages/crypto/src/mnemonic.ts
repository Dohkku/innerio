/**
 * BIP39 mnemonic = recovery phrase. 128 bits of entropy → 12 English
 * words. Derived seed (PBKDF2-HMAC-SHA512) is 64 bytes; we take the first
 * 32 as a recovery KEK that unwraps the same DEK as the passphrase path.
 *
 * Wordlist locked to English only — recovery on any device with no
 * locale assumptions.
 */

import {
  generateMnemonic as bip39Generate,
  mnemonicToSeed as bip39MnemonicToSeed,
  validateMnemonic,
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

export const MNEMONIC_WORD_COUNT = 12;
export const MNEMONIC_ENTROPY_BITS = 128;

export function generateMnemonic(): string {
  return bip39Generate(wordlist, MNEMONIC_ENTROPY_BITS);
}

export function isValidMnemonic(mnemonic: string): boolean {
  return validateMnemonic(mnemonic, wordlist);
}

/**
 * Returns 32 bytes suitable as a recovery KEK. Throws on invalid mnemonic.
 * BIP39 PBKDF2 is intentionally slow — call once at unlock, cache the
 * unwrapped DEK on the device.
 */
export async function mnemonicToSeed(mnemonic: string): Promise<Uint8Array> {
  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new Error('crypto: invalid BIP39 mnemonic');
  }
  const seed = await bip39MnemonicToSeed(mnemonic);
  return seed.slice(0, 32);
}
