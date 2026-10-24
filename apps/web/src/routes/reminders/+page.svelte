<script lang="ts">
  import { useQuery } from '@triplit/svelte';
  import { triplit } from '$lib/triplit';
  import { formatDDMMYYYY, startOfDay } from '@gtd/core';
  import { isLive } from '$lib/item-state';
  import { now } from '$lib/stores/now.svelte';
  import { orgs } from '$lib/stores/orgs.svelte';
  import type { Item } from '@gtd/schema';
  import ItemRow from '$lib/components/ItemRow.svelte';
  import { EMPTY } from '$lib/copy';

  // Recordatorios = items con `remind_at` set + live. La vista los agrupa
  // en buckets temporales para que el user vea de un vistazo qué viene en
  // cada ventana (doc 47).
  const sub = useQuery(
    triplit,
    triplit
      .query('items')
      .Where('deleted_at', 'isDefined', false)
      .Where('remind_at', 'isDefined', true)
      .Order('remind_at', 'ASC'),
  );

  const items = $derived(((sub.results ?? []) as Item[]).filter(isLive));

  function parentTitleFor(it: Item): string | undefined {
    return it.parent_id ? orgs.projectById.get(it.parent_id)?.title : undefined;
  }

  // Buckets (cronológicos sobre fechas absolutas — el user piensa en
  // semanas/meses, no en "en 3 días"):
  //   1. Ya disponibles  → remind_at <= startOfToday. El item ya volvió a
  //                        Bandeja, lo mostramos también aquí como puente
  //                        hasta que el user lo reprocese.
  //   2. Esta semana     → remind_at < startOfToday+7d
  //   3. Este mes        → remind_at < startOfToday+30d
  //   4. Más adelante    → resto
  const buckets = $derived.by(() => {
    const today = startOfDay(now.value);
    const todayMs = today.getTime();
    const weekMs = todayMs + 7 * 24 * 60 * 60 * 1000;
    const monthMs = todayMs + 30 * 24 * 60 * 60 * 1000;

    const available: Item[] = [];
    const thisWeek: Item[] = [];
    const thisMonth: Item[] = [];
    const later: Item[] = [];

    for (const it of items) {
      if (!it.remind_at) continue;
      const ms = it.remind_at.getTime();
      if (ms <= todayMs) available.push(it);
      else if (ms < weekMs) thisWeek.push(it);
      else if (ms < monthMs) thisMonth.push(it);
      else later.push(it);
    }
    return { available, thisWeek, thisMonth, later };
  });
</script>

<main class="page">
  {#if sub.fetching && !items.length}
    <p class="hint">Cargando…</p>
  {:else if !items.length}
    <p class="empty">{EMPTY.reminders}</p>
  {:else}
    {#if buckets.available.length}
      <section class="block">
        <h2 class="section-h">Ya disponibles</h2>
        <ul class="list">
          {#each buckets.available as item (item.id)}
            <ItemRow {item} parentTitle={parentTitleFor(item)} />
          {/each}
        </ul>
      </section>
    {/if}

    {#if buckets.thisWeek.length}
      <section class="block">
        <h2 class="section-h">Esta semana</h2>
        <ul class="list">
          {#each buckets.thisWeek as item (item.id)}
            <div class="row-with-date">
              <span class="date-tag">{formatDDMMYYYY(item.remind_at)}</span>
              <ItemRow {item} parentTitle={parentTitleFor(item)} />
            </div>
          {/each}
        </ul>
      </section>
    {/if}

    {#if buckets.thisMonth.length}
      <section class="block">
        <h2 class="section-h">Este mes</h2>
        <ul class="list">
          {#each buckets.thisMonth as item (item.id)}
            <div class="row-with-date">
              <span class="date-tag">{formatDDMMYYYY(item.remind_at)}</span>
              <ItemRow {item} parentTitle={parentTitleFor(item)} />
            </div>
          {/each}
        </ul>
      </section>
    {/if}

    {#if buckets.later.length}
      <section class="block">
        <h2 class="section-h">Más adelante</h2>
        <ul class="list">
          {#each buckets.later as item (item.id)}
            <div class="row-with-date">
              <span class="date-tag">{formatDDMMYYYY(item.remind_at)}</span>
              <ItemRow {item} parentTitle={parentTitleFor(item)} />
            </div>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</main>

<style>
  .page {
    width: 100%;
    max-width: var(--container-max);
    margin: 0 auto var(--space-8);
    padding: 0 var(--container-pad-x);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
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
  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .section-h {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
    margin: 0 0 var(--space-1);
    font-weight: var(--weight-medium);
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    --row-surface: var(--surface-raised);
    --row-radius: var(--radius-md);
    --row-gap: var(--space-2);
    --row-pad-x: var(--space-3);
    --row-shadow-elev: var(--shadow-flat);
    --row-shadow-hover: var(--shadow-sunken-sm);
  }
  /* Etiqueta fecha a la izquierda de cada fila. El bucket "Ya disponibles"
   * no la lleva porque la fecha ya pasó y el dato no aporta. */
  .row-with-date {
    display: grid;
    grid-template-columns: max-content 1fr;
    align-items: center;
    gap: var(--space-3);
  }
  .date-tag {
    font-size: var(--text-xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  @media (max-width: 30rem) {
    .row-with-date {
      grid-template-columns: 1fr;
      gap: 0;
    }
    .date-tag {
      padding-left: var(--space-3);
    }
  }
</style>
