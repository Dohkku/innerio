/**
 * On-device DEK cache (Phase 9 slice 3, ADR-017).
 *
 * Stores the unwrapped DEK in IndexedDB encrypted with a non-extractable
 * AES-GCM device key. The wrapping key's bytes never become accessible to
 * JS, only its `encrypt`/`decrypt` ops. Defense-in-depth: an attacker with
 * raw disk access cannot extract the DEK without spawning a browser
 * context bound to this origin.
 *
 * Threat model footnote: not bulletproof. Anyone with code execution in
 * the page can use the wrapping key. This raises the bar against simple
 * disk dumps; matches Bitwarden/1Password browser-extension practice.
 */

const DB_NAME = 'innerio-crypto';
const DB_VERSION = 1;
const STORE = 'cache';

// Single-row schema:
//   key='wrap-key' → CryptoKey (AES-GCM 256, non-extractable)
//   key='dek'      → { user_id, nonce: Uint8Array, ct: Uint8Array }

type CachedDEK = {
  user_id: string;
  nonce: Uint8Array;
  ct: Uint8Array;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getOrCreateWrapKey(): Promise<CryptoKey> {
  const existing = await idbGet<CryptoKey>('wrap-key');
  if (existing) return existing;
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['encrypt', 'decrypt'],
  );
  await idbPut('wrap-key', key);
  return key;
}

// SubtleCrypto's typings demand `BufferSource` whose buffer is strictly
// `ArrayBuffer`. TS infers `ArrayBufferLike` for our `Uint8Array`s (could
// be `SharedArrayBuffer` in theory). Cast at the boundary to keep the call
// sites readable.
function asBuf(u: Uint8Array): BufferSource {
  return u as unknown as BufferSource;
}

/** Caches `dek` under the device wrap key, scoped to `user_id`. */
export async function cacheDEK(userId: string, dek: Uint8Array): Promise<void> {
  const wrapKey = await getOrCreateWrapKey();
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: asBuf(nonce) }, wrapKey, asBuf(dek)),
  );
  const cached: CachedDEK = { user_id: userId, nonce, ct };
  await idbPut('dek', cached);
}

/** Returns the cached DEK if present and matches `userId`, else null. */
export async function loadCachedDEK(userId: string): Promise<Uint8Array | null> {
  const cached = await idbGet<CachedDEK>('dek');
  if (!cached || cached.user_id !== userId) return null;
  const wrapKey = await idbGet<CryptoKey>('wrap-key');
  if (!wrapKey) return null;
  try {
    const pt = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: asBuf(cached.nonce) },
        wrapKey,
        asBuf(cached.ct),
      ),
    );
    return pt;
  } catch {
    // Corrupt cache or wrap key mismatch — wipe and force re-unlock.
    await idbDelete('dek');
    return null;
  }
}

/** Clear cached DEK only (keeps wrap key for future cache writes). */
export async function clearCachedDEK(): Promise<void> {
  await idbDelete('dek');
}

/** Wipe everything — used by sign-out and account deletion. */
export async function purgeCryptoCache(): Promise<void> {
  await idbDelete('dek');
  await idbDelete('wrap-key');
}
