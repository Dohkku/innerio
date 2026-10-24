/**
 * Canonical Triplit schema for the GTD app.
 *
 * Single source of truth — imported by:
 *   - apps/web         (browser, IndexedDB)
 *   - apps/triplit-server (Bun, SQLite)
 *
 * See .vault/04-data-model.md for rationale.
 *
 * Conventions:
 *   - All entities have id (uuidv7), created_at, updated_at.
 *   - Soft delete via deleted_at (null = live).
 *   - Foreign keys are plain string ids (no Triplit relations yet —
 *     resolve client-side with Map).
 *
 * History (2026-05):
 *  - 2026-05-18 tijera (commit 947fdce): petó auth/sync/E2EE entero,
 *    eliminó user_id/enc_v/areas/reviews/crypto_envelopes.
 *  - 2026-05-21 revival (este commit): vuelve auth+sync+E2EE como
 *    paywall product (ADR-032 / doc 45). Schema gana de nuevo user_id,
 *    enc_v, crypto_envelopes y permissions per-row. NO se reintroducen
 *    `areas` ni `reviews` (eliminados a propósito en mayo).
 */
import { Schema as S } from '@triplit/client';

// --- roles + permissions ---
//
// Per-user row scoping. JWT mints by `/api/auth/triplit-token` carry
// `{ sub, user_id }`. The `user` role matcher captures the claim into
// `$role.user_id`, referenced by each collection's permissions block.
export const roles = {
  user: {
    match: {
      user_id: '$user_id',
    },
  },
} as const;

const ownerFilter = (): [['user_id', '=', '$role.user_id']] => [['user_id', '=', '$role.user_id']];
const userOwned = () => ({
  user: {
    read: { filter: ownerFilter() },
    insert: { filter: ownerFilter() },
    update: { filter: ownerFilter() },
    delete: { filter: ownerFilter() },
  },
});

// --- enum-like literal sets ---

export const ENERGY_LEVELS = ['low', 'medium', 'high'] as const;
export type EnergyLevel = (typeof ENERGY_LEVELS)[number];

// --- schema ---
export const schema = S.Collections({
  items: {
    schema: S.Schema({
      id: S.Id({ format: 'uuidv7' }),
      title: S.String(),
      notes: S.String({ default: '' }),

      // Owner of this row. Empty string = demo mode (anonymous local, no account).
      // Set to user.id when the row is adopted on signup or created while logged in.
      user_id: S.String({ default: '' }),

      // organization
      parent_id: S.Optional(S.String()),

      // scheduling. `due_at` (deadline puro, en cualquier item).
      // `start_at`/`end_at` reservado para EVENTOS de calendario, doc 46:
      // tiempo no-propio (citas, reuniones). NO para soft-scheduling de
      // tareas. `remind_at` = tickler, doc 47: hasta esa fecha el item se
      // esconde de bandeja/siguientes, en esa fecha reaparece.
      due_at: S.Optional(S.Date()),
      start_at: S.Optional(S.Date()),
      end_at: S.Optional(S.Date()),
      all_day: S.Optional(S.Boolean()),
      tz: S.Optional(S.String()),
      remind_at: S.Optional(S.Date()),

      // effort filters
      energy: S.Optional(S.String()),
      estimate_minutes: S.Optional(S.Number()),

      // waiting — DEPRECATED (doc 47). Conservados temporalmente para
      // tolerar rollback. Migración sweep en apps/web vuelca waiting_for
      // al campo notes. Eliminación final en fase E del doc 47.
      waiting_for: S.Optional(S.String()),
      waiting_since: S.Optional(S.Date()),

      // project-specific
      outcome: S.Optional(S.String()),
      // `nullable: true` tolera filas legacy con `is_sequential: null` en
      // IDB (escritas antes de que Triplit aplicara el default — bug visto
      // en dogfood). Nuevos inserts siguen recibiendo `false` por defecto;
      // una migración backfill normaliza nulls existentes a `false`.
      is_sequential: S.Boolean({ default: false, nullable: true }),

      // recurrence (RRULE; encoded as JSON for forward-compat)
      recurrence: S.Optional(S.Json()),

      // metadata
      created_at: S.Date({ default: S.Default.now() }),
      updated_at: S.Date({ default: S.Default.now() }),
      completed_at: S.Optional(S.Date()),
      deleted_at: S.Optional(S.Date()),

      // Estados → timestamps (doc 44). El estado conceptual se deriva del
      // conjunto de timestamps (`derivedState()` en `@gtd/core`).
      clarified_at: S.Optional(S.Date()),
      someday_at: S.Optional(S.Date()),
      reference_at: S.Optional(S.Date()),

      // ordering: fractional indexing string ("a0", "a1"...). String, not number,
      // so we can insert between two keys without renumbering.
      position: S.String({ default: 'a0' }),

      // E2EE row version (ADR-017 + ADR-032 revival). 0 = legacy plaintext,
      // 2 = ciphertext envelopes WITH AAD (ADR-018). v=1 (legacy no-AAD)
      // existió brevemente en producción pre-tijera; el sweep de migración
      // lo trata como v=2 si aparece en IDB.
      enc_v: S.Number({ default: 0 }),
    }),
    permissions: userOwned(),
  },

  // Settings: queda casi vacía. Singleton (id = 'me'). Hoy solo lleva user_id
  // y enc_v para coexistir con el modelo per-user; si vuelve algún ajuste
  // persistente, se añade aquí.
  settings: {
    schema: S.Schema({
      id: S.Id({ format: 'uuidv7' }),
      user_id: S.String({ default: '' }),
      enc_v: S.Number({ default: 0 }),
    }),
    permissions: userOwned(),
  },

  // E2EE wrapped DEK envelope (ADR-017). One row per user. Server stores
  // the blob but cannot read the DEK it wraps — unwrapping requires either
  // the user's passphrase (Argon2id-derived KEK) or the BIP39 mnemonic
  // (PBKDF2-derived KEK). Both wraps target the same 32-byte DEK so either
  // path unlocks identically.
  crypto_envelopes: {
    schema: S.Schema({
      id: S.Id({ format: 'uuidv7' }),
      user_id: S.String({ default: '' }),
      // base64url salts fed into the KDF
      salt_passphrase: S.String(),
      salt_mnemonic: S.String(),
      // base64url-JSON envelope (`@gtd/crypto` codec) of the wrapped DEK
      wrapped_dek_passphrase: S.String(),
      wrapped_dek_mnemonic: S.String(),
      // KDF tuning — `{ alg, opslimit, memlimit }` per `KdfParams`
      kdf_params: S.Json(),
      // Envelope shape version (separate from collection-level enc_v)
      v: S.Number({ default: 1 }),
      created_at: S.Date({ default: S.Default.now() }),
      updated_at: S.Date({ default: S.Default.now() }),
    }),
    permissions: userOwned(),
  },
});

export type Schema = typeof schema;
export type CollectionName = keyof Schema;

import type { ReadModel, WriteModel } from '@triplit/db';

export type Item = ReadModel<Schema, 'items'>;
export type Settings = ReadModel<Schema, 'settings'>;
export type CryptoEnvelope = ReadModel<Schema, 'crypto_envelopes'>;

export type ItemInsert = WriteModel<Schema, 'items'>;
export type CryptoEnvelopeInsert = WriteModel<Schema, 'crypto_envelopes'>;
