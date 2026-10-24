/**
 * Public API for @gtd/crypto.
 *
 * All ops are async because libsodium needs `sodium.ready`. Each helper
 * awaits internally — call them directly. Use `ready()` only if you want
 * to preload the WASM at app boot.
 *
 * Design pinned in ADR-017.
 */

export { aeadDecrypt, aeadEncrypt, KEYBYTES } from './aead';
export { generateDEK, unwrapDEK, wrapDEK } from './dek';
export { decodeEnvelope, encodeEnvelope } from './envelope';
export { buildFieldAad, decryptField, encryptField } from './field';
export {
  deriveKEK,
  generateSalt,
  KDF_DEFAULTS,
  MAX_MEMLIMIT,
  MAX_OPSLIMIT,
  ready,
  SALT_BYTES,
} from './kdf';
export {
  generateMnemonic,
  isValidMnemonic,
  MNEMONIC_ENTROPY_BITS,
  MNEMONIC_WORD_COUNT,
  mnemonicToSeed,
} from './mnemonic';
export type { Envelope, EnvelopeVersion, KdfParams, WrappedDEK } from './types';
