/**
 * Date helpers for scheduling + Today view.
 *
 * Conventions:
 *  - All schema dates are stored as JS Date objects (Triplit `S.Date()`).
 *  - GTD date semantics: date-only (not time-of-day). Solo `due_at` queda
 *    (deadline). `scheduled_at` y `defer_until` se retiraron 2026-05-18.
 *  - We use `<input type="date">` and store as local-midnight Date.
 */

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function asDate(d: Date | string | undefined | null): Date | null {
  if (!d) return null;
  return d instanceof Date ? d : new Date(d);
}

export function isToday(d: Date | string | undefined | null, now: Date = new Date()): boolean {
  const date = asDate(d);
  if (!date) return false;
  return startOfDay(date).getTime() === startOfDay(now).getTime();
}

export function isOverdue(d: Date | string | undefined | null, now: Date = new Date()): boolean {
  const date = asDate(d);
  if (!date) return false;
  // Overdue = due before today's start (truly past, not just earlier today).
  return date.getTime() < startOfDay(now).getTime();
}

/** Format a Date as the local YYYY-MM-DD string an `<input type="date">` expects. */
export function toDateInputValue(d: Date | string | undefined | null): string {
  const date = asDate(d);
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse a YYYY-MM-DD string into a Date at local midnight. Empty → undefined. */
export function fromDateInputValue(s: string): Date | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

export function sameDate(
  a: Date | string | undefined | null,
  b: Date | string | undefined | null,
): boolean {
  const ad = asDate(a);
  const bd = asDate(b);
  if (!ad && !bd) return true;
  if (!ad || !bd) return false;
  return ad.getTime() === bd.getTime();
}

export function formatDDMMYYYY(d: Date | string | undefined | null): string {
  const date = asDate(d);
  if (!date) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${mo}/${date.getFullYear()}`;
}
