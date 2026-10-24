/**
 * Project-icity heuristic. An item is a project iff EITHER:
 *   (a) it has at least one live child, OR
 *   (b) the user flagged it as a project (`outcome != null`, where `''`
 *       counts as "marked, no outcome written yet").
 */
import { isTrashed } from '$lib/item-state';
import type { Item } from '@gtd/schema';

export function buildIsProjectMap(allItems: Item[]): Map<string, boolean> {
  const hasChildren = new Set<string>();
  for (const it of allItems) {
    if (it.parent_id && !isTrashed(it)) {
      hasChildren.add(it.parent_id);
    }
  }
  const map = new Map<string, boolean>();
  for (const it of allItems) {
    const fromChildren = hasChildren.has(it.id);
    const fromOutcome = it.outcome !== undefined && it.outcome !== null;
    map.set(it.id, fromChildren || fromOutcome);
  }
  return map;
}
