/**
 * Shared types for @gtd/crypto.
 *
 * Envelope = AEAD output (XChaCha20-Poly1305) with versioned shape.
 *   v=1 → no AAD (legacy ADR-017 envelopes; pre-2026-05-01 audit).
 *   v=2 → AAD-bound envelopes (ADR-018, audit N-2). The AAD is NOT stored
 *         in the envelope; the caller must reconstruct it on decrypt.
 *         For field encryption it's `${collection}|${id}|${field}|${user_id}|2`.
 *
 * KdfParams = Argon2id tuning. Stored alongside wrapped DEK so a future
 * relax/tighten of params still decrypts old envelopes.
 */

export type EnvelopeVersion = 1 | 2;

export type Envelope = {
  v: EnvelopeVersion;
  /** Base64url (no padding) nonce. 24 bytes for XChaCha20-Poly1305. */
  n: string;
  /** Base64url (no padding) ciphertext+tag. */
  c: string;
};

export type KdfParams = {
  alg: 'argon2id';
  /** libsodium opslimit. INTERACTIVE = 2; default raised to 3 in 2026-05-01. */
  opslimit: number;
  /** libsodium memlimit in bytes. INTERACTIVE = 64 MiB. */
  memlimit: number;
};

/**
 * Serialised wrap of a DEK: salt (for KDF) + AEAD envelope (DEK encrypted
 * with KEK) + the params used so a future re-derive uses the same numbers.
 */
export type WrappedDEK = {
  v: 1;
  /** Base64url (no padding) salt. */
  salt: string;
  envelope: Envelope;
  kdf: KdfParams;
};
