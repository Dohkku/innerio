<script lang="ts">
  import { triplit } from '$lib/triplit';
  import { liveQuery } from '$lib/live-query.svelte';
  import type { Item } from '@gtd/schema';
  import ItemRow from '$lib/components/ItemRow.svelte';
  import { isStalled } from '@gtd/core';
  import { buildIsProjectMap } from '$lib/projects';
  import { derivedState } from '$lib/item-state';
  import { now } from '$lib/stores/now.svelte';

  const EMPTY = 'Sin proyectos activos.';

  // Post-Musk-3.B: there's no `type` discriminator any more, so we fetch every
  // item and let the heuristic in `lib/projects` decide project-icity. The
  // resulting set is filtered to top-level (`!parent_id`) for the list.
  const itemsSub = liveQuery<Item>(triplit, () =>
    triplit
      .query('items')
      .Where('deleted_at', 'isDefined', false)
      .Order('created_at', 'DESC'),
  );

  const allItemsRaw = $derived((itemsSub.results ?? []) as Item[]);
  const isProjMap = $derived(buildIsProjectMap(allItemsRaw));
  const allItems = $derived(allItemsRaw.filter((p) => !p.parent_id && isProjMap.get(p.id)));

  const childrenByParent = $derived.by(() => {
    const map = new Map<string, Item[]>();
    for (const it of allItemsRaw) {
      if (!it.parent_id) continue;
      const arr = map.get(it.parent_id);
      if (arr) arr.push(it);
      else map.set(it.parent_id, [it]);
    }
    return map;
  });

  const stalledIds = $derived.by(() => {
    void now.value;
    const set = new Set<string>();
    for (const p of allItems) {
      if (isStalled(p, childrenByParent.get(p.id) ?? [], now.value)) set.add(p.id);
    }
    return set;
  });

  const visible = $derived.by(() => {
    return allItems.filter((p) => {
      const s = derivedState(p);
      return s !== 'done' && s !== 'trashed' && s !== 'someday';
    });
  });
</script>

<main class="page">
  {#if itemsSub.fetching && !allItems.length}
    <p class="hint">Cargando…</p>
  {:else if !visible.length}
    <p class="empty">{EMPTY}</p>
  {:else}
    <ul class="list">
      {#each visible as item (item.id)}
        <ItemRow {item} stalled={stalledIds.has(item.id)} isProject={true} />
      {/each}
    </ul>
  {/if}
</main>

<style>
  .page {
    width: 100%;
    max-width: var(--container-max);
    /* margin-top vive en `.page-shell` (layout). */
    margin: 0 auto var(--space-8);
    padding: 0 var(--container-pad-x);
    display: flex;
    flex-direction: column;
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
    --row-surface: var(--surface-raised);
    --row-radius: 0 0 var(--radius-md) var(--radius-md);
    --row-gap: var(--space-2);
    --row-pad-x: var(--space-3);
    --row-shadow-elev: var(--shadow-flat);
    --row-shadow-hover: var(--shadow-sunken-sm);
  }
</style>
