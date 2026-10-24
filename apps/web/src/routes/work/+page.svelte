<script lang="ts">
  import { useQuery } from '@triplit/svelte';
  import { triplit } from '$lib/triplit';
  import { isOverdue, isToday } from '@gtd/core';
  import { isRecurringToday } from '$lib/recurrence';
  import { now } from '$lib/stores/now.svelte';
  import { orgs } from '$lib/stores/orgs.svelte';
  import {
    applyStateTransition,
    derivedState,
    isDone,
    isLive,
    isReminderPending,
    isTrashed,
  } from '$lib/item-state';
  import type { Item } from '@gtd/schema';
  import { EMPTY } from '$lib/copy';
  import ItemRow from '$lib/components/ItemRow.svelte';

  const sub = useQuery(
    triplit,
    triplit
      .query('items')
      .Where('deleted_at', 'isDefined', false)
      .Order('created_at', 'DESC'),
  );
  // Filtra tickler activo: items con `remind_at` futuro se esconden de
  // Hoy/Pendientes/Recurrentes hasta que la fecha llegue (doc 47).
  // Filtra items agendados: con `start_at` set viven en /calendar como
  // compromiso de tiempo bloqueado — no son discreción tuya, no compiten
  // con las siguientes acciones libres (doc 46).
  const items = $derived(
    ((sub.results ?? []) as Item[]).filter(
      (it) => isLive(it) && !isReminderPending(it, now.value) && it.start_at == null,
    ),
  );

  let recurringOnly = $state(false);
  let recurringOpen = $state(false);
  let showDone = $state(false);

  // Items completados (sin trashear). Solo se computa cuando el toggle
  // está activo — ahorra trabajo cuando la vista está en modo "live only".
  const doneItems = $derived.by(() => {
    if (!showDone) return [];
    const all = (sub.results ?? []) as Item[];
    return all
      .filter(isDone)
      .sort((a, b) => {
        const ta = a.completed_at ? new Date(a.completed_at).getTime() : 0;
        const tb = b.completed_at ? new Date(b.completed_at).getTime() : 0;
        return tb - ta;
      });
  });

  async function trashAllDone() {
    const all = ((sub.results ?? []) as Item[]).filter(isDone);
    if (!all.length) return;
    await Promise.all(
      all.map((it) =>
        triplit.update('items', it.id, (entity) => {
          applyStateTransition(entity, 'trashed');
        }),
      ),
    );
  }

  const sequentialParents = $derived.by(() => {
    const set = new Set<string>();
    const projMap = orgs.isProjectMap;
    for (const it of items) {
      if (it.is_sequential && projMap.get(it.id)) set.add(it.id);
    }
    return set;
  });

  const headByParent = $derived.by(() => {
    const byParent = new Map<string, Item[]>();
    for (const it of items) {
      if (!it.parent_id) continue;
      const arr = byParent.get(it.parent_id) ?? [];
      arr.push(it);
      byParent.set(it.parent_id, arr);
    }
    const result = new Map<string, string>();
    for (const id of sequentialParents) {
      const kids = (byParent.get(id) ?? [])
        .slice()
        .sort((a, b) => (a.position ?? '').localeCompare(b.position ?? ''));
      const head = kids.find(isLive);
      if (head) result.set(id, head.id);
    }
    return result;
  });

  function isActiveStructural(it: Item): boolean {
    if (orgs.isProjectMap.get(it.id)) return false;
    if (it.parent_id) {
      const parent = orgs.projectById.get(it.parent_id);
      if (parent && isTrashed(parent)) return false;
    }
    return true;
  }

  function passesFilters(it: Item): boolean {
    if (recurringOnly && it.recurrence == null) return false;
    return true;
  }

  function isTodayRelevant(it: Item): boolean {
    return (
      isToday(it.due_at, now.value) ||
      (derivedState(it) === 'next' && isRecurringToday(it, now.value))
    );
  }

  function dueTime(it: Item): number {
    return it.due_at ? new Date(it.due_at).getTime() : Number.POSITIVE_INFINITY;
  }

  const overdue = $derived(
    items
      .filter(
        (it) =>
          isActiveStructural(it) &&
          isOverdue(it.due_at, now.value) &&
          passesFilters(it),
      )
      .sort((a, b) => dueTime(a) - dueTime(b)),
  );

  const todayItems = $derived(
    items
      .filter(
        (it) =>
          isActiveStructural(it) &&
          !isOverdue(it.due_at, now.value) &&
          isTodayRelevant(it) &&
          passesFilters(it),
      )
      .sort((a, b) => dueTime(a) - dueTime(b)),
  );

  const hoyIds = $derived.by(() => {
    const set = new Set<string>();
    for (const it of overdue) set.add(it.id);
    for (const it of todayItems) set.add(it.id);
    return set;
  });

  function isPendingVisible(it: Item): boolean {
    if (derivedState(it) !== 'next') return false;
    if (!isActiveStructural(it)) return false;
    if (it.parent_id) {
      if (
        sequentialParents.has(it.parent_id) &&
        headByParent.get(it.parent_id) !== it.id
      ) {
        return false;
      }
    }
    if (hoyIds.has(it.id)) return false;
    if (!passesFilters(it)) return false;
    // Recurrentes: ocultos de Pendiente salvo que chip ↻ esté activo (cubre
    // tanto standalone como subitems de proyecto). Su día reaparecen via
    // isRecurringToday en Hoy. Chip ↻ es el acceso para editar parámetros
    // (frecuencia, días, parar) o ver el calendario de recurrentes.
    if (!recurringOnly && it.recurrence != null) {
      return false;
    }
    return true;
  }

  const pendingVisible = $derived(items.filter(isPendingVisible));

  function isRecurringStandalone(it: Item): boolean {
    return it.recurrence != null && !it.parent_id && !orgs.isProjectMap.get(it.id);
  }

  const recurringBucket = $derived(pendingVisible.filter(isRecurringStandalone));
  const mainBucket = $derived(pendingVisible.filter((it) => !isRecurringStandalone(it)));

  const hoyTotal = $derived(overdue.length + todayItems.length);
  const pendingTotal = $derived(mainBucket.length + recurringBucket.length);
  const total = $derived(hoyTotal + pendingTotal);

  // Agrupa today + pending por proyecto padre. Items sin parent_id van
  // a `orphan*` y se renderizan al final sin header (decisión UX —
  // proyectos primero, sueltos abajo sin copy).
  function groupByParent(arr: Item[]): Map<string, Item[]> {
    const m = new Map<string, Item[]>();
    for (const it of arr) {
      const k = it.parent_id ?? '__orphan';
      const a = m.get(k) ?? [];
      a.push(it);
      m.set(k, a);
    }
    return m;
  }

  const projectGroups = $derived.by(() => {
    const pendingMap = groupByParent(mainBucket);
    const parentIds = new Set<string>();
    for (const k of pendingMap.keys()) if (k !== '__orphan') parentIds.add(k);
    const list: { id: string; title: string; sequential: boolean; pending: Item[] }[] = [];
    for (const id of parentIds) {
      const p = orgs.projectById.get(id);
      list.push({
        id,
        title: p?.title ?? '',
        sequential: p?.is_sequential ?? false,
        pending: pendingMap.get(id) ?? [],
      });
    }
    list.sort((a, b) => a.title.localeCompare(b.title));
    return { groups: list, orphanPending: pendingMap.get('__orphan') ?? [] };
  });

</script>

<header class="topbar">
  <div class="filter-row">
    <div class="filter-actions">
      <button
        type="button"
        class="recurring-filter"
        class:active={recurringOnly}
        onclick={() => { recurringOnly = !recurringOnly; }}
        aria-pressed={recurringOnly}
        aria-label="Solo recurrentes"
        title="Solo recurrentes"
      >↻</button>
      <button
        type="button"
        class="recurring-filter"
        class:active={showDone}
        onclick={() => { showDone = !showDone; }}
        aria-pressed={showDone}
        aria-label="Mostrar completadas"
        title="Mostrar completadas"
      >✓</button>
    </div>
  </div>
</header>

<main class="page">
  {#if sub.fetching && !items.length}
    <p class="hint">Cargando…</p>
  {:else if !total && !doneItems.length}
    <p class="empty">
      {#if recurringOnly}
        {EMPTY.workFiltered}
      {:else}
        {EMPTY.work}
      {/if}
    </p>
  {:else}
    {#if overdue.length}
      <section class="block">
        <div class="group" data-kind="overdue">
          <h3 class="section-h overdue-h">Vencido</h3>
          <ul class="list">
            {#each overdue as item (item.id)}
              <ItemRow {item} showRecurDetails={recurringOnly} />
            {/each}
          </ul>
        </div>
      </section>
    {/if}

    {#if todayItems.length || mainBucket.length}
      <section class="block">
        {#if todayItems.length}
          <div class="proj-group">
            <h2 class="proj-h">Vencen hoy</h2>
            <ul class="list">
              {#each todayItems as item (item.id)}
                <ItemRow {item} showRecurDetails={recurringOnly} />
              {/each}
            </ul>
          </div>
        {/if}
        {#each projectGroups.groups as g (g.id)}
          <div class="proj-group">
            <h2 class="proj-h">{g.title}</h2>
            <ul class="list">
              {#each g.pending as item (item.id)}
                <ItemRow {item} showRecurDetails={recurringOnly} />
              {/each}
            </ul>
          </div>
        {/each}
        {#if projectGroups.orphanPending.length}
          <ul class="list orphan-list">
            {#each projectGroups.orphanPending as item (item.id)}
              <ItemRow {item} showRecurDetails={recurringOnly} />
            {/each}
          </ul>
        {/if}
      </section>
    {/if}

    {#if recurringBucket.length}
      <section class="block">
        <div class="group">
          <button
            class="recurring-toggle"
            type="button"
            onclick={() => { recurringOpen = !recurringOpen; }}
            aria-expanded={recurringOpen}
          >
            <span class="section-h">
              <span class="recur-sym" aria-hidden="true">↻</span>
              Recurrentes
              <span class="recur-count">({recurringBucket.length})</span>
            </span>
            <span class="chevron" aria-hidden="true">{recurringOpen ? '▲' : '▼'}</span>
          </button>
          {#if recurringOpen}
            <ul class="list">
              {#each recurringBucket as item (item.id)}
                <ItemRow {item} showRecurDetails />
              {/each}
            </ul>
          {/if}
        </div>
      </section>
    {/if}

    {#if showDone && doneItems.length}
      <section class="block done-block">
        <ul class="list">
          {#each doneItems as item (item.id)}
            <ItemRow {item} dim />
          {/each}
        </ul>
        <div class="trash-all-row">
          <button
            class="trash-all"
            type="button"
            onclick={trashAllDone}
            aria-label="Borrar todas las completadas"
            title="Borrar todas las completadas"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6l-1.2 13a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 6" />
            </svg>
          </button>
        </div>
      </section>
    {/if}
  {/if}
</main>

<style>
  .topbar {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    /* padding-top vive en `.page-shell` (layout). El bottom da el aire
     * entre el bloque de filtros y la primera lista. */
    padding: 0 var(--container-pad-x) var(--space-3);
  }
  .filter-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
  }
  .filter-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  /* ↻ recurring + ✓ hechas: iconos circulares (width=height fijo para que
   * todos los glifos lean redondos — sin esto ✓ y ↻ tienen anchos
   * distintos y el pressed-state pinta una elipse en vez de círculo). */
  .recurring-filter {
    appearance: none;
    background: transparent;
    border: 0;
    color: var(--text-muted);
    font: inherit;
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
    width: var(--control-md);
    height: var(--control-md);
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    transition: color 80ms, background 80ms;
  }
  .recurring-filter:hover {
    color: var(--text-secondary);
  }
  .recurring-filter.active {
    color: var(--text-primary);
    background: var(--press-bg-medium);
    box-shadow: var(--shadow-inset-sm);
    transform: translateY(1px);
  }
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
    gap: var(--space-3);
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  /* Sub-grupos por proyecto dentro de la sección Hoy+Pendiente. Header
   * misma tipografía que /waiting (eyebrow uppercase). Sin header para
   * el bucket "sin proyecto" (decisión UX). */
  .proj-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .proj-h {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
    margin: 0 0 var(--space-1);
    font-weight: var(--weight-medium);
  }
  /* Separación visual extra entre el último grupo de proyecto y la lista
   * "sin proyecto" — sin header pero con aire para que se lea como cubo
   * distinto. Se suma al gap del .block. */
  .orphan-list:not(:first-child) {
    margin-top: var(--space-4);
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    /* Filas ligeramente elevadas, sin dirección — sólo halo plano. */
    --row-surface: var(--surface-raised);
    --row-radius: var(--radius-md);
    --row-gap: var(--space-2);
    --row-pad-x: var(--space-3);
    --row-shadow-elev: var(--shadow-flat);
    --row-shadow-hover: var(--shadow-sunken-sm);
  }
  .section-h {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
    margin: 0 0 var(--space-1);
    font-weight: var(--weight-medium);
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .overdue-h {
    color: var(--text-primary);
  }
  .overdue-h::before {
    content: '';
    display: inline-block;
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 999px;
    background: var(--text-primary);
    margin-right: var(--space-2);
    vertical-align: 0.05em;
  }
  .recurring-toggle {
    appearance: none;
    background: transparent;
    border: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.4rem;
    width: 100%;
    text-align: left;
    padding: 0;
    border-radius: var(--radius-sm);
  }
  .recurring-toggle:hover .section-h {
    opacity: 0.9;
  }
  .recur-sym {
    color: var(--text-secondary);
  }
  .recur-count {
    font-variant-numeric: tabular-nums;
    opacity: 0.6;
  }
  .chevron {
    font-size: var(--text-xxs);
    opacity: 0.45;
    flex-shrink: 0;
  }
  /* Hechas sin header ni gap — visualmente continúa la lista de pending,
   * los items dim hacen evidente que son completados. La trash-all queda
   * como pequeño icono al final, sin label. */
  .trash-all-row {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--space-2);
  }
  .trash-all {
    appearance: none;
    background: transparent;
    border: 0;
    color: var(--text-muted);
    width: var(--control-md);
    height: var(--control-md);
    border-radius: var(--radius-sm);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: color var(--dur-quick) ease, background var(--dur-quick) ease;
  }
  .trash-all:hover {
    color: var(--danger);
    background: var(--danger-bg);
  }
</style>
