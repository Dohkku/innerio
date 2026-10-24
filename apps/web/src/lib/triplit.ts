import {
  ENCRYPTED_FIELDS,
  decryptResults,
  decryptRow,
  encryptPatch,
  encryptRow,
  isEncryptedCollection,
} from '$lib/crypto/encrypted-row';
import { cryptoStore } from '$lib/stores/crypto.svelte';
/**
 * TriplitClient with E2EE wrapper (Phase 9 slice 4, ADR-017; AAD upgrade
 * per ADR-018 / audit N-2 on 2026-05-01).
 *
 * Two layers of override on the singleton client:
 *
 *  1. `user_id` stamping on insert. The server's `userOwned()` permission
 *     rejects writes whose `user_id` doesn't match the JWT claim; capture
 *     sites don't pass it, so we inject it here. (Pre-E2EE behavior, kept.)
 *
 *  2. End-to-end encryption of content fields. When the crypto store is
 *     unlocked, every insert/update/fetch/subscribe goes through
 *     `encrypted-row.ts`. AAD = `${collection}|${id}|${field}|${user_id}|2`
 *     binds each ciphertext to its row+field+user, so an attacker with
 *     write access to the SQLite file cannot shuffle envelopes between
 *     rows/fields/users — the AEAD tag fails on decrypt. The wrapper
 *     therefore must know the row id BEFORE encryption; for inserts that
 *     means generating a uuidv7 client-side here rather than letting
 *     Triplit auto-fill on persist.
 *
 *  The `update(collection, id, fn)` form is the trickiest: we have to run
 *  the user's mutation function against a plaintext proxy, capture the
 *  writes, then re-apply the encrypted version to the real entity. This
 *  costs an extra `fetchById` round-trip per update on encrypted
 *  collections — acceptable for the small scale we run at.
 */
import { schema } from '@gtd/schema';
import { TriplitClient } from '@triplit/client';
import { Logger as TriplitLogger } from '@triplit/logger';

const SERVER = import.meta.env.VITE_TRIPLIT_SERVER ?? '';
const ANON_TOKEN = import.meta.env.VITE_TRIPLIT_TOKEN ?? '';

/**
 * Logger custom que silencia el "Schema update failed during initialization"
 * de Triplit. El cliente lo emite en cada boot porque considera la primera
 * instalación del schema un "change" no-auto-migrable y cae al savedSchema
 * de IDB — ruido inofensivo (la app funciona). Mantiene todo el resto del
 * logging intacto: solo este mensaje concreto se descarta.
 */
class FilteredLogger extends TriplitLogger {
  error(message: string, attributes?: Record<string, unknown>): void {
    if (
      typeof message === 'string' &&
      message.includes('Schema update failed during initialization')
    ) {
      return;
    }
    super.error(message, attributes);
  }
}

export const triplit = new TriplitClient({
  schema,
  serverUrl: SERVER || undefined,
  token: ANON_TOKEN || undefined,
  storage: 'indexeddb',
  autoConnect: Boolean(SERVER && ANON_TOKEN),
  logger: new FilteredLogger(),
});

if (import.meta.env.DEV) {
  // biome-ignore lint/suspicious/noExplicitAny: dev-only debug surface
  (globalThis as any).triplit = triplit;
  // biome-ignore lint/suspicious/noExplicitAny: dev-only debug surface
  (globalThis as any).cryptoStore = cryptoStore;
}

let currentUserId = '';
export function setTriplitUserId(id: string): void {
  currentUserId = id;
}

// --- helpers --------------------------------------------------------------

function dekOrNull(): Uint8Array | null {
  return cryptoStore.isUnlocked ? cryptoStore.getDEK() : null;
}

/**
 * Triplit 1.1.10 no aplica `S.Default.*` consistentemente en el sync push
 * path, así que estampamos a mano los defaults requeridos por el server.
 * Insert path se usa en `sanitized`; update path en `writes` (sólo cubre
 * los que pueden faltar tras un update parcial).
 */
const ITEM_INSERT_DEFAULTS: Record<string, unknown> = {
  position: 'a0',
  is_sequential: false,
  notes: '',
  enc_v: 0,
};

/**
 * Returns a mutator that, when run against a Triplit entity proxy, copies
 * every entry from `encrypted` onto it. `skipId=true` for the legacy →
 * enc_v=2 promotion path, where Triplit rejects any write to `id` even if
 * the value is identical.
 */
function applyAsMutator(
  encrypted: Record<string, unknown>,
  { skipId }: { skipId: boolean },
): (e: Record<string, unknown>) => void {
  return (e) => {
    for (const [k, v] of Object.entries(encrypted)) {
      if (skipId && k === 'id') continue;
      e[k] = v;
    }
  };
}

// Triplit's query objects expose the collection name on the prototype.
// Different versions name it differently; check both common keys before
// giving up and passing through.
// biome-ignore lint/suspicious/noExplicitAny: query shape is generic
function collectionFromQuery(q: any): string | null {
  if (!q || typeof q !== 'object') return null;
  if (typeof q.collectionName === 'string') return q.collectionName;
  if (typeof q.collection === 'string') return q.collection;
  return null;
}

/**
 * Inline UUIDv7 generator. Used for E2EE inserts where the AAD needs the
 * row id stamped before the ciphertext is sealed. Format: 48-bit unix-ms
 * timestamp · 4-bit version (7) · 12 bits random · 2-bit variant (10) ·
 * 62 bits random. Compact, cryptographically random tail via
 * `crypto.getRandomValues`. Triplit's `S.Id({ format: 'uuidv7' })` accepts
 * any string that matches the canonical hex shape.
 */
function uuidv7(): string {
  const ms = Date.now();
  const tsHex = ms.toString(16).padStart(12, '0');
  const rand = new Uint8Array(10);
  globalThis.crypto.getRandomValues(rand);
  // Top nibble of byte 0 → version (7); top 2 bits of byte 2 → variant (10)
  rand[0] = (rand[0] & 0x0f) | 0x70;
  rand[2] = (rand[2] & 0x3f) | 0x80;
  const hex = Array.from(rand, (b) => b.toString(16).padStart(2, '0')).join('');
  return [
    tsHex.slice(0, 8),
    tsHex.slice(8, 12),
    hex.slice(0, 4),
    hex.slice(4, 8),
    hex.slice(8, 20),
  ].join('-');
}

// --- override: insert -----------------------------------------------------

const _origInsert = triplit.insert.bind(triplit);
// biome-ignore lint/suspicious/noExplicitAny: structural override of generic insert
(triplit as any).insert = async (collection: string, data: any, ...rest: unknown[]) => {
  let payload = data;
  if (payload && typeof payload === 'object') {
    if (currentUserId) {
      // Always force user_id to the current session. The server's userOwned()
      // permission would reject a mismatch, but stamping it here closes the
      // window between an attacker-controlled call site and the network.
      // adopt.ts runs BEFORE setTriplitUserId so currentUserId='' there and
      // the manual stamping path stays free. Audit S3 (2026-05-03).
      if (!('user_id' in payload) || payload.user_id !== currentUserId) {
        payload = { ...payload, user_id: currentUserId };
      }
    } else if (!('user_id' in payload)) {
      // Pre-session insert (demo captures). The schema defaults `user_id`
      // to '' but that default is NOT applied on the sync push path —
      // Triplit serialises the change verbatim and the server rejects
      // with DBSerializationError "user_id undefined". Stamp '' explicitly
      // so adopt.ts can later rotate it to the real userId via update.
      payload = { ...payload, user_id: '' };
    }
  }
  // Stamp schema-default fields explicitly. Triplit 1.1.10 no aplica
  // S.Default.now() / S.Default('a0') / S.Default(false) en el sync push
  // path: el server recibe el change con created_at/position/is_sequential
  // ausentes y rechaza con DBSerializationError "Property X is invalid".
  //
  // Date fields se pasan como ISO string (no Date object). Con id
  // explícito + Date, Triplit 1.1.10 NO llama a su encoder y guarda el
  // Date como object literal en IDB → al broadcast deserialize falla con
  // DBDeserializationError. El encoder acepta string parseable (mira
  // type.ts:120) así que ISO string sortea el bug. update() sí convierte
  // Date→ISO en su proxy, por eso este parche solo aplica al insert.
  if (collection === 'items' && payload && typeof payload === 'object') {
    const nowIso = new Date().toISOString();
    const sanitized: Record<string, unknown> = {
      created_at: nowIso,
      updated_at: nowIso,
      ...ITEM_INSERT_DEFAULTS,
      ...payload,
    };
    // Convierte cualquier Date object a ISO string — mismo bug de
    // id+Date descrito arriba aplica a clarified_at, due_at, etc. si el
    // caller los pasa como Date en lugar de via update().
    for (const [k, v] of Object.entries(sanitized)) {
      if (v instanceof Date) sanitized[k] = v.toISOString();
    }
    payload = sanitized;
  } else if (collection === 'settings' && payload && typeof payload === 'object') {
    if (!('enc_v' in payload)) payload = { ...payload, enc_v: 0 };
  }
  const dek = dekOrNull();
  if (dek && isEncryptedCollection(collection)) {
    // Generate the id client-side if absent — AAD binds to it.
    const ensuredId =
      typeof payload?.id === 'string' && payload.id.length > 0 ? payload.id : uuidv7();
    // AAD must bind to the user_id that's actually stamped on the row.
    // Prefer the payload's user_id (set above) and fall back to
    // currentUserId, which mirrors what encryptRow writes back as
    // out.user_id. Pre-login captures legitimately have userId=''.
    const aadUserId =
      (typeof payload?.user_id === 'string' && payload.user_id) || currentUserId || '';
    payload = await encryptRow(
      { collection, id: ensuredId, userId: aadUserId },
      { ...payload, id: ensuredId },
      dek,
    );
  }
  return _origInsert(collection as never, payload as never, ...(rest as []));
};

// --- override: update -----------------------------------------------------

const _origUpdate = triplit.update.bind(triplit);
const _origFetchById = triplit.fetchById.bind(triplit);

/**
 * Wrap a Triplit mutator so any attempt to reassign `user_id` to a value
 * other than the current session is silently dropped. Triplit's
 * `update.filter` is checked pre-update, so without this a malicious caller
 * could `e.user_id = 'B'` and "transfer" their row out of scope. adopt.ts
 * runs BEFORE setTriplitUserId (currentUserId='') so legacy stamping still
 * works. Audit S3 (2026-05-03).
 */
let _userIdGuardWarned = false;
// biome-ignore lint/suspicious/noExplicitAny: mutator signature is generic
function guardUserIdMutator(fn: any): any {
  // biome-ignore lint/suspicious/noExplicitAny: entity proxy is generic
  return async (entity: any) => {
    if (!currentUserId) return fn(entity);
    const guarded = new Proxy(entity, {
      set(target, key, value) {
        if (key === 'user_id' && value !== currentUserId) {
          if (!_userIdGuardWarned) {
            console.warn('[triplit] blocked user_id reassignment via update mutator');
            _userIdGuardWarned = true;
          }
          return true;
        }
        (target as Record<string, unknown>)[key as string] = value;
        return true;
      },
    });
    return fn(guarded);
  };
}

// biome-ignore lint/suspicious/noExplicitAny: structural override
(triplit as any).update = async (
  collection: string,
  id: string,
  // biome-ignore lint/suspicious/noExplicitAny: mutator signature is generic
  mutator: any,
  ...rest: unknown[]
) => {
  // Wrap caller's mutator so updated_at se bumpea automáticamente — Triplit
  // 1.1.10 no aplica S.Default.now() en updates y los pushes acaban sin el
  // campo, lo que rompe la validation server-side en collections con
  // updated_at requerido. Hacerlo aquí cubre todos los callers sin
  // duplicar la línea en cada delete/update.
  const wrapMutator =
    (fn: (e: Record<string, unknown>) => void) => (e: Record<string, unknown>) => {
      fn(e);
      if (collection === 'items') e.updated_at = new Date();
    };
  const mutatorPlus =
    typeof mutator === 'function' && collection === 'items' ? wrapMutator(mutator) : mutator;
  const guardedMutator =
    typeof mutatorPlus === 'function' ? guardUserIdMutator(mutatorPlus) : mutatorPlus;
  const dek = dekOrNull();
  if (!dek || !isEncryptedCollection(collection) || typeof mutatorPlus !== 'function') {
    // BYPASS PATH (dek=null o collection no cifrada o mutator no es función).
    // Bug 2026-05-21: en este path el mutator se aplicaba al proxy de Triplit
    // directamente, así que si el caller hacía `e.title = newTitle`, el row
    // local quedaba con title=plaintext + enc_v=2 del estado anterior →
    // decryptRow fallaba para siempre. Si la colección es cifrada y dek=null
    // (típico durante el boot mientras cryptoStore.init carga el cache),
    // envolvemos el mutator en un guard que lanza si se intenta escribir a
    // un campo cifrado. adopt.ts (rota user_id, no cifrado) sigue
    // funcionando; renameItem y similares fallan ruidosamente en vez de
    // corromper datos en silencio.
    if (!dek && isEncryptedCollection(collection) && typeof mutatorPlus === 'function') {
      const cfg = ENCRYPTED_FIELDS[collection];
      const encField = cfg ? new Set<string>([...cfg.strings, ...cfg.json]) : null;
      if (encField) {
        const safeWrapped = (e: Record<string, unknown>) => {
          const proxy = new Proxy(e, {
            set(target, key, value) {
              // Only plaintext content can leak or corrupt. Clearing a field
              // (undefined/null/'') is always safe, and so is writing in demo
              // mode (no session) to a row that was never encrypted: those rows
              // stay enc_v=0 until adopt + the migration sweep encrypt them.
              // Bug 2026-10-24: applyStateTransition clears `waiting_for`, so
              // the old unconditional throw broke /process in demo mode.
              const clearing = value === undefined || value === null || value === '';
              const rowEncrypted = Number((target as Record<string, unknown>).enc_v ?? 0) > 0;
              if (
                typeof key === 'string' &&
                encField.has(key) &&
                !clearing &&
                (currentUserId !== '' || rowEncrypted)
              ) {
                throw new Error(
                  `[crypto] cannot update encrypted field "${key}" while locked (cryptoStore not unlocked yet)`,
                );
              }
              (target as Record<string, unknown>)[key as string] = value;
              return true;
            },
          });
          return mutatorPlus(proxy);
        };
        const guardedSafe = guardUserIdMutator(safeWrapped);
        return _origUpdate(collection as never, id as never, guardedSafe as never, ...(rest as []));
      }
    }
    return _origUpdate(collection as never, id as never, guardedMutator as never, ...(rest as []));
  }

  // Run the user's mutator against a plaintext proxy backed by the current
  // (decrypted) row. Capture writes, then re-apply through Triplit with
  // encrypted values.
  const raw = await _origFetchById(collection as never, id as never);
  if (!raw) {
    // Let Triplit emit its normal not-found error.
    return _origUpdate(collection as never, id as never, mutator as never, ...(rest as []));
  }
  const rawEncV = ((raw as { enc_v?: number }).enc_v ?? 0) as number;
  const rowUserId = ((raw as { user_id?: string }).user_id ?? currentUserId) as string;
  // The encrypt ctx is computed AFTER the mutator runs (further down) so
  // adopt.ts's legitimate user_id rotation '' → real flows into AAD.
  // Pinning ctx pre-mutator was the 2026-05-01 HOTFIX trigger. Audit S2.
  const plaintext =
    (await decryptRow(collection, raw as Record<string, unknown>, dek, rowUserId)) ?? {};
  const writes: Record<string, unknown> = {};

  // Returns a Set wrapper that records .add()/.delete()/.clear() in `writes`
  // so the proxy's `set` trap isn't the only capture path for Set mutations.
  function makeTrackedSet<T>(src: Set<T>, key: string): Set<T> {
    const live = new Set<T>(src);
    function sync() {
      writes[key] = new Set(live);
    }
    return {
      add(v: T) {
        live.add(v);
        sync();
        return this as Set<T>;
      },
      delete(v: T) {
        const r = live.delete(v);
        sync();
        return r;
      },
      clear() {
        live.clear();
        sync();
      },
      has: (v: T) => live.has(v),
      get size() {
        return live.size;
      },
      // biome-ignore lint/suspicious/noExplicitAny: forEach callback signature
      forEach(cb: (v: T, v2: T, set: Set<T>) => void, thisArg?: any) {
        live.forEach(cb, thisArg);
      },
      values: () => live.values(),
      keys: () => live.keys(),
      entries: () => live.entries(),
      [Symbol.iterator]: () => live[Symbol.iterator](),
      [Symbol.toStringTag]: 'Set',
    } as unknown as Set<T>;
  }

  const proxy = new Proxy(
    { ...plaintext },
    {
      get(target, key) {
        const k = key as string;
        // Always read the latest value (from writes if already mutated, else from plaintext).
        const val = k in writes ? writes[k] : (target as Record<string, unknown>)[k];
        // Wrap Set values so .add()/.delete() are captured in `writes`.
        if (val instanceof Set) {
          return makeTrackedSet(val as Set<unknown>, k);
        }
        return val;
      },
      set(_target, key, value) {
        // Drop user_id reassignment attempts (Audit S3, 2026-05-03). adopt.ts
        // runs pre-session so currentUserId='' and the path is permitted then.
        if (key === 'user_id' && currentUserId && value !== currentUserId) {
          return true;
        }
        writes[key as string] = value;
        return true;
      },
    },
  );
  await mutator(proxy);

  // Bump updated_at — Triplit 1.1.10 no aplica S.Default.now() en updates
  // en este path. Para items además stampamos defaults faltantes
  // (created_at, position, notes) si el row es pre-fix (huérfano sin
  // estos campos en IDB local) para que el push no falle con
  // "Property X is invalid" server-side.
  if (collection === 'items') {
    const now = new Date();
    const pt = plaintext as Record<string, unknown>;
    writes.updated_at = now;
    if (!(writes.created_at ?? pt.created_at)) writes.created_at = now;
    if (!(writes.position ?? pt.position)) writes.position = 'a0';
    if (typeof (writes.notes ?? pt.notes) !== 'string') writes.notes = '';
  }

  // Re-derive encrypt ctx from post-mutator state. If the mutator rotated
  // user_id (adopt.ts on first login), the AAD must bind to the NEW value
  // because that's what the row will store. Otherwise fall back to the
  // pre-existing rowUserId (or currentUserId for the very-first write).
  const effectiveUserId =
    (typeof writes.user_id === 'string' && writes.user_id) || rowUserId || currentUserId || '';
  const ctx = { collection, id, userId: effectiveUserId };

  // Migration nuance: if the row was `enc_v < 2`, opportunistically promote
  // the WHOLE row to `enc_v=2` (the current AAD-bound format). Just
  // encrypting the touched fields would leave the rest of the row at the
  // older format while the row's `enc_v=2` flag claimed everything was
  // current. Slice 6's background sweep handles rows that never get updated.
  if (rawEncV < 2) {
    const merged = { ...(plaintext as Record<string, unknown>), ...writes };
    // Make sure merged.user_id matches what AAD will bind to — otherwise
    // decrypt would build AAD from the stored user_id and fail to match.
    if (effectiveUserId) merged.user_id = effectiveUserId;
    const encrypted = await encryptRow(ctx, merged, dek);
    return _origUpdate(
      collection as never,
      id as never,
      applyAsMutator(encrypted, { skipId: true }) as never,
      ...(rest as []),
    );
  }

  const encrypted = await encryptPatch(ctx, writes, dek);
  return _origUpdate(
    collection as never,
    id as never,
    applyAsMutator(encrypted, { skipId: false }) as never,
    ...(rest as []),
  );
};

// --- override: fetch ------------------------------------------------------

const _origFetch = triplit.fetch.bind(triplit);
// biome-ignore lint/suspicious/noExplicitAny: structural override
(triplit as any).fetch = async (query: any, ...rest: unknown[]) => {
  const results = await _origFetch(query as never, ...(rest as []));
  const dek = dekOrNull();
  if (!dek || !Array.isArray(results)) return results;
  const collection = collectionFromQuery(query);
  if (!collection || !isEncryptedCollection(collection)) return results;
  return decryptResults(collection, results, dek, currentUserId);
};

// --- override: fetchById --------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: structural override
(triplit as any).fetchById = async (collection: string, id: string, ...rest: unknown[]) => {
  const row = await _origFetchById(collection as never, id as never, ...(rest as []));
  if (!row) return row;
  const dek = dekOrNull();
  if (!dek || !isEncryptedCollection(collection)) return row;
  return decryptRow(collection, row as Record<string, unknown>, dek, currentUserId);
};

// --- override: subscribe (raw) -------------------------------------------
//
// Wrap only the lowest-level `subscribe`. Triplit's `subscribeWithStatus`
// internally calls `this.subscribe(query, ...)` — wrapping both produces
// double decryption (status's inner subscribe decrypts → status callback
// receives plaintext → outer wrapper tries to decrypt plaintext as if it
// were ciphertext → fails). The Svelte adapter's `useQuery` and our
// `liveQuery` helper both sit on top of `subscribeWithStatus`, which
// inherits decryption via the inner `this.subscribe` call.

const _origSubscribe = triplit.subscribe.bind(triplit);
// biome-ignore lint/suspicious/noExplicitAny: structural override
(triplit as any).subscribe = (query: any, onResults: any, onError: any, ...rest: unknown[]) => {
  const collection = collectionFromQuery(query);
  if (!collection || !isEncryptedCollection(collection)) {
    return _origSubscribe(query as never, onResults as never, onError as never, ...(rest as []));
  }

  // Boot race: Triplit emits from local IDB before `cryptoStore.init`
  // finishes loading the cached DEK. The first emission would arrive with
  // dek=null and pass ciphertext straight to the consumer; Triplit then
  // never re-emits because no data changed. Buffer the latest raw
  // emission and replay it (decrypted) when the unlock listener fires.
  let lastRaw: unknown[] | null = null;
  let unwatchUnlock: (() => void) | null = null;

  const tryDecryptAndDeliver = (results: unknown[]): void => {
    const dek = dekOrNull();
    if (!dek || results.length === 0) {
      onResults(results);
      return;
    }
    void decryptResults(collection, results as Record<string, unknown>[], dek, currentUserId).then(
      (decrypted) => {
        onResults(decrypted);
      },
      (err) => {
        if (typeof onError === 'function') onError(err);
      },
    );
  };

  const origUnsub = _origSubscribe(
    query as never,
    ((results: unknown[]) => {
      lastRaw = results;
      const dek = dekOrNull();
      if (!dek || !results || results.length === 0) {
        onResults(results);
        if (!dek && !unwatchUnlock) {
          unwatchUnlock = cryptoStore.onUnlock(() => {
            if (lastRaw) tryDecryptAndDeliver(lastRaw);
          });
        }
        return;
      }
      tryDecryptAndDeliver(results);
    }) as never,
    onError as never,
    ...(rest as []),
  );

  return () => {
    unwatchUnlock?.();
    return origUnsub();
  };
};
