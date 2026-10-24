/**
 * Re-export del helper puro `derivedState`/`isX` desde `@gtd/core` y la
 * mutación `applyStateTransition` (que sí es específica de la UI: stampa
 * timestamps + limpia los redundantes según la transición pedida).
 *
 * El paso 3 Musk (doc 44) reemplaza `items.state` por timestamps; este
 * módulo es el punto de entrada local que la UI consume.
 */
import type { Item } from '@gtd/schema';

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
} from '@gtd/core';
import type { DerivedState } from '@gtd/core';

/** Mutación: lleva el item al estado `target` setteando timestamps y
 *  limpiando los que no aplican. Pensado para usar dentro de un
 *  `triplit.update` callback. `now` se pasa para tests deterministas. */
export function applyStateTransition(
  e: Partial<Item>,
  target: DerivedState,
  now: Date = new Date(),
): void {
  switch (target) {
    case 'inbox':
      e.clarified_at = undefined;
      e.waiting_for = undefined;
      e.waiting_since = undefined;
      e.someday_at = undefined;
      e.reference_at = undefined;
      e.completed_at = undefined;
      e.deleted_at = undefined;
      // Un tickler futuro (remind_at) esconde el item de Bandeja; devolverlo
      // a Bandeja y dejarlo oculto se contradice. Limpiamos el recordatorio
      // para que "Devolver a Bandeja" lo haga visible de verdad (doc 49).
      e.remind_at = undefined;
      break;
    case 'next':
      e.clarified_at = e.clarified_at ?? now;
      e.waiting_for = undefined;
      e.waiting_since = undefined;
      e.someday_at = undefined;
      e.reference_at = undefined;
      e.completed_at = undefined;
      e.deleted_at = undefined;
      break;
    case 'someday':
      e.clarified_at = e.clarified_at ?? now;
      e.someday_at = now;
      e.waiting_for = undefined;
      e.waiting_since = undefined;
      e.reference_at = undefined;
      e.completed_at = undefined;
      e.deleted_at = undefined;
      break;
    case 'reference':
      e.clarified_at = e.clarified_at ?? now;
      e.reference_at = now;
      e.waiting_for = undefined;
      e.waiting_since = undefined;
      e.someday_at = undefined;
      e.completed_at = undefined;
      e.deleted_at = undefined;
      break;
    case 'done':
      e.completed_at = now;
      e.deleted_at = undefined;
      break;
    case 'trashed':
      e.deleted_at = now;
      break;
  }
}
