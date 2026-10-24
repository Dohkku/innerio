import type { Item } from '@gtd/schema';
import { derivedState, isTrashed } from './item-state';

export const STALLED_THRESHOLD_DAYS = 7;
export const STALLED_GRACE_DAYS = 1;

const MS_PER_DAY = 86_400_000;

/**
 * A top-level project is stalled when EITHER:
 *   H1 — it has zero children whose derived state is 'next' AND it was created
 *        more than STALLED_GRACE_DAYS ago (canon GTD: every active project
 *        must have a next action — but a brand-new one gets a grace window
 *        so it doesn't yell at the user the moment they create it), OR
 *   H3 — neither the project nor any of its children was updated in the last
 *        STALLED_THRESHOLD_DAYS days (the user has lost momentum).
 *
 * Projects whose derived state is `someday`, `done`, or `trashed` are never
 * stalled — the user already parked them. Sub-projects (parent_id set) are
 * also out of scope: stalled-detection is a top-level review signal.
 *
 * Caller is responsible for filtering candidates to "is project" before
 * calling — see `lib/projects.ts` heuristic (Musk-3.B removed `items.type`).
 *
 * `children` is the caller-supplied list of items where `parent_id === project.id`.
 * The function does not look up children itself, so it stays pure.
 */
export function isStalled(project: Item, children: Item[], now: Date): boolean {
  if (project.parent_id) return false;
  const projState = derivedState(project);
  if (projState === 'someday' || projState === 'done' || projState === 'trashed') {
    return false;
  }

  // Defensive: a row missing its dates is malformed (typically a stale
  // IndexedDB row from a schema-bump that didn't get re-seeded with
  // S.Default.now()). Treat as not-stalled rather than crashing the list.
  if (!project.created_at || !project.updated_at) return false;

  const liveChildren = children.filter((c) => !isTrashed(c));

  // H1: no child whose derived state is 'next' (skipped during grace window)
  const hasNextAction = liveChildren.some((c) => derivedState(c) === 'next');
  if (!hasNextAction) {
    const ageMs = now.getTime() - project.created_at.getTime();
    if (ageMs >= STALLED_GRACE_DAYS * MS_PER_DAY) return true;
  }

  // H3: no activity (project or any live child) in the last threshold days
  const cutoff = now.getTime() - STALLED_THRESHOLD_DAYS * MS_PER_DAY;
  const newest = Math.max(
    project.updated_at.getTime(),
    ...liveChildren.filter((c) => c.updated_at).map((c) => c.updated_at.getTime()),
  );
  return newest <= cutoff;
}
