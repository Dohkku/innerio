/**
 * Public API for @gtd/core.
 *
 * Pure utilities (no DOM, no SvelteKit) shared between apps/web and apps/mcp.
 * Anything that touches stores, runes, or the browser stays in apps/web.
 */
export { isStalled, STALLED_GRACE_DAYS, STALLED_THRESHOLD_DAYS } from './stalled';
export {
  derivedState,
  isActive,
  isDone,
  isInbox,
  isLive,
  isNext,
  isReference,
  isReminderPending,
  isSomeday,
  isTrashed,
  type DerivedState,
} from './item-state';
export { keyBetween, keyForAppend } from './position';
export {
  endOfDay,
  formatDDMMYYYY,
  fromDateInputValue,
  isOverdue,
  isToday,
  sameDate,
  startOfDay,
  toDateInputValue,
} from './dates';
