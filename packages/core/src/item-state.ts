/**
 * Estado derivado del item desde el conjunto de timestamps.
 *
 * Pure helpers — no DOM, no Triplit, no UI. Compartidos entre apps/web y
 * cualquier consumidor headless (MCP, scripts). La mutación
 * (`applyStateTransition`) vive en `apps/web/src/lib/item-state.ts` porque
 * sólo la usa la UI.
 *
 * Sustituye al field `items.state` (string enum 7-way) — paso 3 Musk,
 * doc 44.
 *
 * Doc 47 (2026-05-22): estado 'waiting' eliminado. `waiting_for` queda
 * temporalmente en schema pero ya no clasifica. Recordatorios usan
 * `remind_at`; el item con remind_at futuro NO cambia de estado, solo
 * se esconde de bandeja/sig via filtros de query.
 *
 * Prioridad: trashed > done > reference > someday > next > inbox
 */
import type { Item } from '@gtd/schema';

export type DerivedState = 'inbox' | 'next' | 'someday' | 'reference' | 'done' | 'trashed';

export function derivedState(it: Item): DerivedState {
  if (it.deleted_at) return 'trashed';
  if (it.completed_at) return 'done';
  if (it.reference_at) return 'reference';
  if (it.someday_at) return 'someday';
  if (it.clarified_at) return 'next';
  return 'inbox';
}

export const isInbox = (it: Item): boolean => derivedState(it) === 'inbox';
export const isNext = (it: Item): boolean => derivedState(it) === 'next';
export const isSomeday = (it: Item): boolean => derivedState(it) === 'someday';
export const isReference = (it: Item): boolean => derivedState(it) === 'reference';
export const isDone = (it: Item): boolean => it.completed_at != null && it.deleted_at == null;
export const isTrashed = (it: Item): boolean => it.deleted_at != null;

/**
 * Tickler activo: item con `remind_at` futuro. Debe esconderse de Bandeja,
 * Siguientes y la cola de /process hasta que cruce el umbral. Cuando el
 * día del recordatorio llega (o pasa), deja de estar "pending" y el item
 * reaparece naturalmente.
 *
 * Granularidad día: comparamos `startOfDay(remind_at)` contra
 * `startOfDay(now)`. Un item con `remind_at = 2026-05-22T09:00` reaparece
 * el 22-may completo, sin importar la hora del día.
 */
export function isReminderPending(it: Item, now: Date = new Date()): boolean {
  if (!it.remind_at) return false;
  const startOfRemind = new Date(it.remind_at);
  startOfRemind.setHours(0, 0, 0, 0);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  return startOfRemind.getTime() > startOfToday.getTime();
}

/**
 * "Live and actionable" — candidato a aparecer en /work, /next-style
 * listings y notificaciones. Excluye done/trashed.
 */
export const isLive = (it: Item): boolean => it.deleted_at == null && it.completed_at == null;

export const isActive = (it: Item): boolean =>
  isLive(it) && it.someday_at == null && it.reference_at == null;
