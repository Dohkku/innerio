/**
 * Reactive query helper for Triplit subscriptions whose shape depends on
 * reactive state (props that change post-mount, $state, $derived).
 *
 * Why this exists:
 *   The official `useQuery(client, query)` from @triplit/svelte captures
 *   `query` as a value at call time and registers `$state` + `$effect`
 *   internally. It does NOT track reactive dependencies of `query`.
 *
 *   The intuitive workaround `const sub = $derived(useQuery(triplit, q))`
 *   is broken: it re-invokes `useQuery` on every reactive run, spawning a
 *   new orphan `$effect` (and a new subscription) each time. Old
 *   subscriptions stay alive, `fetching` flaps forever, and the app shows
 *   "Cargando…" indefinitely. That bug took out /next, /waiting, /someday,
 *   /reference, /done, /process, and /projects/[id].
 *
 * Use `liveQuery` whenever the query depends on something reactive.
 * If the query is static for the component's lifetime, prefer the stock
 * `useQuery` directly.
 *
 * Usage:
 *   const sub = liveQuery<Item>(triplit, () =>
 *     triplit.query('items').Where('id', '=', itemId).Limit(1)
 *   );
 *   // sub.results, sub.fetching, sub.error
 */
import type { TriplitClient } from '@triplit/client';

// biome-ignore lint/suspicious/noExplicitAny: helper is schema-agnostic by design
type AnyClient = TriplitClient<any>;
// biome-ignore lint/suspicious/noExplicitAny: query shape is generic by design
type AnyQuery = any;

export function liveQuery<T = unknown>(
  client: AnyClient,
  getQuery: () => AnyQuery | null | undefined,
) {
  let results = $state<T[]>([]);
  let fetching = $state(true);
  let error = $state<Error | null>(null);

  $effect(() => {
    const q = getQuery();
    if (!q) {
      results = [];
      fetching = false;
      error = null;
      return;
    }
    fetching = true;
    error = null;
    const unsub = client.subscribeWithStatus(
      q,
      (next: { results?: unknown[]; fetching: boolean; error?: Error | null }) => {
        results = (next.results ?? []) as T[];
        fetching = next.fetching;
        error = next.error ?? null;
      },
    );
    return unsub;
  });

  return {
    get results() {
      return results;
    },
    get fetching() {
      return fetching;
    },
    get error() {
      return error;
    },
  };
}
