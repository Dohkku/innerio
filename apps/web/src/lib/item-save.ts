import { triplit } from '$lib/triplit';
import { sameDate } from '@gtd/core';
import type { Item } from '@gtd/schema';

/**
 * Persist a trimmed title. Empty → caller restores from `item.title` and
 * we return `'restored'` so the binding can be reset. Identical to old
 * value → `'noop'`. Otherwise commit and return `'saved'`.
 */
export async function commitItemTitle(
  item: Item,
  raw: string,
): Promise<'saved' | 'noop' | 'restored'> {
  const trimmed = raw.trim();
  if (!trimmed) return 'restored';
  if (trimmed === item.title) return 'noop';
  await triplit.update('items', item.id, (e) => {
    e.title = trimmed;
  });
  return 'saved';
}

/** Persist a trimmed outcome. Empty becomes `undefined` (cleared). */
export async function commitItemOutcome(item: Item, raw: string): Promise<void> {
  const trimmed = raw.trim();
  if (trimmed === (item.outcome ?? '')) return;
  await triplit.update('items', item.id, (e) => {
    e.outcome = trimmed || undefined;
  });
}

/** Persist a date field (due_at, remind_at, end_at…). Skip if unchanged. */
export async function commitItemDate<F extends keyof Item>(
  item: Item,
  field: F,
  next: Date | undefined,
): Promise<void> {
  if (sameDate(next, item[field] as Date | null | undefined)) return;
  await triplit.update('items', item.id, (e) => {
    (e as Record<string, unknown>)[field as string] = next;
  });
}
