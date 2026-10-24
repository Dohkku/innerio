import type { Item } from '@gtd/schema';
import { describe, expect, it } from 'vitest';
import { STALLED_GRACE_DAYS, STALLED_THRESHOLD_DAYS, isStalled } from './stalled';

const NOW = new Date('2026-04-28T12:00:00Z');
const DAY = 86_400_000;

// Default `created_at` for the test factory: well past the grace window so
// the H1 grace doesn't accidentally suppress assertions in the older tests.
const PAST_GRACE = new Date(NOW.getTime() - (STALLED_GRACE_DAYS + 2) * DAY);

function makeItem(partial: Partial<Item> & { state?: string }): Item {
  // El field `state` ya no existe en el schema (Musk-3 paso 3, doc 44),
  // pero los casos de esta suite se escribieron antes con el shorthand
  // `state: 'next' | 'someday' | …`. Mantenemos la conveniencia
  // traduciendo el state al timestamp equivalente — la lógica real de
  // isStalled() lee timestamps via `derivedState()`.
  const { state, ...rest } = partial;
  const base = {
    id: 'p1',
    title: 'x',
    notes: '',
    user_id: '',
    is_sequential: false,
    created_at: PAST_GRACE,
    updated_at: NOW,
    source: 'manual',
    position: 'a0',
  };
  const item = { ...base, ...rest } as Item;
  const s = state ?? 'next';
  if (s === 'next' || s === 'waiting' || s === 'someday' || s === 'reference' || s === 'done') {
    if (!item.clarified_at) item.clarified_at = PAST_GRACE;
  }
  if (s === 'someday' && !item.someday_at) item.someday_at = PAST_GRACE;
  if (s === 'reference' && !item.reference_at) item.reference_at = PAST_GRACE;
  if (s === 'done' && !item.completed_at) item.completed_at = PAST_GRACE;
  if (s === 'trashed' && !item.deleted_at) item.deleted_at = PAST_GRACE;
  return item;
}

const recentDate = new Date(NOW.getTime() - 1 * DAY);
const oldDate = new Date(NOW.getTime() - (STALLED_THRESHOLD_DAYS + 2) * DAY);

describe('isStalled', () => {
  // Note: Musk-3.B removed `items.type`. Callers now filter project candidates
  // via the `isProject` heuristic before calling `isStalled` — this suite
  // exercises the function's contract on already-filtered projects.

  it('returns false for sub-projects (parent_id set)', () => {
    const sub = makeItem({
      state: 'next',
      parent_id: 'parent',
      updated_at: recentDate,
    });
    expect(isStalled(sub, [], NOW)).toBe(false);
  });

  it('returns false for projects in state someday', () => {
    const p = makeItem({ state: 'someday', updated_at: oldDate });
    expect(isStalled(p, [], NOW)).toBe(false);
  });

  it('returns false for projects in state done or trashed', () => {
    const done = makeItem({ state: 'done', updated_at: oldDate });
    const trash = makeItem({ state: 'trashed', updated_at: oldDate });
    expect(isStalled(done, [], NOW)).toBe(false);
    expect(isStalled(trash, [], NOW)).toBe(false);
  });

  it('H1 — flags project with no children at all (recent)', () => {
    const p = makeItem({ state: 'next', updated_at: recentDate });
    expect(isStalled(p, [], NOW)).toBe(true);
  });

  it('H1 — flags project whose children are all done or inbox (no next)', () => {
    const p = makeItem({ state: 'next', updated_at: recentDate });
    const children = [
      makeItem({ id: 'c1', state: 'done', updated_at: recentDate }),
      makeItem({ id: 'c2', state: 'inbox', updated_at: recentDate }),
    ];
    expect(isStalled(p, children, NOW)).toBe(true);
  });

  it('H1 not satisfied — child in state next', () => {
    const p = makeItem({ state: 'next', updated_at: recentDate });
    const children = [makeItem({ id: 'c1', state: 'next', updated_at: recentDate })];
    expect(isStalled(p, children, NOW)).toBe(false);
  });

  it('H3 — flags project with a next child but no activity > 7d', () => {
    const p = makeItem({ state: 'next', updated_at: oldDate });
    const children = [makeItem({ id: 'c1', state: 'next', updated_at: oldDate })];
    expect(isStalled(p, children, NOW)).toBe(true);
  });

  it('H3 not satisfied — recent child activity revives the project', () => {
    const p = makeItem({ state: 'next', updated_at: oldDate });
    const children = [makeItem({ id: 'c1', state: 'next', updated_at: recentDate })];
    expect(isStalled(p, children, NOW)).toBe(false);
  });

  it('trashed children are ignored when evaluating H1 and H3', () => {
    const p = makeItem({ state: 'next', updated_at: oldDate });
    const children = [
      // Recent next child — but trashed, so should NOT save the project from H1/H3.
      makeItem({ id: 'c1', state: 'trashed', updated_at: recentDate }),
    ];
    expect(isStalled(p, children, NOW)).toBe(true);
  });

  it('boundary — exactly at threshold (7d ago) counts as stalled', () => {
    const exactlyAtThreshold = new Date(NOW.getTime() - STALLED_THRESHOLD_DAYS * DAY);
    const p = makeItem({
      state: 'next',
      created_at: exactlyAtThreshold,
      updated_at: exactlyAtThreshold,
    });
    const children = [makeItem({ id: 'c1', state: 'next', updated_at: exactlyAtThreshold })];
    expect(isStalled(p, children, NOW)).toBe(true);
  });

  it('grace — brand-new project with no children is NOT stalled (within grace)', () => {
    const justCreated = new Date(NOW.getTime() - 2 * 60 * 60 * 1000); // 2h ago
    const p = makeItem({
      state: 'next',
      created_at: justCreated,
      updated_at: justCreated,
    });
    expect(isStalled(p, [], NOW)).toBe(false);
  });

  it('grace — project with no children becomes stalled once past grace', () => {
    const pastGrace = new Date(NOW.getTime() - (STALLED_GRACE_DAYS + 1) * DAY);
    const p = makeItem({
      state: 'next',
      created_at: pastGrace,
      updated_at: pastGrace,
    });
    expect(isStalled(p, [], NOW)).toBe(true);
  });

  it('grace — boundary, exactly at grace cutoff counts as stalled', () => {
    const atGrace = new Date(NOW.getTime() - STALLED_GRACE_DAYS * DAY);
    const p = makeItem({
      state: 'next',
      created_at: atGrace,
      updated_at: atGrace,
    });
    expect(isStalled(p, [], NOW)).toBe(true);
  });

  it('grace — does NOT shield H3 (old project still flagged even if recently created — irrelevant here, but H3 trumps grace)', () => {
    // Brand-new created_at is moot when H3 already triggers via stale updated_at
    // chain — this is a sanity check that grace only suppresses the H1 branch.
    const justCreated = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
    const p = makeItem({
      state: 'next',
      created_at: justCreated,
      updated_at: oldDate, // forced old (impossible in practice but exercises the branch)
    });
    const children = [makeItem({ id: 'c1', state: 'next', updated_at: oldDate })];
    expect(isStalled(p, children, NOW)).toBe(true);
  });
});
