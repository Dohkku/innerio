<script lang="ts">
  import { triplit } from '$lib/triplit';
  import { liveQuery } from '$lib/live-query.svelte';
  import { orgs } from '$lib/stores/orgs.svelte';
  import { derivedState, isLive, isTrashed, type DerivedState } from '$lib/item-state';
  import type { Item } from '@gtd/schema';
  import ItemRow from './ItemRow.svelte';

  let {
    state: itemState,
    emptyHint = 'Nada por aquí.',
    showWaitingFor = false,
    hideTrashedParentChildren = false,
    hideTopLevelProjects = false,
    sequentialFilter = false,
    topbarExtras,
  }: {
    state: DerivedState;
    emptyHint?: string;
    showWaitingFor?: boolean;
    /**
     * When true, hide sub-items whose parent project is in `state='trashed'`.
     * Used by /next so orphaned children of a trashed project don't keep
     * surfacing as actionable.
     */
    hideTrashedParentChildren?: boolean;
    /**
     * When true, hide top-level projects (project under the heuristic
     * `lib/projects.ts` AND `parent_id IS NULL`). The project's children
     * with this state still show. Used by /next so the project-as-container
     * doesn't pollute the actionable list — canon GTD, the next action is
     * the child, not the project itself.
     */
    hideTopLevelProjects?: boolean;
    /**
     * When true, hide sub-items of `is_sequential` parents whose head-of-queue
     * is some other child. Used by /next so a sequential project surfaces only
     * one actionable child at a time.
     */
    sequentialFilter?: boolean;
    topbarExtras?: import('svelte').Snippet;
  } = $props();

  // `liveQuery` re-subscribes via `$effect` when its getter's reactive deps
  // change. Wrapping the stock `useQuery` in `$derived` was the previous bug —
  // it spawned a new orphan subscription on each run and `fetching` never
  // settled. See `$lib/live-query.svelte.ts`.
  //
  // Post-doc-44: `state` ya no es field; cargamos todos los items y filtramos
  // por `derivedState(it) === itemState` abajo. Volumen típico (≤10k items)
  // hace que el filter client-side sea irrelevante en latencia.
  const sub = liveQuery<Item>(triplit, () =>
    triplit
      .query('items')
      .Where('deleted_at', 'isDefined', false)
      .Order('created_at', 'DESC'),
  );

  // Parent titles for sub-item breadcrumbs come from the shared `orgs` cache
  // (one app-wide projects subscription, not one per list view).
  function parentTitleFor(it: Item): string | undefined {
    return it.parent_id ? orgs.projectById.get(it.parent_id)?.title : undefined;
  }

  // Sequential filter: subscribe to all items so we can determine each
  // sequential parent's head-of-queue (first non-done/non-trashed child by position).
  // Returns null query when disabled — `liveQuery` treats null as "no subscription".
  const allItemsSub = liveQuery<Item>(triplit, () =>
    sequentialFilter
      ? triplit.query('items').Where('deleted_at', 'isDefined', false)
      : null,
  );

  const sequentialParentIds = $derived.by(() => {
    if (!sequentialFilter) return new Set<string>();
    const set = new Set<string>();
    const projMap = orgs.isProjectMap;
    for (const it of allItemsSub.results) {
      if (it.is_sequential && projMap.get(it.id)) set.add(it.id);
    }
    return set;
  });

  const visibleChildBySeqParent = $derived.by(() => {
    if (!sequentialFilter) return new Map<string, string>();
    const all = allItemsSub.results;
    // Group children by parent_id.
    const byParent = new Map<string, Item[]>();
    for (const it of all) {
      if (!it.parent_id) continue;
      const arr = byParent.get(it.parent_id) ?? [];
      arr.push(it);
      byParent.set(it.parent_id, arr);
    }
    // For each sequential parent, find its head-of-queue (first non-done/non-trashed child).
    // That child is the one allowed to surface in /next — but only if it's in the requested state.
    const result = new Map<string, string>();
    for (const id of sequentialParentIds) {
      const kids = (byParent.get(id) ?? []).slice().sort((a, b) =>
        (a.position ?? '').localeCompare(b.position ?? ''),
      );
      const head = kids.find(isLive);
      if (head && derivedState(head) === itemState) result.set(id, head.id);
    }
    return result;
  });

  const allItems = $derived(sub.results.filter((it) => derivedState(it) === itemState));
  const items = $derived.by(() => {
    let xs = allItems;
    if (hideTopLevelProjects) {
      const projMap = orgs.isProjectMap;
      xs = xs.filter((it) => !(!it.parent_id && projMap.get(it.id)));
    }
    if (hideTrashedParentChildren) {
      const projects = orgs.projectById;
      xs = xs.filter((it) => {
        if (!it.parent_id) return true;
        const parent = projects.get(it.parent_id);
        return !parent || !isTrashed(parent);
      });
    }
    if (sequentialFilter) {
      xs = xs.filter((it) => {
        if (!it.parent_id) return true;
        if (!sequentialParentIds.has(it.parent_id)) return true;
        return visibleChildBySeqParent.get(it.parent_id) === it.id;
      });
    }
    return xs;
  });

  // Group "waiting" items by `waiting_for` for nicer UX.
  const grouped = $derived.by(() => {
    if (!showWaitingFor) return null;
    const map = new Map<string, Item[]>();
    for (const it of items) {
      const k = it.waiting_for ?? '—';
      const arr = map.get(k) ?? [];
      arr.push(it);
      map.set(k, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  });
</script>

{#if topbarExtras}
  <header class="topbar">
    <span class="extras">{@render topbarExtras()}</span>
  </header>
{/if}

<main class="page">
  {#if sub.fetching && !items.length}
    <p class="hint">Cargando…</p>
  {:else if !items.length}
    <p class="empty">{emptyHint}</p>
  {:else if showWaitingFor && grouped}
    {#each grouped as [who, group] (who)}
      <section class="group">
        <h2>{who}</h2>
        <ul class="list">
          {#each group as item (item.id)}
            <ItemRow {item} parentTitle={parentTitleFor(item)} />
          {/each}
        </ul>
      </section>
    {/each}
  {:else}
    <ul class="list">
      {#each items as item (item.id)}
        <ItemRow {item} parentTitle={parentTitleFor(item)} />
      {/each}
    </ul>
  {/if}
</main>

<style>
  .topbar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    /* padding-top vive en `.page-shell` (layout). */
    padding: 0 var(--container-pad-x) var(--space-3);
  }
  .extras {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
  }
  .page {
    width: 100%;
    max-width: var(--container-max);
    margin: 0 auto var(--space-8);
    padding: 0 var(--container-pad-x);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }
  .empty {
    text-align: center;
    color: var(--text-muted);
    margin: var(--space-7) 0 var(--space-3);
  }
  .hint {
    text-align: center;
    color: var(--text-muted);
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .group h2 {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
    margin: var(--space-3) 0 var(--space-2);
    font-weight: var(--weight-medium);
  }
</style>
