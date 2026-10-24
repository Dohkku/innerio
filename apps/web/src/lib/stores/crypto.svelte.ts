/**
 * E2EE crypto store (Phase 9 slice 3, ADR-017).
 *
 * State machine:
 *   idle             → not started yet (pre-login or session not ready)
 *   loading          → fetching envelope from /api/auth/crypto-envelope
 *   setup-required   → no envelope on server; modal asks for passphrase
 *   unlock-required  → envelope on server, no local DEK; modal asks
 *   unlocked         → DEK in memory + cached on device
 *   error            → fetch failed; surface to user, allow retry
 *
 * The current DEK lives in `dek` ($state). It is `null` when the store is
 * not unlocked; readers (slice 4 wrapper) MUST handle that case.
 *
 * Driven from `session.svelte.ts`:
 *   - on login (after `attachTriplitToken`): `crypto.init(userId)`.
 *   - on logout: `crypto.reset()`.
 */

import { type ServerEnvelope, createEnvelope, fetchEnvelope } from '$lib/crypto/api';
import { cacheDEK, loadCachedDEK, purgeCryptoCache } from '$lib/crypto/cache';
import {
  KDF_DEFAULTS,
  type KdfParams,
  decodeEnvelope,
  decryptField,
  deriveKEK,
  encodeEnvelope,
  encryptField,
  generateDEK,
  generateMnemonic,
  generateSalt,
  mnemonicToSeed,
  unwrapDEK,
  wrapDEK,
} from '@gtd/crypto';

// base64url codec — small inline helper avoids pulling @scure/base as a
// direct dep of @gtd/web (it's already a transitive dep via @gtd/crypto).
function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64decode(s: string): Uint8Array {
  const padded = s
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(s.length + ((4 - (s.length % 4)) % 4), '=');
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export type CryptoStatus =
  | 'idle'
  | 'loading'
  | 'setup-required'
  | 'unlock-required'
  | 'unlocked'
  | 'error';

class CryptoStore {
  status = $state<CryptoStatus>('idle');
  /** Set when status is 'unlock-required' or 'unlocked' so unlock UI can use it. */
  envelope = $state<ServerEnvelope | null>(null);
  errorMessage = $state<string | null>(null);
  /**
   * Cumulative count of rows that failed to decrypt during this session
   * (audit N-9, 2026-05-01). `decryptResults` and `decryptRow` swallow
   * errors per-field so a single bad row doesn't break list views, but a
   * silent failure looks identical to "this field is empty" — which would
   * mask data corruption (lost field, AAD mismatch under N-2, swapped
   * ciphertext blob). Surfacing a counter lets us paint a banner like
   * "3 elementos no se han podido descifrar" once we wire UI for it.
   * Reset on `reset()`. Updated by `noteDecryptError`.
   */
  decryptErrors = $state(0);
  /** First few row IDs that failed — capped to avoid runaway memory. */
  decryptErrorSamples = $state<{ collection: string; id: string; field: string }[]>([]);
  /** Held in memory only while unlocked. Slice 4 wrapper reads via `getDEK()`. */
  private dek: Uint8Array | null = null;
  /** Tracks the user_id this store was init'd against — guards against stale state. */
  private currentUserId: string | null = null;
  /**
   * Per-collection warn-once dedup so we don't spam the console when a
   * whole list view fails to decrypt (e.g. wrong DEK reaches a stale tab).
   */
  private warnedCollections = new Set<string>();
  private static readonly SAMPLE_CAP = 20;

  /**
   * Called by `encrypted-row.ts` whenever a field decrypt throws. Centralised
   * here so the wrapper layer doesn't need to import the store; we expose
   * the counter via the store and let the wrapper push into it.
   */
  noteDecryptError(collection: string, id: string, field: string): void {
    this.decryptErrors += 1;
    if (this.decryptErrorSamples.length < CryptoStore.SAMPLE_CAP) {
      this.decryptErrorSamples = [...this.decryptErrorSamples, { collection, id, field }];
    }
    if (!this.warnedCollections.has(collection)) {
      this.warnedCollections.add(collection);
      console.warn(
        `[crypto] decrypt failed in ${collection} (first occurrence; ${id}.${field}). Subsequent failures in this collection are suppressed; counter visible at cryptoStore.decryptErrors.`,
      );
    }
  }
  /**
   * Listeners called when status flips to 'unlocked'. The Triplit wrapper
   * uses this to re-process subscriptions that received ciphertext during
   * the boot race (subscribe fires from local IDB before `init` finishes
   * loading the cached DEK).
   */
  private unlockListeners = new Set<() => void>();

  onUnlock(cb: () => void): () => void {
    this.unlockListeners.add(cb);
    if (this.isUnlocked) cb();
    return () => this.unlockListeners.delete(cb);
  }

  private fireUnlock(): void {
    for (const cb of this.unlockListeners) {
      try {
        cb();
      } catch (err) {
        console.error('[crypto] unlock listener failed', err);
      }
    }
  }

  get isUnlocked(): boolean {
    return this.status === 'unlocked' && this.dek !== null;
  }

  /**
   * Returns the in-memory DEK or null. Slice 4 callers MUST treat null as
   * "not unlocked yet" and gate inserts/reads of encrypted content fields.
   */
  getDEK(): Uint8Array | null {
    return this.dek;
  }

  /**
   * Bootstrap entry point. Called from `session.refresh()` after the
   * Triplit token is attached. Order matters: server-side row scoping
   * relies on the JWT user_id; the crypto unlock can run in parallel
   * with sync, but content writes must wait for `isUnlocked`.
   */
  async init(userId: string): Promise<void> {
    if (this.currentUserId === userId && this.status === 'unlocked') return;
    this.currentUserId = userId;
    this.errorMessage = null;
    this.status = 'loading';
    try {
      // Fast path: device already has a cached DEK for this user.
      const cached = await loadCachedDEK(userId);
      if (cached) {
        this.dek = cached;
        // Best-effort: still fetch envelope so it's in store state for
        // unlock-via-mnemonic flows / settings page.
        try {
          this.envelope = await fetchEnvelope();
        } catch {
          // ignore — cache is enough to unlock
        }
        this.status = 'unlocked';
        this.fireUnlock();
        return;
      }

      const env = await fetchEnvelope();
      if (!env) {
        this.envelope = null;
        this.status = 'setup-required';
        return;
      }
      this.envelope = env;
      this.status = 'unlock-required';
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
      this.status = 'error';
    }
  }

  /**
   * Setup flow result — surfaces the freshly generated mnemonic so the
   * UI can show it ONCE in a copy-to-clipboard panel. Caller must require
   * an explicit "I have stored this" confirmation before discarding.
   */
  async setup(passphrase: string): Promise<{ mnemonic: string }> {
    if (this.status !== 'setup-required') {
      throw new Error('crypto: setup only allowed from setup-required state');
    }
    if (!this.currentUserId) throw new Error('crypto: no user id');
    if (passphrase.length < 12) throw new Error('crypto: passphrase too short (min 12)');

    const dek = await generateDEK();
    const mnemonic = generateMnemonic();
    const params: KdfParams = KDF_DEFAULTS;

    const saltP = await generateSalt();
    const kekP = await deriveKEK(passphrase, saltP, params);
    const wrappedP = await wrapDEK(dek, kekP);

    const saltM = await generateSalt();
    const seed = await mnemonicToSeed(mnemonic);
    const wrappedM = await wrapDEK(dek, seed);

    const env = await createEnvelope({
      salt_passphrase: b64encode(saltP),
      salt_mnemonic: b64encode(saltM), // unused for derive (mnemonic is its own seed) but stored for v2 / future migration
      wrapped_dek_passphrase: encodeEnvelope(wrappedP),
      wrapped_dek_mnemonic: encodeEnvelope(wrappedM),
      kdf_params: params,
    });

    this.envelope = env;
    this.dek = dek;
    await cacheDEK(this.currentUserId, dek);
    this.status = 'unlocked';
    this.fireUnlock();
    return { mnemonic };
  }

  async unlockWithPassphrase(passphrase: string): Promise<void> {
    if (this.status !== 'unlock-required') {
      throw new Error('crypto: unlock only allowed from unlock-required state');
    }
    if (!this.envelope) throw new Error('crypto: no envelope loaded');
    if (!this.currentUserId) throw new Error('crypto: no user id');
    const env = this.envelope;

    const salt = b64decode(env.salt_passphrase);
    const params = env.kdf_params as KdfParams;
    const kek = await deriveKEK(passphrase, salt, params);
    const dek = await unwrapDEK(decodeEnvelope(env.wrapped_dek_passphrase), kek);
    this.dek = dek;
    await cacheDEK(this.currentUserId, dek);
    this.status = 'unlocked';
    this.fireUnlock();
  }

  async unlockWithMnemonic(mnemonic: string): Promise<void> {
    if (this.status !== 'unlock-required') {
      throw new Error('crypto: unlock only allowed from unlock-required state');
    }
    if (!this.envelope) throw new Error('crypto: no envelope loaded');
    if (!this.currentUserId) throw new Error('crypto: no user id');
    const env = this.envelope;

    const seed = await mnemonicToSeed(mnemonic.trim());
    const dek = await unwrapDEK(decodeEnvelope(env.wrapped_dek_mnemonic), seed);
    this.dek = dek;
    await cacheDEK(this.currentUserId, dek);
    this.status = 'unlocked';
    this.fireUnlock();
  }

  /**
   * Check that a typed passphrase matches the currently-unlocked DEK.
   * Usado por QR pairing antes de mostrar el código: re-pedir passphrase
   * actúa como segundo factor de "soy quien creo ser, no alguien que
   * pasaba por el PC desbloqueado".
   *
   * No depende de `unlock-required` — funciona solo si ya está unlocked.
   * Sin envelope cargada o sin DEK actual devuelve false en vez de tirar.
   */
  async verifyPassphrase(passphrase: string): Promise<boolean> {
    if (this.status !== 'unlocked') return false;
    if (!this.envelope || !this.dek) return false;
    try {
      const env = this.envelope;
      const salt = b64decode(env.salt_passphrase);
      const params = env.kdf_params as KdfParams;
      const kek = await deriveKEK(passphrase, salt, params);
      const candidate = await unwrapDEK(decodeEnvelope(env.wrapped_dek_passphrase), kek);
      // Compare byte-by-byte. DEKs son 32 bytes; constant-time comparison
      // para no exponer timing si esto se usara en bucle.
      if (candidate.length !== this.dek.length) return false;
      let diff = 0;
      for (let i = 0; i < candidate.length; i++) diff |= candidate[i] ^ this.dek[i];
      return diff === 0;
    } catch {
      return false;
    }
  }

  /** Roundtrip self-check used by the setup modal's "verify before commit" step. */
  async verifyRoundtrip(sample = 'innerio-e2ee-self-check'): Promise<boolean> {
    if (!this.dek) return false;
    try {
      const ct = await encryptField(sample, this.dek);
      const pt = await decryptField(ct, this.dek);
      return pt === sample;
    } catch {
      return false;
    }
  }

  /**
   * Wipes in-memory + on-device DEK. Called by session.signOut() and
   * session.deleteAccount(). The server-side envelope row is wiped by the
   * existing `afterDelete` cascade once slice 8 lands.
   */
  async reset(): Promise<void> {
    this.dek = null;
    this.envelope = null;
    this.currentUserId = null;
    this.status = 'idle';
    this.errorMessage = null;
    this.decryptErrors = 0;
    this.decryptErrorSamples = [];
    this.warnedCollections.clear();
    await purgeCryptoCache();
  }
}

// Lazy singleton (boot fix 2026-05-01). Vite emits a circular import between
// the Svelte runtime chunk (`PpwQfKLc.js`) and the app chunk (`lVWyzpgV.js`).
// In DFS post-order eval the app chunk's body runs first, so a top-level
// `new CryptoStore()` would call `$state(...)` (Svelte's `state()`) before
// the runtime's `var J = null;` initialiser had executed — `J` was still
// `undefined`, the `J === null` branch failed, and `J.push(...)` threw
// `Cannot read properties of undefined (reading 'push')`, blocking boot.
// Deferring instantiation until first access (which only happens during
// component render / effects, well past module-eval time) sidesteps the
// cycle without touching consumers.
let _instance: CryptoStore | undefined;
function getInstance(): CryptoStore {
  if (!_instance) _instance = new CryptoStore();
  return _instance;
}
export const cryptoStore: CryptoStore = new Proxy({} as CryptoStore, {
  get(_t, prop) {
    const target = getInstance();
    const v = Reflect.get(target, prop, target);
    return typeof v === 'function' ? v.bind(target) : v;
  },
  set(_t, prop, value) {
    const target = getInstance();
    return Reflect.set(target, prop, value, target);
  },
  has(_t, prop) {
    return prop in getInstance();
  },
});
