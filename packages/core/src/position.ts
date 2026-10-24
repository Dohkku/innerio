/**
 * Fractional-indexing helpers for `items.position`.
 *
 * We use the `fractional-indexing` package: it generates strings such that
 * lexicographic order matches insertion order, and you can always insert
 * between two existing keys without renumbering.
 *
 * `null` means "before everything" (first arg) or "after everything" (second arg).
 *
 * See .vault/19-projects-planning-design.md for the project-children use case.
 */
import { generateKeyBetween } from 'fractional-indexing';

/** Position string for a new child appended at the end of an ordered list. */
export function keyForAppend(lastKey: string | null | undefined): string {
  return generateKeyBetween(lastKey ?? null, null);
}

/** Position string for a child inserted between two existing keys. */
export function keyBetween(
  before: string | null | undefined,
  after: string | null | undefined,
): string {
  return generateKeyBetween(before ?? null, after ?? null);
}
