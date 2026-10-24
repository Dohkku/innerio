<script lang="ts">
  import { onMount } from 'svelte';
  import { useScope } from '$lib/keyboard.svelte';
  import DateInput from './DateInput.svelte';

  let {
    onConfirm,
    onCancel,
  }: {
    onConfirm: (payload: { start: Date; end?: Date; allDay: boolean }) => void;
    onCancel: () => void;
  } = $props();

  // Defaults: mañana 09:00–10:00. La queue de procesado es asíncrona —
  // típicamente bloqueas algo para mañana, no para "ahora mismo".
  function tomorrowAt(h: number, m = 0): Date {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(h, m, 0, 0);
    return d;
  }
  function defaultStart(): Date {
    return tomorrowAt(9);
  }
  function defaultEnd(): Date {
    return tomorrowAt(10);
  }

  let allDay = $state(false);
  let startDate = $state<Date>(defaultStart());
  let startTime = $state<string>('09:00');
  let endDate = $state<Date | undefined>(defaultEnd());
  let endTime = $state<string>('10:00');

  function pad(n: number): string {
    return String(n).padStart(2, '0');
  }
  function formatTime(d: Date): string {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function parseTime(s: string): { h: number; m: number } | undefined {
    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return undefined;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return undefined;
    return { h, m: min };
  }
  function combine(date: Date, time: string, allDayMode: boolean): Date {
    const d = new Date(date);
    if (allDayMode) {
      d.setHours(0, 0, 0, 0);
      return d;
    }
    const parsed = parseTime(time) ?? { h: 0, m: 0 };
    d.setHours(parsed.h, parsed.m, 0, 0);
    return d;
  }

  function submit() {
    const start = combine(startDate, startTime, allDay);
    let end: Date | undefined;
    if (endDate) {
      end = combine(endDate, endTime, allDay);
      // Validación mínima: si end <= start, ignora end (el usuario lo
      // arregla en el Inspector después). No bloqueamos el guardado por
      // un rango inválido durante el procesado rápido.
      if (end.getTime() <= start.getTime()) end = undefined;
    }
    onConfirm({ start, ...(end ? { end } : {}), allDay });
  }

  // Presets: el usuario teclea 1/2/3/4 o pulsa el chip. Cada preset
  // configura todo el formulario y confirma directamente — el típico
  // "esto va a tal hora" sin afinar.
  function presetTomorrowMorning() {
    allDay = false;
    startDate = tomorrowAt(9);
    startTime = '09:00';
    endDate = tomorrowAt(10);
    endTime = '10:00';
    submit();
  }
  function presetTomorrowAfternoon() {
    allDay = false;
    startDate = tomorrowAt(16);
    startTime = '16:00';
    endDate = tomorrowAt(17);
    endTime = '17:00';
    submit();
  }
  function presetPlusHour() {
    const now = new Date();
    // Redondea a la siguiente media hora para evitar "10:23".
    const minutes = now.getMinutes();
    const roundUp = minutes < 30 ? 30 : 60;
    now.setMinutes(minutes < 30 ? 30 : 0, 0, 0);
    if (roundUp === 60) now.setHours(now.getHours() + 1);
    const start = new Date(now);
    const end = new Date(now);
    end.setHours(end.getHours() + 1);
    allDay = false;
    startDate = start;
    startTime = formatTime(start);
    endDate = end;
    endTime = formatTime(end);
    submit();
  }
  function presetAllDayTomorrow() {
    allDay = true;
    startDate = tomorrowAt(0);
    endDate = undefined;
    submit();
  }

  let rootEl = $state<HTMLDivElement | undefined>(undefined);
  onMount(() => {
    // Foco al primer DateInput (el de inicio) para que Enter confirme
    // tras editar manualmente sin tener que tabular.
    const input = rootEl?.querySelector<HTMLInputElement>('input[type="text"]');
    input?.focus();
    input?.select();
  });

  useScope({
    name: 'calendar-prompt',
    modal: true,
    bindings: [
      {
        key: 'Escape',
        whileEditing: true,
        description: 'cancelar',
        handler: () => onCancel(),
      },
      {
        key: 'Enter',
        whileEditing: true,
        description: 'guardar',
        handler: () => submit(),
      },
      { key: '1', whileEditing: false, hidden: true, handler: presetTomorrowMorning },
      { key: '2', whileEditing: false, hidden: true, handler: presetTomorrowAfternoon },
      { key: '3', whileEditing: false, hidden: true, handler: presetPlusHour },
      { key: '4', whileEditing: false, hidden: true, handler: presetAllDayTomorrow },
    ],
  });
</script>

<div class="prompt" bind:this={rootEl} role="dialog" aria-label="Agendar evento">
  <div class="header">
    <kbd>C</kbd>
    <span class="lead">Agendar</span>
    <label class="allday">
      <input
        type="checkbox"
        bind:checked={allDay}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      />
      <span>Todo el día</span>
    </label>
  </div>

  <div class="row">
    <span class="label">Empieza</span>
    <span class="field">
      <DateInput
        value={startDate}
        onChange={(next) => {
          if (next) startDate = next;
        }}
        onEnter={submit}
        ariaLabel="Fecha de inicio"
      />
    </span>
    {#if !allDay}
      <input
        type="time"
        class="time"
        bind:value={startTime}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        aria-label="Hora de inicio"
      />
    {/if}
  </div>

  <div class="row">
    <span class="label">Termina</span>
    <span class="field">
      <DateInput
        value={endDate ?? null}
        onChange={(next) => {
          endDate = next;
        }}
        onEnter={submit}
        ariaLabel="Fecha de fin (opcional)"
        placeholder="opcional"
      />
    </span>
    {#if !allDay}
      <input
        type="time"
        class="time"
        bind:value={endTime}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        aria-label="Hora de fin"
      />
    {/if}
  </div>

  <div class="presets" aria-label="Atajos">
    <button type="button" onclick={presetTomorrowMorning} title="Mañana 9:00 [1]">
      <kbd>1</kbd> mañana 9:00
    </button>
    <button type="button" onclick={presetTomorrowAfternoon} title="Mañana 16:00 [2]">
      <kbd>2</kbd> mañana 16:00
    </button>
    <button type="button" onclick={presetPlusHour} title="En 30–60 min [3]">
      <kbd>3</kbd> en 1h
    </button>
    <button type="button" onclick={presetAllDayTomorrow} title="Todo el día mañana [4]">
      <kbd>4</kbd> mañana todo el día
    </button>
  </div>

  <span class="hint"><kbd>↵</kbd> guardar · <kbd>Esc</kbd> cancelar</span>
</div>

<style>
  .prompt {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0.7rem 0.8rem;
    border: 1px dashed var(--border-default);
    background: var(--surface-sunken);
    border-radius: var(--radius-md);
  }
  .header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .lead {
    font-size: var(--text-sm);
    opacity: 0.8;
  }
  .allday {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-left: auto;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    cursor: pointer;
    user-select: none;
  }
  .allday input {
    margin: 0;
    cursor: pointer;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .label {
    flex: 0 0 4.5rem;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .field {
    flex: 1;
    min-width: 10rem;
  }
  .time {
    appearance: none;
    font: inherit;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
    background: transparent;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    padding: var(--space-1) var(--space-2);
    line-height: 1.4;
    width: 6.5rem;
  }
  .time:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
    border-color: var(--accent);
  }
  .presets {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-top: var(--space-1);
  }
  .presets button {
    appearance: none;
    border: 1px solid var(--border-mix-subtle);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-xs);
    padding: 0.18rem 0.45rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    transition: background 70ms, border-color 70ms, color 70ms;
  }
  .presets button:hover {
    color: var(--text-primary);
    background: var(--hover-bg-subtle);
    border-color: var(--border-mix-medium);
  }
  .presets button:active {
    background: var(--press-bg-subtle);
  }
  .hint {
    font-size: var(--text-xs);
    opacity: 0.55;
  }
  kbd {
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 0.7rem;
    padding: 0.05rem 0.35rem;
    border: 1px solid var(--border-mix-medium);
    border-radius: var(--radius-sm);
  }
</style>
