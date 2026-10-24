import type { Item } from '@gtd/schema';
import { describe, expect, it } from 'vitest';
import {
  applyStateTransition,
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
} from './item-state';

const T = (n: number) => new Date(2026, 0, 1, 0, 0, n);

function base(overrides: Partial<Item> = {}): Item {
  return {
    id: 'id',
    title: 't',
    notes: '',
    user_id: '',
    is_sequential: false,
    created_at: T(0),
    updated_at: T(0),
    position: 'a0',
    enc_v: 0,
    ...overrides,
  } as Item;
}

describe('derivedState — prioridad por timestamps', () => {
  it('vacío → inbox', () => {
    expect(derivedState(base())).toBe('inbox');
  });

  it('clarified_at solo → next', () => {
    expect(derivedState(base({ clarified_at: T(1) }))).toBe('next');
  });

  it('waiting_for no clasifica (doc 47): item queda en next', () => {
    expect(derivedState(base({ clarified_at: T(1), waiting_for: 'Marta' }))).toBe('next');
  });

  it('someday_at gana sobre next', () => {
    expect(derivedState(base({ clarified_at: T(1), someday_at: T(2) }))).toBe('someday');
  });

  it('reference_at gana sobre someday', () => {
    expect(derivedState(base({ clarified_at: T(1), someday_at: T(2), reference_at: T(3) }))).toBe(
      'reference',
    );
  });

  it('completed_at gana sobre reference', () => {
    expect(derivedState(base({ clarified_at: T(1), reference_at: T(2), completed_at: T(3) }))).toBe(
      'done',
    );
  });

  it('deleted_at gana sobre todo', () => {
    expect(
      derivedState(
        base({
          clarified_at: T(1),
          reference_at: T(2),
          completed_at: T(3),
          deleted_at: T(4),
        }),
      ),
    ).toBe('trashed');
  });
});

describe('helpers binarios', () => {
  it('isInbox / isNext / isSomeday / isReference', () => {
    expect(isInbox(base())).toBe(true);
    expect(isNext(base({ clarified_at: T(1) }))).toBe(true);
    expect(isSomeday(base({ clarified_at: T(1), someday_at: T(2) }))).toBe(true);
    expect(isReference(base({ clarified_at: T(1), reference_at: T(2) }))).toBe(true);
  });

  it('isDone requiere completed_at sin deleted_at', () => {
    expect(isDone(base({ completed_at: T(1) }))).toBe(true);
    expect(isDone(base({ completed_at: T(1), deleted_at: T(2) }))).toBe(false);
  });

  it('isTrashed = deleted_at != null', () => {
    expect(isTrashed(base({ deleted_at: T(1) }))).toBe(true);
    expect(isTrashed(base())).toBe(false);
  });

  it('isLive excluye done y trashed', () => {
    expect(isLive(base())).toBe(true);
    expect(isLive(base({ clarified_at: T(1) }))).toBe(true);
    expect(isLive(base({ completed_at: T(1) }))).toBe(false);
    expect(isLive(base({ deleted_at: T(1) }))).toBe(false);
  });

  it('isActive excluye someday/reference además', () => {
    expect(isActive(base({ clarified_at: T(1) }))).toBe(true);
    expect(isActive(base({ clarified_at: T(1), someday_at: T(2) }))).toBe(false);
    expect(isActive(base({ clarified_at: T(1), reference_at: T(2) }))).toBe(false);
  });
});

describe('isReminderPending (tickler)', () => {
  it('sin remind_at → false', () => {
    expect(isReminderPending(base(), new Date(2026, 4, 22))).toBe(false);
  });

  it('remind_at futuro → true', () => {
    const item = base({ remind_at: new Date(2026, 4, 25) });
    expect(isReminderPending(item, new Date(2026, 4, 22))).toBe(true);
  });

  it('remind_at en el mismo día → false (reaparece hoy)', () => {
    const item = base({ remind_at: new Date(2026, 4, 22, 9, 0) });
    expect(isReminderPending(item, new Date(2026, 4, 22, 15, 0))).toBe(false);
  });

  it('remind_at pasado → false', () => {
    const item = base({ remind_at: new Date(2026, 4, 20) });
    expect(isReminderPending(item, new Date(2026, 4, 22))).toBe(false);
  });
});

describe('applyStateTransition — mutación', () => {
  it('inbox limpia todos los timestamps', () => {
    const e: Partial<Item> = {
      clarified_at: T(1),
      waiting_for: 'M',
      someday_at: T(2),
      completed_at: T(3),
    };
    applyStateTransition(e, 'inbox', T(10));
    expect(e.clarified_at).toBeUndefined();
    expect(e.waiting_for).toBeUndefined();
    expect(e.someday_at).toBeUndefined();
    expect(e.completed_at).toBeUndefined();
  });

  it('inbox limpia remind_at: "Devolver a Bandeja" deshace el tickler', () => {
    // Sin limpiar remind_at, un recordatorio futuro seguiría escondiendo el
    // item de Bandeja tras la transición → el botón no haría nada visible.
    const e: Partial<Item> = { clarified_at: T(1), remind_at: T(99) };
    applyStateTransition(e, 'inbox', T(10));
    expect(e.remind_at).toBeUndefined();
  });

  it('next setea clarified_at y limpia el resto', () => {
    const e: Partial<Item> = {
      clarified_at: T(1),
      waiting_for: 'M',
      someday_at: T(2),
    };
    applyStateTransition(e, 'next', T(10));
    expect(e.clarified_at).toEqual(T(1)); // preserva el original
    expect(e.waiting_for).toBeUndefined();
    expect(e.someday_at).toBeUndefined();
  });

  it('next stampa clarified_at si no había', () => {
    const e: Partial<Item> = {};
    applyStateTransition(e, 'next', T(10));
    expect(e.clarified_at).toEqual(T(10));
  });

  it('someday setea someday_at y respeta clarified_at previo', () => {
    const e: Partial<Item> = { clarified_at: T(1) };
    applyStateTransition(e, 'someday', T(10));
    expect(e.clarified_at).toEqual(T(1));
    expect(e.someday_at).toEqual(T(10));
  });

  it('reference setea reference_at y limpia someday', () => {
    const e: Partial<Item> = { someday_at: T(5) };
    applyStateTransition(e, 'reference', T(10));
    expect(e.someday_at).toBeUndefined();
    expect(e.reference_at).toEqual(T(10));
  });

  it('done setea completed_at sin tocar clarified_at', () => {
    const e: Partial<Item> = { clarified_at: T(1) };
    applyStateTransition(e, 'done', T(10));
    expect(e.clarified_at).toEqual(T(1));
    expect(e.completed_at).toEqual(T(10));
  });

  it('trashed setea deleted_at sin tocar nada más', () => {
    const e: Partial<Item> = { clarified_at: T(1), completed_at: T(5) };
    applyStateTransition(e, 'trashed', T(10));
    expect(e.deleted_at).toEqual(T(10));
    expect(e.clarified_at).toEqual(T(1));
    expect(e.completed_at).toEqual(T(5));
  });
});
