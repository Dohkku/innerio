/**
 * Cascade behavior when marking a project done or trashed.
 *
 * Silenciado: completar/papelear un proyecto arrastra a sus hijos vivos
 * sin pedir confirmación (decisión usuario 2026-05-20 — mismo patrón que
 * "borrar todas las hechas" en /work). Si el destino es "trashed", los
 * hijos son recuperables manualmente desde la papelera.
 */
import { applyStateTransition, isLive } from '$lib/item-state';
import { triplit } from '$lib/triplit';
import type { Item } from '@gtd/schema';

export async function maybeCascadeChildren(
  item: Pick<Item, 'id'>,
  toState: 'done' | 'trashed',
): Promise<void> {
  const kids = (await triplit.fetch(
    triplit.query('items').Where('parent_id', '=', item.id),
  )) as Item[];
  const live = kids.filter(isLive);
  if (!live.length) return;

  const now = new Date();
  await Promise.all(
    live.map((k) =>
      triplit.update('items', k.id, (e) => {
        applyStateTransition(e, toState, now);
      }),
    ),
  );
}
