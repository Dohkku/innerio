<script lang="ts">
  import { onMount } from 'svelte';
  import { useScope } from '$lib/keyboard.svelte';
  import DateInput from './DateInput.svelte';

  let {
    onConfirm,
    onCancel,
    initial = null,
  }: {
    onConfirm: (date: Date) => void;
    onCancel: () => void;
    initial?: Date | null;
  } = $props();

  // Local copy del prop `initial` — el prompt vive una sola sesión (no se
  // re-monta para distintos items), así que capturar el valor inicial es
  // intencional. El `$state` permite que el user edite la fecha antes de
  // confirmar.
  let value = $state<Date | undefined>(undefined);
  $effect(() => {
    if (initial && value === undefined) value = initial;
  });

  function submit() {
    if (!value) {
      onCancel();
      return;
    }
    onConfirm(value);
  }

  // Presets rápidos: el user pulsa el chip o teclea la inicial (1/2/3/4).
  function preset(kind: 'tomorrow' | 'week' | 'month' | 'year') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    switch (kind) {
      case 'tomorrow':
        d.setDate(d.getDate() + 1);
        break;
      case 'week':
        d.setDate(d.getDate() + 7);
        break;
      case 'month':
        d.setMonth(d.getMonth() + 1);
        break;
      case 'year':
        d.setFullYear(d.getFullYear() + 1);
        break;
    }
    value = d;
    onConfirm(d);
  }

  let rootEl = $state<HTMLDivElement | undefined>(undefined);
  onMount(() => {
    // Foco al input de fecha dentro del DateInput.
    const input = rootEl?.querySelector<HTMLInputElement>('input[type="text"]');
    input?.focus();
    input?.select();
  });

  useScope({
    name: 'reminder-prompt',
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
      { key: '1', whileEditing: false, hidden: true, handler: () => preset('tomorrow') },
      { key: '2', whileEditing: false, hidden: true, handler: () => preset('week') },
      { key: '3', whileEditing: false, hidden: true, handler: () => preset('month') },
      { key: '4', whileEditing: false, hidden: true, handler: () => preset('year') },
    ],
  });
</script>

<div class="prompt" bind:this={rootEl} role="dialog" aria-label="Recordarme el día">
  <kbd>R</kbd>
  <span class="lead">Recordar el</span>
  <span class="date-wrap">
    <DateInput
      value={value}
      onChange={(next) => {
        value = next;
      }}
      onEnter={submit}
      ariaLabel="Fecha del recordatorio"
    />
  </span>
  <div class="presets" aria-label="Atajos">
    <button type="button" onclick={() => preset('tomorrow')} title="Mañana [1]"><kbd>1</kbd> mañana</button>
    <button type="button" onclick={() => preset('week')} title="Próxima semana [2]"><kbd>2</kbd> semana</button>
    <button type="button" onclick={() => preset('month')} title="Próximo mes [3]"><kbd>3</kbd> mes</button>
    <button type="button" onclick={() => preset('year')} title="Próximo año [4]"><kbd>4</kbd> año</button>
  </div>
  <span class="hint"><kbd>↵</kbd> guardar · <kbd>Esc</kbd> cancelar</span>
</div>

<style>
  .prompt {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: 0.6rem 0.7rem;
    border: 1px dashed var(--border-default);
    background: var(--surface-sunken);
    border-radius: var(--radius-md);
  }
  .lead {
    font-size: var(--text-sm);
    opacity: 0.8;
  }
  .date-wrap {
    flex: 1;
    min-width: 11rem;
  }
  .presets {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--space-1);
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
    width: 100%;
  }
  kbd {
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 0.7rem;
    padding: 0.05rem 0.35rem;
    border: 1px solid var(--border-mix-medium);
    border-radius: var(--radius-sm);
  }
</style>
