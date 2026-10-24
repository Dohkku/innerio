/**
 * Reactive cache for items. One module-scope subscription, no per-view
 * fan-out. Pages read derived maps inside their own `$derived` to track
 * changes.
 *
 * Exposes:
 *   - `allItems`: every item in IDB.
 *   - `projectById`: id → item lookup, used for parent breadcrumbs and
 *     "is parent trashed?" guards.
 *   - `isProjectMap`: precomputed `id → boolean` from the heuristic in
 *     `lib/projects.ts`.
 *
 * 2026-05-18: tijera áreas — fuera `areasArr`, `areaById`, `refsByArea`.
 */
import type { Item } from '@gtd/schema';
import { buildIsProjectMap } from '../projects';
import { triplit } from '../triplit';

let allItemsArr = $state<Item[]>([]);
let started = false;

function start() {
  if (started) return;
  started = true;
  // Filtramos items con deleted_at en el server para que nunca lleguen a la
  // cache reactiva. Defensa en profundidad: las vistas también filtran con
  // derivedState client-side, pero un device que aún no ha procesado el
  // update del deleted_at quedaría enseñando rows zombi hasta el siguiente
  // tick. Server-side filter cierra esa ventana.
  triplit.subscribe(triplit.query('items').Where('deleted_at', 'isDefined', false), (r) => {
    allItemsArr = r as Item[];
  });
}

start();

const projectById = $derived.by(() => {
  const m = new Map<string, Item>();
  for (const it of allItemsArr) m.set(it.id, it);
  return m;
});

const isProjectMap = $derived.by(() => buildIsProjectMap(allItemsArr));

export const orgs = {
  get allItems() {
    return allItemsArr;
  },
  get projectById() {
    return projectById;
  },
  get isProjectMap() {
    return isProjectMap;
  },
};
