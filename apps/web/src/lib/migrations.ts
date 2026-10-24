import { triplit } from '$lib/triplit';
import type { Item } from '@gtd/schema';

/**
 * Wrap a one-shot migration with localStorage idempotency + try/catch +
 * consistent logging. If `fn` throws, the flag stays unset so it retries
 * next boot.
 */
async function withFlag(key: string, label: string, fn: () => Promise<void>): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  if (localStorage.getItem(key)) return;
  try {
    await fn();
    localStorage.setItem(key, String(Date.now()));
  } catch (err) {
    console.error(`[migration] ${label} failed:`, err);
  }
}

/**
 * 2026-05-19 — `items.is_sequential` apareció como `null` en filas de dogfood
 * (Triplit no aplicó el default en algunas inserts antiguas). El schema ahora
 * acepta `nullable: true` para no romper la deserialización; este backfill
 * deja todas las filas en boolean estricto (`false` cuando estaba null/undef).
 */
async function backfillIsSequential(): Promise<void> {
  const all = (await triplit.fetch(triplit.query('items'))) as Item[];
  let touched = 0;
  for (const raw of all) {
    const it = raw as Item & { is_sequential?: boolean | null };
    if (it.is_sequential === true || it.is_sequential === false) continue;
    await triplit.update('items', it.id, (e) => {
      e.is_sequential = false;
    });
    touched += 1;
  }
  if (touched) console.info(`[migration] backfill-is-sequential: normalized ${touched} items`);
}

/**
 * 2026-05-21 — Triplit 1.1.10 no aplica `S.Default.now()` consistente en
 * el insert path: rows del seed inicial + algunos creados por el usuario
 * acaban sin `created_at`/`updated_at`/`position` en IDB local. El sync
 * push los envía sin esos campos y el server rechaza con
 * "Property X is invalid: Encoded value undefined". Stampamos defaults
 * faltantes para que los rows existentes pasen la validation; nuevos
 * inserts ya entran bien por el fix en `triplit.ts` wrapper.
 */
async function backfillDefaults(): Promise<void> {
  const all = (await triplit.fetch(triplit.query('items'))) as Item[];
  let touched = 0;
  for (const raw of all) {
    const it = raw as Item & {
      created_at?: Date | null;
      updated_at?: Date | null;
      position?: string | null;
      notes?: string | null;
    };
    const needsCreated = !it.created_at;
    const needsUpdated = !it.updated_at;
    const needsPosition = !it.position;
    const needsNotes = typeof it.notes !== 'string';
    if (!needsCreated && !needsUpdated && !needsPosition && !needsNotes) continue;
    const fallback = it.updated_at ?? it.created_at ?? new Date();
    await triplit.update('items', it.id, (e) => {
      if (needsCreated) e.created_at = fallback;
      if (needsUpdated) e.updated_at = fallback;
      if (needsPosition) e.position = 'a0';
      if (needsNotes) e.notes = '';
    });
    touched += 1;
  }
  if (touched) console.info(`[migration] backfill-defaults: stamped ${touched} items`);
}

/**
 * Corre los backfills vivos. Cada uno idempotente vía localStorage flag
 * (ver `withFlag`); fallar uno no aborta el siguiente.
 *
 * Las 11 migraciones one-shot de mayo 2026 (subtasks-to-next,
 * goals-to-projects, state-to-timestamps, wipe-type, dump-waiting-for,
 * scheduled-into-due, reflections-wipe, wipe-pin, methodology-wipe,
 * wipe-defer-until, wipe-area-id, areas-wipe) fueron retiradas tras
 * confirmar que corrieron en todos los devices del dueño dogfood. Si
 * vuelven a hacer falta, ver `git log apps/web/src/lib/migrations.ts`.
 */
export async function runMigrations(): Promise<void> {
  await withFlag(
    'gtd:migrated:backfill-is-sequential:v1',
    'backfill-is-sequential',
    backfillIsSequential,
  );
  // v2 añade `notes` al backfill (v1 cubría created_at, updated_at, position).
  // Bump del flag obliga a re-correr en clientes que ya marcaron v1.
  await withFlag('gtd:migrated:backfill-defaults:v2', 'backfill-defaults', backfillDefaults);
  // Seed eliminado 2026-05-21: la app es personal del dueño y sembrar 10
  // welcome items en cada device nuevo genera ruido. Marcamos el flag para
  // que no se reintente en devices que ya tengan la flag puesta sin tener
  // seeds; no-op si nunca corrió.
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem('gtd:seeded:v1', new Date().toISOString());
    } catch {
      // localStorage puede estar bloqueado (modo privado estricto). Sin
      // flag, el callsite ya no existe — el seed no corre de todas formas.
    }
  }
}
