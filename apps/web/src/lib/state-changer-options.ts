import { CLARIFY_KEYS, type ClarifyKey } from '$lib/methodology-static';
import type { DerivedState } from '@gtd/core';

/**
 * Helper puro: dado el estado actual del item (+ banderas auxiliares),
 * devuelve la lista de transiciones que tiene sentido ofrecer en el
 * StateChanger del Inspector. Filtra opciones que ya están aplicadas
 * (p.ej. "Devolver a Bandeja" si el item ya está en bandeja) y opciones
 * que no aplican al tipo (p.ej. "Proyecto" si ya es proyecto).
 *
 * La etiqueta del botón `b` se adapta: done → "Reactivar", trashed →
 * "Restaurar", resto → "Devolver a Bandeja". Internamente sigue
 * disparando `target_state='inbox'` (limpia `completed_at`/`deleted_at`).
 *
 * Ver doc 49 / ADR-037 para la tabla canónica.
 */

export type StateChangerOption = {
  key: string;
  label: string;
  /** Tono semántico para el styling del botón (positivo / peligroso / neutral). */
  tone: 'positive' | 'danger' | 'default';
};

/** Recibido `tone` mapping idéntico al que usaba StateChanger.svelte. */
function toneOf(k: ClarifyKey): StateChangerOption['tone'] {
  if (k.sets_completed_at) return 'positive';
  if (k.sets_deleted_at) return 'danger';
  return 'default';
}

/** Etiqueta override de `b` según el contexto (done/trashed → reactivar/restaurar). */
function labelB(state: DerivedState): string {
  if (state === 'done') return 'Reactivar';
  if (state === 'trashed') return 'Restaurar';
  return 'Devolver a Bandeja';
}

/**
 * Llaves visibles según contexto. Tabla canónica en doc 49.
 *
 * `reminderPending` gana: si el item tiene `remind_at > now`, sólo se
 * ofrecen `d` (descartar) y `b` (que en este contexto opera como "quitar
 * recordatorio y devolver a bandeja" — el caller lo gestiona limpiando
 * `remind_at` además de la transición).
 */
function visibleKeysFor(
  state: DerivedState,
  isProject: boolean,
  reminderPending: boolean,
): string[] {
  if (reminderPending) return ['d', 'b'];
  switch (state) {
    case 'inbox':
      return isProject ? ['h', 'd'] : ['p', 'h', 'd'];
    case 'next':
      return isProject ? ['h', 'd', 'b'] : ['p', 'h', 'd', 'b'];
    case 'someday':
      return ['h', 'd', 'b'];
    case 'reference':
      return ['d', 'b'];
    case 'done':
      return ['b'];
    case 'trashed':
      return ['b'];
  }
}

export function stateChangerKeysFor(
  state: DerivedState,
  isProject: boolean,
  reminderPending: boolean,
): StateChangerOption[] {
  const visible = new Set(visibleKeysFor(state, isProject, reminderPending));
  return CLARIFY_KEYS.filter((k) => visible.has(k.key)).map((k) => ({
    key: k.key,
    label: k.key === 'b' ? labelB(state) : k.label,
    tone: toneOf(k),
  }));
}
