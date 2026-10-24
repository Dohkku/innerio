<script lang="ts">
  import { tick } from 'svelte';
  import { triplit } from '$lib/triplit';
  import { liveQuery } from '$lib/live-query.svelte';
  import { LIMITS } from '$lib/limits';
  import { formatDDMMYYYY, sameDate } from '@gtd/core';
  import { useScope } from '$lib/keyboard.svelte';
  import { maybeCascadeChildren } from '$lib/cascade';
  import {
    RECUR_OPTIONS,
    WEEK_DAYS,
    advanceRecurrence,
    readRecurrence,
    recurUnitLabel,
    type Recurrence,
  } from '$lib/recurrence';
  import { orgs } from '$lib/stores/orgs.svelte';
  import { now } from '$lib/stores/now.svelte';
  import type { Item } from '@gtd/schema';
  import { applyStateTransition, derivedState, isReminderPending } from '$lib/item-state';
  import { commitItemDate, commitItemOutcome, commitItemTitle } from '$lib/item-save';
  import { blurIfEditable, focusNextTabbable } from '$lib/dom-utils';
  import { useItemSync } from '$lib/use-item-sync.svelte';
  import BackButton from './BackButton.svelte';
  import DateInput from './DateInput.svelte';
  import StateChanger from './StateChanger.svelte';
  import ReminderPrompt from './ReminderPrompt.svelte';


  let {
    itemId,
    onclose,
  }: {
    itemId: string;
    onclose: () => void;
  } = $props();

  const sub = liveQuery<Item>(triplit, () =>
    triplit.query('items').Where('id', '=', itemId).Limit(1),
  );
  const item = $derived((sub.results[0] ?? null) as Item | null);

  let title = $state('');
  let notes = $state('');
  let outcome = $state('');
  let titleInputEl = $state<HTMLInputElement | undefined>(undefined);

  useItemSync(
    () => item,
    (it) => `${it.title}\0${it.notes ?? ''}\0${it.outcome ?? ''}`,
    (it, isNew) => {
      title = it.title;
      notes = it.notes ?? '';
      outcome = it.outcome ?? '';
      if (isNew) void tick().then(() => titleInputEl?.focus());
    },
  );

  let reminderPrompt = $state(false);
  let busy = $state(false);

  // Estado derivado para la visibilidad contextual (doc 49). El Inspector
  // muestra distintos bloques según qué clase de item se está editando.
  const itemState = $derived(item ? derivedState(item) : 'inbox');
  const isProjectItem = $derived(item ? (orgs.isProjectMap.get(item.id) ?? false) : false);
  const reminderPending = $derived(item ? isReminderPending(item, now.value) : false);

  // Bloques visibles. Tabla canónica en doc 49.
  const showOutcome = $derived(isProjectItem);
  const showVence = $derived(
    itemState !== 'reference' && itemState !== 'trashed',
  );
  const showRecordar = $derived(
    itemState === 'inbox' || itemState === 'next' || itemState === 'someday',
  );
  const showCalendarSection = $derived(
    !isProjectItem && (itemState === 'inbox' || itemState === 'next'),
  );
  const showRecurrence = $derived(
    !isProjectItem && !reminderPending && itemState === 'next',
  );

  // Calendar block colapsado por defecto si el item NO es ya un evento.
  // El user puede expandirlo manualmente con "+ Programar evento". Si el
  // item ya tiene start_at, se renderiza expandido siempre.
  let calendarExpandedManual = $state(false);
  const calendarExpanded = $derived(!!item?.start_at || calendarExpandedManual);

  async function saveTitle() {
    if (!item) return;
    const result = await commitItemTitle(item, title);
    if (result === 'restored') title = item.title;
  }

  async function saveNotes() {
    if (!item) return;
    if (notes === (item.notes ?? '')) return;
    await triplit.update('items', item.id, (e) => {
      e.notes = notes;
    });
  }

  async function saveOutcome() {
    if (!item) return;
    await commitItemOutcome(item, outcome);
  }

  async function saveDueAt(next: Date | undefined) {
    if (!item) return;
    await commitItemDate(item, 'due_at', next);
  }

  async function saveRemindAt(next: Date | undefined) {
    if (!item) return;
    await commitItemDate(item, 'remind_at', next);
  }

  // === Calendar block (doc 46) ============================================
  // start_at/end_at son timestamps con hora. all_day=true colapsa la hora
  // a 00:00–23:59 local. tz se setea solo si difiere del browser tz.
  const browserTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;

  function toDateTimeLocal(d: Date | null | undefined): string {
    if (!d) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fromDateTimeLocal(s: string): Date | undefined {
    if (!s) return undefined;
    const [datePart, timePart = '00:00'] = s.split('T');
    const [y, mo, d] = datePart.split('-').map(Number);
    const [h, mi] = timePart.split(':').map(Number);
    if (!y || !mo || !d) return undefined;
    return new Date(y, mo - 1, d, h || 0, mi || 0, 0, 0);
  }

  async function saveStartAt(next: Date | undefined) {
    if (!item) return;
    if (sameDate(next, item.start_at)) return;
    await triplit.update('items', item.id, (e) => {
      e.start_at = next;
      // Si no había end_at, lo seteamos 1h después del start por defecto.
      if (next && !e.end_at) {
        const auto = new Date(next.getTime() + 60 * 60 * 1000);
        e.end_at = auto;
      }
      // Stamp tz si difiere del browser tz y no estaba seteado.
      if (next && browserTz && !e.tz) e.tz = browserTz;
    });
  }

  async function saveEndAt(next: Date | undefined) {
    if (!item) return;
    await commitItemDate(item, 'end_at', next);
  }

  async function toggleAllDay() {
    if (!item) return;
    const nextAllDay = !item.all_day;
    await triplit.update('items', item.id, (e) => {
      e.all_day = nextAllDay;
      // Si activamos all_day, normalizamos las horas a 00:00 / 23:59.
      if (nextAllDay && e.start_at) {
        const s = new Date(e.start_at);
        s.setHours(0, 0, 0, 0);
        e.start_at = s;
      }
      if (nextAllDay && e.end_at) {
        const en = new Date(e.end_at);
        en.setHours(23, 59, 59, 999);
        e.end_at = en;
      }
    });
  }

  // Tab dentro de notas avanza al siguiente field en lugar de insertar
  // tabulación. El inspector tiene flow lineal título → notas → outcome →
  // fecha → recurrencia, así que Tab "literal" no aporta.
  function notesKey(e: KeyboardEvent) {
    if (e.key === 'Tab') {
      e.preventDefault();
      focusNextTabbable(e.shiftKey ? -1 : 1);
    }
  }

  // Roving tabindex sobre los chips de día. Sin esto, los 7 chips son 7
  // Tab stops — engorroso. Con esto: un único Tab entra al grupo y
  // Left/Right navegan dentro. Patrón "toolbar" de ARIA APG.
  let weekdayFocus = $state(0);
  function weekdayKey(e: KeyboardEvent, idx: number) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const next = (idx + dir + WEEK_DAYS.length) % WEEK_DAYS.length;
      weekdayFocus = next;
      const group = (e.currentTarget as HTMLElement).parentElement;
      const btn = group?.children[next] as HTMLElement | undefined;
      btn?.focus();
    }
  }

  const RECURRENCE_PRESETS: Record<string, Recurrence> = {
    daily: { freq: 'daily' },
    weekly: { freq: 'weekly' },
    monthly: { freq: 'monthly' },
  };

  async function setRecurrence(freq: string) {
    if (!item) return;
    const current = readRecurrence(item.recurrence);
    if ((current?.freq ?? '') === freq) return;
    // Cambiar freq resetea interval/byDays — la combinación previa puede no
    // tener sentido en la nueva freq (p.ej. "cada 3 meses" → cambio a daily
    // no debería convertirse en "cada 3 días" silenciosamente).
    const next = RECURRENCE_PRESETS[freq];
    await triplit.update('items', item.id, (e) => {
      e.recurrence = next;
    });
  }

  async function setRecurInterval(value: number) {
    if (!item) return;
    const current = readRecurrence(item.recurrence);
    if (!current) return;
    const clamped = Math.max(1, Math.min(99, Math.trunc(value) || 1));
    const currentInterval = current.interval ?? 1;
    if (clamped === currentInterval) return;
    // interval=1 se persiste como ausencia del campo (norma doc 49).
    const next: Recurrence =
      clamped <= 1
        ? current.freq === 'weekly' && current.byDays?.length
          ? { freq: 'weekly', byDays: current.byDays }
          : { freq: current.freq }
        : current.freq === 'weekly'
          ? { freq: 'weekly', interval: clamped } // byDays se descarta con interval>1
          : { freq: current.freq, interval: clamped };
    await triplit.update('items', item.id, (e) => {
      e.recurrence = next;
    });
  }

  async function toggleWeekDay(code: number) {
    if (!item) return;
    const current = readRecurrence(item.recurrence);
    if (!current || current.freq !== 'weekly') return;
    // byDays sólo aplica con interval=1; si user está en "cada N semanas"
    // los chips están deshabilitados arriba en la UI.
    if ((current.interval ?? 1) > 1) return;
    const set = new Set(current.byDays ?? []);
    if (set.has(code)) set.delete(code);
    else set.add(code);
    const arr = [...set].sort((a, b) => a - b);
    const next: Recurrence =
      arr.length ? { freq: 'weekly', byDays: arr } : { freq: 'weekly' };
    await triplit.update('items', item.id, (e) => {
      e.recurrence = next;
    });
  }

  async function applyTransition(key: string) {
    if (!item || busy) return;
    // Recordatorio: abre date prompt en vez de mutar directamente.
    if (key === 'r') {
      reminderPrompt = true;
      return;
    }
    busy = true;
    try {
      // Recurrente + Hecho: avanza in-place, no cascade ni done transition.
      if (key === 'h' && (await advanceRecurrence(item))) {
        onclose();
        return;
      }
      if (key === 'h') {
        await maybeCascadeChildren(item, 'done');
      }
      if (key === 'd') await maybeCascadeChildren(item, 'trashed');
      const txNow = new Date();
      await triplit.update('items', item.id, (e) => {
        switch (key) {
          case 'a':
            applyStateTransition(e, 'next', txNow);
            break;
          case 'p':
            applyStateTransition(e, 'next', txNow);
            if (item && (item.outcome === undefined || item.outcome === null)) {
              e.outcome = '';
            }
            e.is_sequential = true;
            // Sin sub-proyectos: promover saca del padre, queda standalone.
            e.parent_id = undefined;
            break;
          case 'h':
            applyStateTransition(e, 'done', txNow);
            break;
          case 's':
            applyStateTransition(e, 'someday', txNow);
            break;
          case 'd':
            applyStateTransition(e, 'trashed', txNow);
            break;
          case 'b':
            applyStateTransition(e, 'inbox', txNow);
            break;
        }
      });
      onclose();
    } finally {
      busy = false;
    }
  }

  async function confirmReminder(date: Date) {
    if (!item) return;
    reminderPrompt = false;
    await triplit.update('items', item.id, (e) => {
      e.remind_at = date;
    });
    onclose();
  }

  function cancelReminder() {
    reminderPrompt = false;
  }

  // Mismo set que StateChanger.svelte: Proyecto/Recordatorio/Hecho/Descartar
  // + Devolver a Bandeja.
  const transitionLetters = ['p', 'r', 'h', 'd', 'b'] as const;

  useScope({
    name: 'inspector',
    modal: true,
    bindings: [
      {
        key: 'Escape',
        whileEditing: true,
        description: 'cerrar',
        handler: (e) => {
          if (!blurIfEditable(e.target)) onclose();
        },
      },
      {
        key: 'Enter',
        ctrl: true,
        whileEditing: true,
        description: 'guardar',
        handler: (e) => {
          blurIfEditable(e.target);
        },
      },
      ...transitionLetters.map((k) => ({
        key: k,
        hidden: true,
        handler: () => {
          if (reminderPrompt) return;
          void applyTransition(k);
        },
      })),
    ],
  });

</script>

<header class="head">
  <BackButton onclick={onclose} />
  <div class="head-right">
    {#if item?.parent_id}
      {@const parent = orgs.projectById.get(item.parent_id)}
      {#if parent}
        <a class="parent-crumb" href={`/projects/${parent.id}`}>
          {parent.title}
        </a>
      {/if}
    {/if}
  </div>
</header>

{#if !item}
  <p class="loading">Cargando…</p>
{:else}
  <div class="body">
    <input
      class="title"
      bind:this={titleInputEl}
      bind:value={title}
      onblur={saveTitle}
      placeholder="Título"
      spellcheck="false"
      aria-label="Título"
      maxlength={LIMITS.title}
    />
    <textarea
      class="notes"
      bind:value={notes}
      onblur={saveNotes}
      onkeydown={notesKey}
      placeholder="Notas…"
      rows="4"
      maxlength={LIMITS.notes}
    ></textarea>

    {#if showOutcome}
      <section class="block">
        <h3 class="section-h">Resultado</h3>
        <input
          class="outcome"
          bind:value={outcome}
          onblur={saveOutcome}
          placeholder="¿Cuál es el resultado deseado?"
          spellcheck="false"
          aria-label="Resultado del proyecto"
          maxlength={LIMITS.outcome}
        />
      </section>
    {/if}

    {#if showVence}
      <section class="block">
        <h3 class="section-h">Vence</h3>
        <DateInput
          value={item.due_at}
          onChange={saveDueAt}
          ariaLabel="Vence"
        />
      </section>
    {/if}

    {#if showRecordar}
      <section class="block">
        <h3 class="section-h">Recordar</h3>
        <DateInput
          value={item.remind_at}
          onChange={saveRemindAt}
          ariaLabel="Recordar el día"
        />
        {#if reminderPending}
          <p class="hint-small">Activo. Quita la fecha para que vuelva a Bandeja.</p>
        {:else}
          <p class="hint-small">Hasta ese día queda fuera de Bandeja y Siguientes.</p>
        {/if}
      </section>
    {/if}

    {#if showCalendarSection}
      <section class="block">
        <h3 class="section-h">Bloquear tiempo</h3>
        {#if !calendarExpanded}
          <button
            type="button"
            class="link-action"
            onclick={() => { calendarExpandedManual = true; }}
            aria-label="Programar como evento de calendario"
          >+ Programar evento</button>
          <p class="hint-small">Solo para citas o compromisos con hora fija.</p>
        {:else}
          <p class="hint-small">Solo para citas o compromisos con hora fija.</p>
          <label class="all-day">
            <input
              type="checkbox"
              checked={item.all_day}
              onchange={() => void toggleAllDay()}
            />
            <span>Todo el día</span>
          </label>
          {#if item.all_day}
            <div class="cal-row">
              <span class="cal-label">Inicio</span>
              <DateInput
                value={item.start_at}
                onChange={(v) => {
                  if (!v) {
                    void saveStartAt(undefined);
                  } else {
                    const d = new Date(v);
                    d.setHours(0, 0, 0, 0);
                    void saveStartAt(d);
                  }
                }}
                ariaLabel="Inicio"
              />
            </div>
            <div class="cal-row">
              <span class="cal-label">Fin</span>
              <DateInput
                value={item.end_at}
                onChange={(v) => {
                  if (!v) {
                    void saveEndAt(undefined);
                  } else {
                    const d = new Date(v);
                    d.setHours(23, 59, 59, 999);
                    void saveEndAt(d);
                  }
                }}
                ariaLabel="Fin"
              />
            </div>
          {:else}
            <div class="cal-row">
              <span class="cal-label">Inicio</span>
              <input
                class="dt-input"
                type="datetime-local"
                value={toDateTimeLocal(item.start_at)}
                onchange={(e) =>
                  void saveStartAt(fromDateTimeLocal((e.currentTarget as HTMLInputElement).value))}
                aria-label="Inicio"
              />
            </div>
            <div class="cal-row">
              <span class="cal-label">Fin</span>
              <input
                class="dt-input"
                type="datetime-local"
                value={toDateTimeLocal(item.end_at)}
                onchange={(e) =>
                  void saveEndAt(fromDateTimeLocal((e.currentTarget as HTMLInputElement).value))}
                aria-label="Fin"
              />
            </div>
          {/if}
          {#if item.tz && item.tz !== browserTz}
            <p class="hint-small">Zona original: <strong>{item.tz}</strong> (estás en {browserTz}).</p>
          {/if}
        {/if}
      </section>
    {/if}

    {#if showRecurrence}
      {@const currentRecur = readRecurrence(item.recurrence)}
      {@const currentFreq = currentRecur?.freq ?? ''}
      {@const currentInterval = currentRecur?.interval ?? 1}
      <section class="block">
        <h3 class="section-h">Repetir</h3>
        <div class="recur-row">
          <select
            class="recur-select"
            value={currentFreq}
            onchange={(e) => setRecurrence((e.currentTarget as HTMLSelectElement).value)}
            aria-label="Repetir"
          >
            {#each RECUR_OPTIONS as opt (opt.value)}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
          {#if currentRecur}
            <span class="recur-every">cada</span>
            <input
              class="recur-interval"
              type="number"
              min="1"
              max="99"
              inputmode="numeric"
              value={currentInterval}
              onchange={(e) =>
                void setRecurInterval(Number((e.currentTarget as HTMLInputElement).value))}
              aria-label="Cada cuántos {recurUnitLabel(currentRecur.freq, 2)}"
            />
            <span class="recur-unit">{recurUnitLabel(currentRecur.freq, currentInterval)}</span>
          {/if}
        </div>
        {#if currentRecur?.freq === 'weekly' && currentInterval === 1}
          {@const selected = new Set(currentRecur.byDays ?? [])}
          <div class="weekday-chips" role="toolbar" aria-label="Días de la semana">
            {#each WEEK_DAYS as wd, i (wd.code)}
              <button
                type="button"
                class="weekday-chip"
                class:active={selected.has(wd.code)}
                onclick={() => { weekdayFocus = i; void toggleWeekDay(wd.code); }}
                onkeydown={(e) => weekdayKey(e, i)}
                aria-pressed={selected.has(wd.code)}
                tabindex={i === weekdayFocus ? 0 : -1}
              >{wd.label}</button>
            {/each}
          </div>
        {/if}
      </section>
    {/if}

    <section class="block">
      <h3 class="section-h">Estado</h3>
      {#if reminderPrompt}
        <ReminderPrompt
          onConfirm={confirmReminder}
          onCancel={cancelReminder}
          initial={item.remind_at ?? null}
        />
      {/if}
      <StateChanger
        currentState={itemState}
        isProject={isProjectItem}
        reminderPending={reminderPending}
        waiting={reminderPrompt}
        onPick={(k) => void applyTransition(k)}
      />
    </section>

    <dl class="meta">
      <div><dt>Creado</dt><dd>{formatDDMMYYYY(item.created_at)}</dd></div>
      <div><dt>Actualizado</dt><dd>{formatDDMMYYYY(item.updated_at)}</dd></div>
      {#if item.completed_at}
        <div><dt>Completado</dt><dd>{formatDDMMYYYY(item.completed_at)}</dd></div>
      {/if}
    </dl>
  </div>
{/if}

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) 0;
  }
  .head-right {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .parent-crumb {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    text-decoration: none;
    max-width: 16rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .parent-crumb:hover {
    color: var(--text-primary);
    text-decoration: underline;
  }
  .body {
    padding: var(--space-3) 0 var(--space-8);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }
  .loading {
    text-align: center;
    color: var(--text-muted);
    margin: var(--space-7) 0;
  }
  .title {
    font-size: var(--text-2xl);
    font-weight: var(--weight-medium);
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text-primary);
    padding: 0;
    line-height: 1.2;
  }
  .notes {
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-base);
    resize: none;
    min-height: 6rem;
    padding: 0;
    line-height: 1.5;
  }
  .notes::placeholder,
  .title::placeholder,
  .outcome::placeholder {
    color: var(--text-muted);
  }
  .outcome {
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-base);
    padding: 0;
    line-height: 1.5;
  }
  /* Focus invisible: sólo el caret. Sin outline, sin underline.
     Accesibilidad sigue cubierta por el caret + el cambio de elemento
     activo, y los lectores de pantalla anuncian el campo aparte. */
  .title:focus-visible,
  .notes:focus-visible,
  .outcome:focus-visible {
    outline: none;
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
    margin: 0;
    font-weight: var(--weight-medium);
  }
  .hint-small {
    font-size: var(--text-xs);
    color: var(--text-muted);
    margin: 0;
    line-height: 1.4;
  }
  .all-day {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-secondary);
    cursor: pointer;
    user-select: none;
  }
  .all-day input {
    cursor: pointer;
  }
  .cal-row {
    display: grid;
    grid-template-columns: 4rem 1fr;
    align-items: center;
    gap: var(--space-3);
  }
  .cal-label {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .dt-input {
    appearance: none;
    width: 100%;
    border: 1px solid var(--border-default);
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
  }
  .dt-input:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
    border-color: var(--accent);
  }
  @media (max-width: 30rem) {
    .cal-row {
      grid-template-columns: 1fr;
      gap: var(--space-1);
    }
  }
  .recur-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .recur-select {
    flex: 1 1 9rem;
    min-width: 0;
    border: 1px solid var(--border-default);
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: var(--text-sm);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
  }
  .recur-select:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .recur-select option {
    background: var(--surface-base, var(--bg));
    color: var(--text-primary, inherit);
  }
  .recur-every,
  .recur-unit {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .recur-interval {
    width: 3.4rem;
    border: 1px solid var(--border-default);
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    text-align: center;
  }
  .recur-interval:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
    border-color: var(--accent);
  }
  .link-action {
    appearance: none;
    align-self: flex-start;
    border: 1px dashed var(--border-mix-medium);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: color 80ms, border-color 80ms, background 80ms;
  }
  .link-action:hover {
    color: var(--text-primary);
    border-color: var(--text-primary);
    background: var(--hover-bg-subtle);
  }
  .link-action:active {
    background: var(--press-bg-subtle);
  }
  .weekday-chips {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-top: var(--space-1);
  }
  .weekday-chip {
    appearance: none;
    border: 1px solid var(--border-default);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-xs);
    width: 1.85rem;
    height: 1.85rem;
    border-radius: 999px;
    cursor: pointer;
    transition:
      color 80ms,
      border-color 80ms,
      background 80ms,
      box-shadow 80ms,
      transform 80ms;
    line-height: 1;
  }
  .weekday-chip:hover {
    color: var(--text-primary);
    border-color: var(--text-primary);
  }
  .weekday-chip.active {
    border-color: var(--text-primary);
    color: var(--text-primary);
    font-weight: var(--weight-medium);
    background: var(--press-bg-medium);
    box-shadow: var(--shadow-inset-sm);
    transform: translateY(1px);
  }
  .meta {
    margin: 0;
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-1) var(--space-5);
    font-size: var(--text-xs);
  }
  .meta div {
    display: contents;
  }
  .meta dt {
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    align-self: center;
  }
  .meta dd {
    margin: 0;
    color: var(--text-secondary);
  }
  /* Móvil: título más pequeño, weekday chips más anchos para tap,
     meta grid apilada para no truncar fechas. */
  @media (max-width: 40rem) {
    .title {
      font-size: var(--text-xl);
    }
    .body {
      gap: var(--space-5);
    }
    .weekday-chip {
      width: 2.1rem;
      height: 2.1rem;
      font-size: var(--text-sm);
    }
  }
  @media (max-width: 30rem) {
    .meta {
      grid-template-columns: 1fr;
      gap: var(--space-3);
    }
    .meta div {
      display: flex;
      flex-direction: column;
      gap: 0;
    }
  }
</style>
