<script lang="ts">
  import { useQuery } from '@triplit/svelte';
  import { triplit } from '$lib/triplit';
  import { startOfDay } from '@gtd/core';
  import { applyStateTransition, isDone, isLive } from '$lib/item-state';
  import { now } from '$lib/stores/now.svelte';
  import { orgs } from '$lib/stores/orgs.svelte';
  import type { Item } from '@gtd/schema';
  import ItemRow from '$lib/components/ItemRow.svelte';
  import { EMPTY } from '$lib/copy';

  // Calendario MVP (doc 46 Fase 1): vista agenda cronológica de items
  // con `start_at` set. Eventos solamente (compromisos con hora fija).
  // Tareas normales con `due_at` no aparecen aquí — esto es tiempo
  // no-propio.
  const sub = useQuery(
    triplit,
    triplit
      .query('items')
      .Where('deleted_at', 'isDefined', false)
      .Where('start_at', 'isDefined', true)
      .Order('start_at', 'ASC'),
  );

  // Toggle "ver completadas" (✓). Por defecto el calendario mira hacia
  // delante y sólo muestra eventos vivos; al activarlo aparecen también los
  // completados (atenuados, en su día), incluidos días pasados para que el
  // historial de recurrentes sea visible.
  let showDone = $state(false);

  const events = $derived(
    ((sub.results ?? []) as Item[]).filter((it) => isLive(it) || (showDone && isDone(it))),
  );

  const doneCount = $derived(((sub.results ?? []) as Item[]).filter(isDone).length);

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

  function parentTitleFor(it: Item): string | undefined {
    return it.parent_id ? orgs.projectById.get(it.parent_id)?.title : undefined;
  }

  // Agrupa por día absoluto. Usa el `start_at` para determinar el día.
  // Items pasados se ocultan por defecto (se acceden bajando al pasado en
  // futuras fases — por ahora foco en lo próximo).
  const groups = $derived.by(() => {
    const today = startOfDay(now.value);
    const todayMs = today.getTime();
    type Group = { day: Date; key: string; items: Item[] };
    const byDay = new Map<string, Group>();
    for (const it of events) {
      if (!it.start_at) continue;
      // Eventos vivos terminados (end_at < today) se ocultan: el calendario
      // mira hacia delante. Los completados SÍ se conservan en su día (cuando
      // showDone está activo) para que el historial sea navegable hacia atrás.
      const endMs = it.end_at ? it.end_at.getTime() : it.start_at.getTime();
      if (!isDone(it) && endMs < todayMs) continue;
      const day = startOfDay(it.start_at);
      const key = day.toISOString().slice(0, 10);
      const g = byDay.get(key) ?? { day, key, items: [] };
      g.items.push(it);
      byDay.set(key, g);
    }
    return Array.from(byDay.values()).sort((a, b) => a.day.getTime() - b.day.getTime());
  });

  const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  function dayLabel(d: Date): string {
    const today = startOfDay(now.value);
    const todayMs = today.getTime();
    const tomorrowMs = todayMs + 24 * 60 * 60 * 1000;
    const dMs = d.getTime();
    if (dMs === todayMs) return 'Hoy';
    if (dMs === tomorrowMs) return 'Mañana';
    return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  }

  function timeRangeLabel(it: Item): string {
    if (it.all_day) return 'Todo el día';
    if (!it.start_at) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    const s = `${pad(it.start_at.getHours())}:${pad(it.start_at.getMinutes())}`;
    if (!it.end_at) return s;
    const e = `${pad(it.end_at.getHours())}:${pad(it.end_at.getMinutes())}`;
    return `${s}–${e}`;
  }
</script>

<header class="topbar">
  <div class="filter-row">
    <div class="filter-actions">
      <button
        type="button"
        class="cal-filter"
        class:active={showDone}
        onclick={() => { showDone = !showDone; }}
        aria-pressed={showDone}
        aria-label="Mostrar completadas"
        title="Mostrar completadas"
      >✓</button>
      {#if showDone && doneCount}
        <button
          class="cal-trash"
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
      {/if}
    </div>
  </div>
</header>

<main class="page">
  {#if sub.fetching && !events.length}
    <p class="hint">Cargando…</p>
  {:else if !groups.length}
    <p class="empty">{EMPTY.calendar}</p>
  {:else}
    {#each groups as g (g.key)}
      <section class="day-block" class:is-today={dayLabel(g.day) === 'Hoy'}>
        <h2 class="day-h">
          {dayLabel(g.day)}
        </h2>
        <ul class="list">
          {#each g.items as item (item.id)}
            <li class="event-row">
              <span class="time">{timeRangeLabel(item)}</span>
              <div class="event-body">
                <ItemRow {item} parentTitle={parentTitleFor(item)} dim={isDone(item)} />
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/if}
</main>

<style>
  /* Barra de filtros: mismo idiom que /work (toggle ✓ + papelera). */
  .topbar {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
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
  /* ✓ ver completadas: icono circular, mismo recipe que .recurring-filter
   * de /work (pressed = press-bg + inset). */
  .cal-filter {
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
  .cal-filter:hover {
    color: var(--text-secondary);
  }
  .cal-filter.active {
    color: var(--text-primary);
    background: var(--press-bg-medium);
    box-shadow: var(--shadow-inset-sm);
    transform: translateY(1px);
  }
  /* Purga de completadas (solo visible con ✓ activo y habiendo hechas). */
  .cal-trash {
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
  .cal-trash:hover {
    color: var(--danger);
    background: var(--danger-bg);
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
  .day-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .day-h {
    font-size: var(--text-sm);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    margin: 0 0 var(--space-1);
    font-weight: var(--weight-medium);
  }
  /* "Hoy" en accent. No vale `:first-child`: con el toggle ✓ pueden
   * aparecer días pasados (con completadas) por encima de Hoy. */
  .day-block.is-today .day-h {
    color: var(--accent);
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    --row-surface: var(--surface-raised);
    --row-radius: var(--radius-md);
    --row-gap: var(--space-2);
    --row-pad-x: var(--space-3);
    --row-shadow-elev: var(--shadow-flat);
    --row-shadow-hover: var(--shadow-sunken-sm);
  }
  .event-row {
    display: grid;
    grid-template-columns: 6.5rem 1fr;
    align-items: start;
    gap: var(--space-3);
  }
  .time {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    padding-top: var(--space-2);
    white-space: nowrap;
  }
  .event-body {
    min-width: 0;
  }
  @media (max-width: 30rem) {
    .event-row {
      grid-template-columns: 1fr;
      gap: 0;
    }
    .time {
      padding-top: 0;
      padding-left: var(--space-3);
      font-size: var(--text-xs);
    }
  }
</style>
